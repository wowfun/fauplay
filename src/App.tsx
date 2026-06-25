import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useKeyboardShortcuts, useKeyboardShortcutsRuntime } from '@/config/shortcutStore'
import { useFileSystem } from '@/hooks/useFileSystem'
import { useRemoteFileSystem } from '@/hooks/useRemoteFileSystem'
import { matchesAnyShortcut, type ShortcutBinding } from '@/lib/keyboard'
import { DirectorySelectionLayout } from '@/layouts/DirectorySelectionLayout'
import {
  readRemoteConnectErrorMessage,
  resolveAppWorkspaceVisibility,
  resolveInitialAccessProvider,
  resolveLocalPublishedRootSyncPlan,
  resolveLocalWorkspaceIdentity,
  resolveRemoteAccessConnectionCommitPlan,
  resolveRemoteAccessResetPlan,
  resolveRemoteWorkspaceRestorePlan,
  type RemoteAccessConnectionCommitPlan,
  type RemoteAccessResetPlan,
} from '@/lib/appAccessModel'
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
  clearRemoteAccessSession,
  createRemoteAccessSession,
  loadRememberedDevicesAdmin,
  loadRemoteAccessCapabilities,
  loadRemoteAccessRoots,
  syncRemotePublishedRootsFromLocalBrowser,
  renameRememberedDeviceAdmin,
  revokeAllRememberedDevicesAdmin,
  revokeRememberedDeviceAdmin,
  type RememberedDeviceAdminEntry,
  type RemoteRootEntry,
} from '@/lib/remoteAccess'
import { loadRuntimeCapabilities } from '@/lib/runtimeApi'
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
  const [accessProvider, setAccessProvider] = useState<AccessProvider>(() => resolveInitialAccessProvider({
    storedProvider: getStoredAccessProvider(),
    activeRemoteWorkspace: getActiveRemoteWorkspace(),
  }))
  const [remoteStep, setRemoteStep] = useState<'idle' | 'token' | 'roots'>('idle')
  const [remoteToken, setRemoteToken] = useState('')
  const [rememberRemoteDevice, setRememberRemoteDevice] = useState(false)
  const [rememberRemoteDeviceLabel, setRememberRemoteDeviceLabel] = useState('')
  const [remoteRoots, setRemoteRoots] = useState<RemoteRootEntry[]>([])
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)
  const [activeRemoteWorkspace, setActiveRemoteWorkspaceState] = useState(() => getActiveRemoteWorkspace())
  const [isLocalRuntimeOnline, setIsLocalRuntimeOnline] = useState(false)
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
  const {
    shouldShowRemoteWorkspace,
    shouldShowStartupScreen,
  } = resolveAppWorkspaceVisibility({
    accessProvider,
    activeRemoteWorkspace,
    localRootId: localFileSystem.rootId,
  })
  const isLoopbackUi = isLoopbackOrigin()
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

  const applyRemoteAccessResetPlan = useCallback((plan: RemoteAccessResetPlan) => {
    if (plan.clearActiveRemoteWorkspace) {
      setActiveRemoteWorkspaceState(null)
    }
    setRemoteRoots(plan.remoteRoots)
    setRemoteToken(plan.remoteToken)
    setRememberRemoteDevice(plan.rememberRemoteDevice)
    setRememberRemoteDeviceLabel(plan.rememberRemoteDeviceLabel)
    setRemoteStep(plan.remoteStep)
    if ('remoteError' in plan) {
      setRemoteError(plan.remoteError ?? null)
    }
    if (plan.nextAccessProvider) {
      updateAccessProvider(plan.nextAccessProvider)
    }
  }, [updateAccessProvider])

  const applyRemoteAccessConnectionCommitPlan = useCallback((
    plan: Extract<RemoteAccessConnectionCommitPlan, { kind: 'commit' }>
  ) => {
    if (plan.clearConnectionDraft) {
      setRemoteToken('')
      setRememberRemoteDevice(false)
      setRememberRemoteDeviceLabel('')
    }
    setRemoteRoots(plan.remoteRoots)
    if (plan.activeRemoteRoot) {
      setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(
        plan.activeRemoteRoot.id,
        plan.activeRemoteRoot.label,
      ))
    }
    setRemoteStep(plan.remoteStep)
    if (plan.nextAccessProvider) {
      updateAccessProvider(plan.nextAccessProvider)
    }
  }, [updateAccessProvider])

  useDirectorySelectionShortcut(
    accessProvider !== 'remote-readonly' && localFileSystem.rootId === null && !activeRemoteWorkspace,
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
        const capabilities = await loadRemoteAccessCapabilities()
        if (!capabilities.enabled) {
          throw new Error('当前站点未启用远程只读访问')
        }
        const roots = await loadRemoteAccessRoots()
        if (cancelled) return
        setRemoteRoots(roots)
        const restorePlan = resolveRemoteWorkspaceRestorePlan({
          activeRemoteWorkspace: storedWorkspace,
          roots,
        })
        if (restorePlan.kind === 'error') {
          throw new Error(restorePlan.message)
        }
        setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(
          restorePlan.root.id,
          restorePlan.root.label,
        ))
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
      applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'session-invalidated' }))
    }

    window.addEventListener(eventName, handleRemoteSessionInvalidated)
    return () => window.removeEventListener(eventName, handleRemoteSessionInvalidated)
  }, [applyRemoteAccessResetPlan])

  useEffect(() => {
    if (!shouldShowStartupScreen || typeof window === 'undefined') {
      return
    }

    window.history.replaceState(null, '', clearWorkspaceBrowserHistoryUrl(window.location.href))
  }, [shouldShowStartupScreen])

  useEffect(() => {
    const plan = resolveLocalPublishedRootSyncPlan({
      isLoopbackUi,
      isCachedRootsReady: localFileSystem.isCachedRootsReady,
      cachedRoots: localFileSystem.cachedRoots,
      favoriteFolders: localFileSystem.favoriteFolders,
      lastSyncedSignature: lastPublishedRootSyncSignatureRef.current,
    })
    if (plan.kind === 'skip') return

    const timeoutId = window.setTimeout(() => {
      void syncRemotePublishedRootsFromLocalBrowser(plan.payload)
        .then(() => {
          lastPublishedRootSyncSignatureRef.current = plan.signature
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
    localFileSystem.cachedRoots,
    localFileSystem.favoriteFolders,
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
      setIsLocalRuntimeOnline(false)
      setIsRememberedDevicesAdminOpen(false)
      return
    }

    let cancelled = false
    const refreshLocalRuntimeStatus = async () => {
      const snapshot = await loadRuntimeCapabilities()
      if (!cancelled) {
        setIsLocalRuntimeOnline(snapshot.online)
      }
    }

    void refreshLocalRuntimeStatus()
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
      applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'open-connect' }))

      try {
        const capabilities = await loadRemoteAccessCapabilities()
        if (!capabilities.enabled) {
          throw new Error('当前站点未启用远程只读访问')
        }

        const roots = await loadRemoteAccessRoots(2000, {
          clearSessionOnUnauthorized: false,
        })
        const plan = resolveRemoteAccessConnectionCommitPlan({
          roots,
          clearConnectionDraft: false,
        })
        if (plan.kind === 'error') {
          throw new Error(plan.message)
        }
        applyRemoteAccessConnectionCommitPlan(plan)
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
  }, [applyRemoteAccessConnectionCommitPlan, applyRemoteAccessResetPlan])

  const handleCancelRemoteConnect = useCallback(() => {
    applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'cancel-connect' }))
  }, [applyRemoteAccessResetPlan])

  const handleSubmitRemoteToken = useCallback(async () => {
    const normalizedToken = remoteToken.trim()
    if (!normalizedToken) return

    setIsRemoteLoading(true)
    setRemoteError(null)
    try {
      const capabilities = await loadRemoteAccessCapabilities()
      if (!capabilities.enabled) {
        throw new Error('当前站点未启用远程只读访问')
      }

      await createRemoteAccessSession(normalizedToken, {
        rememberDevice: rememberRemoteDevice,
        rememberDeviceLabel: rememberRemoteDeviceLabel,
      })
      const roots = await loadRemoteAccessRoots()
      const plan = resolveRemoteAccessConnectionCommitPlan({
        roots,
        clearConnectionDraft: true,
      })
      if (plan.kind === 'error') {
        throw new Error(plan.message)
      }

      applyRemoteAccessConnectionCommitPlan(plan)
    } catch (error) {
      setRemoteError(readRemoteConnectErrorMessage(
        error,
        '远程连接失败',
        '远程 token 无效，或当前站点未启用远程只读访问'
      ))
    } finally {
      setIsRemoteLoading(false)
    }
  }, [
    applyRemoteAccessConnectionCommitPlan,
    rememberRemoteDevice,
    rememberRemoteDeviceLabel,
    remoteToken,
  ])

  const handleSelectRemoteRoot = useCallback((root: RemoteRootEntry) => {
    setRemoteError(null)
    setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(root.id, root.label))
    updateAccessProvider('remote-readonly')
  }, [updateAccessProvider])

  const handleDisconnectRemoteWorkspace = useCallback(() => {
    void clearRemoteAccessSession().catch(() => undefined)
    clearRemoteSession()
    applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'disconnect-workspace' }))
  }, [applyRemoteAccessResetPlan])

  const handleForgetRemoteDevice = useCallback(() => {
    const forgetRemoteDevice = async () => {
      try {
        await clearRemoteAccessSession({
          forgetDevice: true,
        })
      } catch (error) {
        setRemoteError(readRemoteConnectErrorMessage(error, '忘记此设备失败'))
      } finally {
        clearRemoteSession()
        applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'forget-device' }))
      }
    }

    void forgetRemoteDevice()
  }, [applyRemoteAccessResetPlan])

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
        showRememberedDevicesAdminEntry={isLoopbackUi && isLocalRuntimeOnline}
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

  const localWorkspaceIdentity = resolveLocalWorkspaceIdentity({
    rootId: localFileSystem.rootId,
    rootName: localFileSystem.rootName,
    rootHandleName: localFileSystem.rootHandle?.name ?? null,
    fallbackSessionRootId: localFileSystem.rootHandle
      ? getFallbackSessionRootId(localFileSystem.rootHandle)
      : null,
  })

  return (
    <Suspense fallback={<WorkspaceLoadingFallback rootName={localWorkspaceIdentity.rootName} />}>
      <WorkspaceShell
        key={localWorkspaceIdentity.workspaceKey}
        accessProvider="local-browser"
        rootHandle={localFileSystem.rootHandle}
        rootId={localWorkspaceIdentity.rootId}
        rootName={localWorkspaceIdentity.rootName}
        storageNamespace={localWorkspaceIdentity.storageNamespace}
        favoriteFolders={localFileSystem.favoriteFolders}
        isCurrentPathFavorited={localFileSystem.isCurrentPathFavorited}
        files={localFileSystem.files}
        listingPage={localFileSystem.listingPage}
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
        loadNextListingPage={localFileSystem.loadNextListingPage}
        setListingQuery={localFileSystem.setListingQuery}
        setFlattenView={localFileSystem.setFlattenView}
        filterFiles={localFileSystem.filterFiles}
      />
    </Suspense>
  )
}

export default App
