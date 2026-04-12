import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useKeyboardShortcuts, useKeyboardShortcutsRuntime } from '@/config/shortcutStore'
import { useFileSystem } from '@/hooks/useFileSystem'
import { useRemoteFileSystem } from '@/hooks/useRemoteFileSystem'
import { matchesAnyShortcut, type ShortcutBinding } from '@/lib/keyboard'
import { DirectorySelectionLayout } from '@/layouts/DirectorySelectionLayout'
import {
  clearRemoteSession,
  getActiveRemoteWorkspace,
  getRemoteSessionInvalidatedEventName,
  getStoredAccessProvider,
  isLoopbackOrigin,
  setActiveRemoteWorkspace,
  setStoredAccessProvider,
  type AccessProvider,
} from '@/lib/accessState'
import {
  clearRemoteGatewaySession,
  createRemoteGatewaySession,
  loadGatewayCapabilities,
  loadRememberedDevicesAdmin,
  loadRemoteGatewayCapabilities,
  syncRemotePublishedRootsFromLocalBrowser,
  loadRemoteGatewayRoots,
  renameRememberedDeviceAdmin,
  revokeAllRememberedDevicesAdmin,
  revokeRememberedDeviceAdmin,
  type LocalPublishedRootSyncEntry,
  type RememberedDeviceAdminEntry,
  type RemoteRootEntry,
} from '@/lib/gateway'
import { RememberedDevicesAdminPanel } from '@/features/remote-access/components/RememberedDevicesAdminPanel'
import { clearWorkspaceBrowserHistoryUrl } from '@/features/workspace/lib/browserHistory'

const WorkspaceShell = lazy(async () => {
  const mod = await import('@/features/workspace/components/WorkspaceShell')
  return { default: mod.WorkspaceShell }
})

const fallbackSessionRootIdByHandle = new WeakMap<FileSystemDirectoryHandle, string>()

function getFallbackSessionRootId(handle: FileSystemDirectoryHandle): string {
  const existing = fallbackSessionRootIdByHandle.get(handle)
  if (existing) return existing

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const next = `session:${handle.name}:${suffix}`
  fallbackSessionRootIdByHandle.set(handle, next)
  return next
}

function readRemoteConnectErrorMessage(
  error: unknown,
  fallback: string,
  unauthorizedMessage: string = '远程会话已失效，请重新连接'
): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'REMOTE_UNAUTHORIZED') {
    return unauthorizedMessage
  }
  return error instanceof Error ? error.message : fallback
}

function buildLocalPublishedRootSyncPayload(
  cachedRoots: Array<{ rootId: string; rootName: string; boundRootPath?: string }>,
  favoriteFolders: Array<{ rootId: string; path: string }>,
): LocalPublishedRootSyncEntry[] {
  return cachedRoots.flatMap((root) => {
    const absolutePath = typeof root.boundRootPath === 'string' ? root.boundRootPath.trim() : ''
    if (!absolutePath) return []
    const favoritePaths = [
      ...new Set(
        favoriteFolders
          .filter((item) => item.rootId === root.rootId)
          .map((item) => item.path.split('/').filter(Boolean).join('/')),
      ),
    ]
    return [{
      label: root.rootName,
      absolutePath,
      favoritePaths,
    }]
  })
}

function useDirectorySelectionShortcut(
  isEnabled: boolean,
  openDirectoryShortcut: ShortcutBinding[],
  selectDirectory: () => Promise<void>
) {
  useEffect(() => {
    if (!isEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      if (matchesAnyShortcut(event, openDirectoryShortcut)) {
        event.preventDefault()
        void selectDirectory()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEnabled, openDirectoryShortcut, selectDirectory])
}

function WorkspaceLoadingFallback({ rootName }: { rootName: string }) {
  return (
    <div className="h-screen bg-background flex flex-col items-center justify-center p-8 overflow-hidden">
      <div className="text-center max-w-md space-y-3">
        <div className="mx-auto h-8 w-8 rounded-full border-2 border-muted border-t-foreground animate-spin" />
        <p className="text-sm text-muted-foreground">正在加载工作区...</p>
        <p className="text-xs text-muted-foreground">目录：{rootName}</p>
      </div>
    </div>
  )
}

function App() {
  const localFileSystem = useFileSystem()
  const [accessProvider, setAccessProvider] = useState<AccessProvider>(() => {
    const storedProvider = getStoredAccessProvider()
    return storedProvider === 'remote-readonly' && getActiveRemoteWorkspace()
      ? 'remote-readonly'
      : 'local-browser'
  })
  const [remoteStep, setRemoteStep] = useState<'idle' | 'token' | 'roots'>('idle')
  const [remoteToken, setRemoteToken] = useState('')
  const [rememberRemoteDevice, setRememberRemoteDevice] = useState(false)
  const [rememberRemoteDeviceLabel, setRememberRemoteDeviceLabel] = useState('')
  const [remoteRoots, setRemoteRoots] = useState<RemoteRootEntry[]>([])
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)
  const [activeRemoteWorkspace, setActiveRemoteWorkspaceState] = useState(() => getActiveRemoteWorkspace())
  const [isLocalGatewayOnline, setIsLocalGatewayOnline] = useState(false)
  const [isRememberedDevicesAdminOpen, setIsRememberedDevicesAdminOpen] = useState(false)
  const [rememberedDevices, setRememberedDevices] = useState<RememberedDeviceAdminEntry[]>([])
  const [rememberedDevicesError, setRememberedDevicesError] = useState<string | null>(null)
  const [isRememberedDevicesLoading, setIsRememberedDevicesLoading] = useState(false)
  const [isRememberedDevicesMutating, setIsRememberedDevicesMutating] = useState(false)
  const remoteFileSystem = useRemoteFileSystem({
    roots: remoteRoots,
    initialConfigRootId: activeRemoteWorkspace?.configRootId ?? '',
  })

  const activeRootHandle = accessProvider === 'remote-readonly'
    ? remoteFileSystem.rootHandle
    : localFileSystem.rootHandle
  const activeRootId = accessProvider === 'remote-readonly'
    ? remoteFileSystem.rootId
    : localFileSystem.rootId
  const shouldShowRemoteWorkspace = accessProvider === 'remote-readonly' && Boolean(activeRemoteWorkspace)
  const shouldShowLocalWorkspace = !shouldShowRemoteWorkspace && Boolean(localFileSystem.rootHandle)
  const shouldShowStartupScreen = !shouldShowRemoteWorkspace && !shouldShowLocalWorkspace
  const isLoopbackUi = isLoopbackOrigin()
  const localPublishedRootSyncPayload = useMemo(
    () => buildLocalPublishedRootSyncPayload(localFileSystem.cachedRoots, localFileSystem.favoriteFolders),
    [localFileSystem.cachedRoots, localFileSystem.favoriteFolders],
  )
  const localPublishedRootSyncSignature = useMemo(
    () => JSON.stringify(localPublishedRootSyncPayload),
    [localPublishedRootSyncPayload],
  )
  const lastPublishedRootSyncSignatureRef = useRef<string | null>(null)

  useKeyboardShortcutsRuntime(activeRootHandle, activeRootId)
  const keyboardShortcuts = useKeyboardShortcuts()

  const updateAccessProvider = useCallback((nextProvider: AccessProvider) => {
    setAccessProvider(nextProvider)
    setStoredAccessProvider(nextProvider)
  }, [])

  const handleRememberRemoteDeviceChange = useCallback((value: boolean) => {
    setRememberRemoteDevice(value)
    if (!value) {
      setRememberRemoteDeviceLabel('')
    }
  }, [])

  const handleSelectLocalDirectory = useCallback(async () => {
    updateAccessProvider('local-browser')
    await localFileSystem.selectDirectory()
  }, [localFileSystem, updateAccessProvider])

  useDirectorySelectionShortcut(
    accessProvider !== 'remote-readonly' && localFileSystem.rootHandle === null && !activeRemoteWorkspace,
    keyboardShortcuts.app.openDirectory,
    handleSelectLocalDirectory
  )

  useEffect(() => {
    const storedWorkspace = getActiveRemoteWorkspace()
    if (accessProvider !== 'remote-readonly' || !storedWorkspace) {
      return
    }

    let cancelled = false
    const restoreRemoteWorkspace = async () => {
      setIsRemoteLoading(true)
      setRemoteError(null)
      setRemoteStep('token')
      try {
        const capabilities = await loadRemoteGatewayCapabilities()
        if (!capabilities.enabled) {
          throw new Error('当前站点未启用远程只读访问')
        }
        const roots = await loadRemoteGatewayRoots()
        if (cancelled) return
        setRemoteRoots(roots)
        const matchedRoot = roots.find((item) => item.id === storedWorkspace.configRootId) ?? null
        if (!matchedRoot) {
          throw new Error('远程 Root 已不存在或当前会话无权访问')
        }
        setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(matchedRoot.id, matchedRoot.label))
      } catch (error) {
        if (cancelled) return
        clearRemoteSession()
        setActiveRemoteWorkspaceState(null)
        setRemoteRoots([])
        setRemoteStep('token')
        setRemoteError(readRemoteConnectErrorMessage(error, '远程会话恢复失败'))
        updateAccessProvider('local-browser')
      } finally {
        if (!cancelled) {
          setIsRemoteLoading(false)
        }
      }
    }

    void restoreRemoteWorkspace()
    return () => {
      cancelled = true
    }
  }, [accessProvider, updateAccessProvider])

  useEffect(() => {
    const eventName = getRemoteSessionInvalidatedEventName()
    const handleRemoteSessionInvalidated = () => {
      setActiveRemoteWorkspaceState(null)
      setRemoteRoots([])
      setRemoteToken('')
      setRememberRemoteDevice(false)
      setRememberRemoteDeviceLabel('')
      setRemoteStep('token')
      setRemoteError('远程会话已失效，请重新连接')
      updateAccessProvider('local-browser')
    }

    window.addEventListener(eventName, handleRemoteSessionInvalidated)
    return () => window.removeEventListener(eventName, handleRemoteSessionInvalidated)
  }, [updateAccessProvider])

  useEffect(() => {
    if (!shouldShowStartupScreen || typeof window === 'undefined') {
      return
    }

    window.history.replaceState(null, '', clearWorkspaceBrowserHistoryUrl(window.location.href))
  }, [shouldShowStartupScreen])

  useEffect(() => {
    if (!isLoopbackUi || !localFileSystem.isCachedRootsReady) {
      return
    }
    if (lastPublishedRootSyncSignatureRef.current === localPublishedRootSyncSignature) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void syncRemotePublishedRootsFromLocalBrowser(localPublishedRootSyncPayload)
        .then(() => {
          lastPublishedRootSyncSignatureRef.current = localPublishedRootSyncSignature
        })
        .catch(() => {
          // Keep the local browsing flow unaffected; the next state change can retry.
        })
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    isLoopbackUi,
    localFileSystem.isCachedRootsReady,
    localPublishedRootSyncPayload,
    localPublishedRootSyncSignature,
  ])

  const refreshRememberedDevices = useCallback(async () => {
    setIsRememberedDevicesLoading(true)
    setRememberedDevicesError(null)
    try {
      const items = await loadRememberedDevicesAdmin()
      setRememberedDevices(items)
    } catch (error) {
      setRememberedDevicesError(error instanceof Error ? error.message : '读取已记住设备失败')
    } finally {
      setIsRememberedDevicesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isLoopbackUi || !shouldShowStartupScreen) {
      setIsLocalGatewayOnline(false)
      setIsRememberedDevicesAdminOpen(false)
      return
    }

    let cancelled = false
    const refreshLocalGatewayStatus = async () => {
      const snapshot = await loadGatewayCapabilities()
      if (!cancelled) {
        setIsLocalGatewayOnline(snapshot.online)
      }
    }

    void refreshLocalGatewayStatus()
    return () => {
      cancelled = true
    }
  }, [isLoopbackUi, shouldShowStartupScreen])

  const handleOpenRememberedDevicesAdmin = useCallback(() => {
    if (!isLoopbackUi) return
    setIsRememberedDevicesAdminOpen(true)
    void refreshRememberedDevices()
  }, [isLoopbackUi, refreshRememberedDevices])

  const handleCloseRememberedDevicesAdmin = useCallback(() => {
    setIsRememberedDevicesAdminOpen(false)
    setRememberedDevicesError(null)
  }, [])

  const handleRenameRememberedDevice = useCallback((deviceId: string, label: string) => {
    const run = async () => {
      setIsRememberedDevicesMutating(true)
      setRememberedDevicesError(null)
      try {
        await renameRememberedDeviceAdmin(deviceId, label)
        await refreshRememberedDevices()
      } catch (error) {
        setRememberedDevicesError(error instanceof Error ? error.message : '重命名设备失败')
      } finally {
        setIsRememberedDevicesMutating(false)
      }
    }

    void run()
  }, [refreshRememberedDevices])

  const handleRevokeRememberedDevice = useCallback((deviceId: string) => {
    const run = async () => {
      setIsRememberedDevicesMutating(true)
      setRememberedDevicesError(null)
      try {
        await revokeRememberedDeviceAdmin(deviceId)
        await refreshRememberedDevices()
      } catch (error) {
        setRememberedDevicesError(error instanceof Error ? error.message : '撤销设备失败')
      } finally {
        setIsRememberedDevicesMutating(false)
      }
    }

    void run()
  }, [refreshRememberedDevices])

  const handleRevokeAllRememberedDevices = useCallback(() => {
    const run = async () => {
      setIsRememberedDevicesMutating(true)
      setRememberedDevicesError(null)
      try {
        await revokeAllRememberedDevicesAdmin()
        await refreshRememberedDevices()
      } catch (error) {
        setRememberedDevicesError(error instanceof Error ? error.message : '全部撤销失败')
      } finally {
        setIsRememberedDevicesMutating(false)
      }
    }

    void run()
  }, [refreshRememberedDevices])

  const handleOpenRemoteConnect = useCallback(() => {
    const openRemoteConnect = async () => {
      setIsRemoteLoading(true)
      setRemoteError(null)
      setRemoteRoots([])
      setRemoteToken('')
      setRememberRemoteDevice(false)
      setRememberRemoteDeviceLabel('')
      setRemoteStep('token')

      try {
        const capabilities = await loadRemoteGatewayCapabilities()
        if (!capabilities.enabled) {
          throw new Error('当前站点未启用远程只读访问')
        }

        const roots = await loadRemoteGatewayRoots(2000, {
          clearSessionOnUnauthorized: false,
        })
        if (roots.length === 0) {
          throw new Error('当前远程服务未配置可访问的 Root')
        }

        setRemoteRoots(roots)
        if (roots.length === 1) {
          const onlyRoot = roots[0]!
          setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(onlyRoot.id, onlyRoot.label))
          setRemoteStep('roots')
          updateAccessProvider('remote-readonly')
          return
        }

        setRemoteStep('roots')
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'REMOTE_UNAUTHORIZED') {
          setRemoteStep('token')
          return
        }
        setRemoteError(readRemoteConnectErrorMessage(error, '远程连接失败'))
      } finally {
        setIsRemoteLoading(false)
      }
    }

    void openRemoteConnect()
  }, [updateAccessProvider])

  const handleCancelRemoteConnect = useCallback(() => {
    setRemoteError(null)
    setRemoteRoots([])
    setRemoteToken('')
    setRememberRemoteDevice(false)
    setRememberRemoteDeviceLabel('')
    setRemoteStep('idle')
  }, [])

  const handleSubmitRemoteToken = useCallback(async () => {
    const normalizedToken = remoteToken.trim()
    if (!normalizedToken) return

    setIsRemoteLoading(true)
    setRemoteError(null)
    try {
      const capabilities = await loadRemoteGatewayCapabilities()
      if (!capabilities.enabled) {
        throw new Error('当前站点未启用远程只读访问')
      }

      await createRemoteGatewaySession(normalizedToken, {
        rememberDevice: rememberRemoteDevice,
        rememberDeviceLabel: rememberRemoteDeviceLabel,
      })
      const roots = await loadRemoteGatewayRoots()
      if (roots.length === 0) {
        throw new Error('当前远程服务未配置可访问的 Root')
      }

      setRemoteToken('')
      setRememberRemoteDevice(false)
      setRememberRemoteDeviceLabel('')
      setRemoteRoots(roots)
      if (roots.length === 1) {
        const onlyRoot = roots[0]!
        setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(onlyRoot.id, onlyRoot.label))
        setRemoteStep('roots')
        updateAccessProvider('remote-readonly')
        return
      }

      setRemoteStep('roots')
    } catch (error) {
      setRemoteError(readRemoteConnectErrorMessage(
        error,
        '远程连接失败',
        '远程 token 无效，或当前站点未启用远程只读访问'
      ))
    } finally {
      setIsRemoteLoading(false)
    }
  }, [rememberRemoteDevice, rememberRemoteDeviceLabel, remoteToken, updateAccessProvider])

  const handleSelectRemoteRoot = useCallback((root: RemoteRootEntry) => {
    setRemoteError(null)
    setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(root.id, root.label))
    updateAccessProvider('remote-readonly')
  }, [updateAccessProvider])

  const handleDisconnectRemoteWorkspace = useCallback(() => {
    void clearRemoteGatewaySession().catch(() => undefined)
    clearRemoteSession()
    setActiveRemoteWorkspaceState(null)
    setRemoteRoots([])
    setRemoteToken('')
    setRememberRemoteDevice(false)
    setRememberRemoteDeviceLabel('')
    setRemoteError(null)
    setRemoteStep('token')
    updateAccessProvider('local-browser')
  }, [updateAccessProvider])

  const handleForgetRemoteDevice = useCallback(() => {
    const forgetRemoteDevice = async () => {
      try {
        await clearRemoteGatewaySession({
          forgetDevice: true,
        })
      } catch (error) {
        setRemoteError(readRemoteConnectErrorMessage(error, '忘记此设备失败'))
      } finally {
        clearRemoteSession()
        setActiveRemoteWorkspaceState(null)
        setRemoteRoots([])
        setRemoteToken('')
        setRememberRemoteDevice(false)
        setRememberRemoteDeviceLabel('')
        setRemoteStep('token')
        updateAccessProvider('local-browser')
      }
    }

    void forgetRemoteDevice()
  }, [updateAccessProvider])

  if (shouldShowStartupScreen && isRememberedDevicesAdminOpen) {
    return (
      <RememberedDevicesAdminPanel
        items={rememberedDevices}
        error={rememberedDevicesError}
        isLoading={isRememberedDevicesLoading}
        isMutating={isRememberedDevicesMutating}
        onClose={handleCloseRememberedDevicesAdmin}
        onRefresh={() => void refreshRememberedDevices()}
        onRename={handleRenameRememberedDevice}
        onRevoke={handleRevokeRememberedDevice}
        onRevokeAll={handleRevokeAllRememberedDevices}
      />
    )
  }

  if (shouldShowStartupScreen) {
    return (
      <DirectorySelectionLayout
        isLoading={localFileSystem.isLoading || isRemoteLoading}
        error={localFileSystem.error}
        onSelectDirectory={handleSelectLocalDirectory}
        cachedRoots={localFileSystem.cachedRoots}
        favoriteFolders={localFileSystem.favoriteFolders}
        onOpenCachedRoot={localFileSystem.openCachedRoot}
        onRebindCachedRootPath={localFileSystem.rebindCachedRootPath}
        onOpenFavoriteFolder={localFileSystem.openFavoriteFolder}
        onRemoveFavoriteFolder={localFileSystem.removeFavoriteFolder}
        remoteStep={remoteStep}
        remoteToken={remoteToken}
        remoteError={remoteError}
        remoteRoots={remoteRoots}
        onRemoteTokenChange={setRemoteToken}
        rememberRemoteDevice={rememberRemoteDevice}
        rememberRemoteDeviceLabel={rememberRemoteDeviceLabel}
        showRememberedDevicesAdminEntry={isLoopbackUi && isLocalGatewayOnline}
        onRememberRemoteDeviceChange={handleRememberRemoteDeviceChange}
        onRememberRemoteDeviceLabelChange={setRememberRemoteDeviceLabel}
        onOpenRemoteConnect={handleOpenRemoteConnect}
        onCancelRemoteConnect={handleCancelRemoteConnect}
        onSubmitRemoteToken={handleSubmitRemoteToken}
        onSelectRemoteRoot={handleSelectRemoteRoot}
        onOpenRememberedDevicesAdmin={handleOpenRememberedDevicesAdmin}
      />
    )
  }

  if (shouldShowRemoteWorkspace && activeRemoteWorkspace && remoteFileSystem.rootId) {
    return (
      <Suspense fallback={<WorkspaceLoadingFallback rootName={activeRemoteWorkspace.rootLabel} />}>
        <WorkspaceShell
          key={`remote:${activeRemoteWorkspace.uiRootId}`}
          accessProvider="remote-readonly"
          rootHandle={null}
          rootId={remoteFileSystem.rootId}
          rootName={activeRemoteWorkspace.rootLabel}
          storageNamespace={activeRemoteWorkspace.serviceKey}
          favoriteFolders={remoteFileSystem.favoriteFolders}
          isCurrentPathFavorited={remoteFileSystem.isCurrentPathFavorited}
          files={remoteFileSystem.files}
          currentPath={remoteFileSystem.currentPath}
          isFlattenView={remoteFileSystem.isFlattenView}
          isLoading={remoteFileSystem.isLoading}
          error={remoteFileSystem.error}
          selectDirectory={handleSelectLocalDirectory}
          openFavoriteFolder={remoteFileSystem.openFavoriteFolder}
          removeFavoriteFolder={remoteFileSystem.removeFavoriteFolder}
          toggleCurrentFolderFavorite={remoteFileSystem.toggleCurrentFolderFavorite}
          openHistoryEntry={remoteFileSystem.openHistoryEntry}
          navigateToPath={remoteFileSystem.navigateToPath}
          navigateToDirectory={remoteFileSystem.navigateToDirectory}
          navigateUp={remoteFileSystem.navigateUp}
          listChildDirectories={remoteFileSystem.listChildDirectories}
          setFlattenView={remoteFileSystem.setFlattenView}
          filterFiles={remoteFileSystem.filterFiles}
          onSwitchWorkspace={handleDisconnectRemoteWorkspace}
          onForgetRemoteDevice={handleForgetRemoteDevice}
        />
      </Suspense>
    )
  }

  if (shouldShowRemoteWorkspace && activeRemoteWorkspace) {
    return <WorkspaceLoadingFallback rootName={activeRemoteWorkspace.rootLabel} />
  }

  const resolvedRootId = localFileSystem.rootId ?? getFallbackSessionRootId(localFileSystem.rootHandle!)

  return (
    <Suspense fallback={<WorkspaceLoadingFallback rootName={localFileSystem.rootHandle!.name} />}>
      <WorkspaceShell
        key={`local:${resolvedRootId}`}
        accessProvider="local-browser"
        rootHandle={localFileSystem.rootHandle}
        rootId={resolvedRootId}
        rootName={localFileSystem.rootHandle!.name}
        storageNamespace="local-browser"
        favoriteFolders={localFileSystem.favoriteFolders}
        isCurrentPathFavorited={localFileSystem.isCurrentPathFavorited}
        files={localFileSystem.files}
        currentPath={localFileSystem.currentPath}
        isFlattenView={localFileSystem.isFlattenView}
        isLoading={localFileSystem.isLoading}
        error={localFileSystem.error}
        selectDirectory={handleSelectLocalDirectory}
        openFavoriteFolder={localFileSystem.openFavoriteFolder}
        removeFavoriteFolder={localFileSystem.removeFavoriteFolder}
        toggleCurrentFolderFavorite={localFileSystem.toggleCurrentFolderFavorite}
        openHistoryEntry={localFileSystem.openHistoryEntry}
        navigateToPath={localFileSystem.navigateToPath}
        navigateToDirectory={localFileSystem.navigateToDirectory}
        navigateUp={localFileSystem.navigateUp}
        listChildDirectories={localFileSystem.listChildDirectories}
        setFlattenView={localFileSystem.setFlattenView}
        filterFiles={localFileSystem.filterFiles}
      />
    </Suspense>
  )
}

export default App
