import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useKeyboardShortcuts, useKeyboardShortcutsRuntime } from '@/config/shortcutStore'
import { useFileSystem } from '@/hooks/useFileSystem'
import { matchesAnyShortcut, type ShortcutBinding } from '@/lib/keyboard'
import { DirectorySelectionLayout } from '@/layouts/DirectorySelectionLayout'
import {
  resolveInitialAccessProvider,
  resolveLocalPublishedRootSyncPlan,
  resolveLocalWorkspaceIdentity,
} from '@/lib/appAccessModel'
import {
  getActiveRemoteWorkspace,
  getStoredAccessProvider,
  isLoopbackOrigin,
  setStoredAccessProvider,
  type AccessProvider,
} from '@/lib/accessState'
import {
  syncRemotePublishedRootsFromLocalBrowser,
} from '@/lib/remoteAccess'
import { RememberedDevicesAdminPanel } from '@/features/remote-access/components/RememberedDevicesAdminPanel'
import { useRemoteAccessController } from '@/features/remote-access/hooks/useRemoteAccessController'
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
  const updateAccessProvider = useCallback((nextProvider: AccessProvider) => {
    setAccessProvider(nextProvider)
    setStoredAccessProvider(nextProvider)
  }, [])
  const isLoopbackUi = isLoopbackOrigin()
  const {
    activeRemoteWorkspace,
    remoteFileSystem,
    remoteStep,
    remoteToken,
    remoteError,
    remoteRoots,
    rememberRemoteDevice,
    rememberRemoteDeviceLabel,
    isRemoteLoading,
    isRememberedDevicesAdminOpen,
    rememberedDevices,
    rememberedDevicesError,
    isRememberedDevicesLoading,
    isRememberedDevicesMutating,
    shouldShowRemoteWorkspace,
    shouldShowStartupScreen,
    showRememberedDevicesAdminEntry,
    setRemoteToken,
    setRememberRemoteDeviceLabel,
    handleRememberRemoteDeviceChange,
    handleOpenRemoteConnect,
    handleCancelRemoteConnect,
    handleSubmitRemoteToken,
    handleSelectRemoteRoot,
    handleDisconnectRemoteWorkspace,
    handleForgetRemoteDevice,
    handleOpenRememberedDevicesAdmin,
    handleCloseRememberedDevicesAdmin,
    handleRenameRememberedDevice,
    handleRevokeRememberedDevice,
    handleRevokeAllRememberedDevices,
    refreshRememberedDevices,
  } = useRemoteAccessController({
    accessProvider,
    updateAccessProvider,
    localRootId: localFileSystem.rootId,
    isLoopbackUi,
  })

  const activeRootHandle = accessProvider === 'remote-readonly'
    ? remoteFileSystem.rootHandle
    : localFileSystem.rootHandle
  const activeRootId = accessProvider === 'remote-readonly'
    ? remoteFileSystem.rootId
    : localFileSystem.rootId
  const lastPublishedRootSyncSignatureRef = useRef<string | null>(null)

  useKeyboardShortcutsRuntime(activeRootHandle, activeRootId)
  const keyboardShortcuts = useKeyboardShortcuts()

  const handleSelectLocalDirectory = useCallback(async () => {
    updateAccessProvider('local-browser')
    await localFileSystem.selectDirectory()
  }, [localFileSystem, updateAccessProvider])

  useDirectorySelectionShortcut(
    accessProvider !== 'remote-readonly' && localFileSystem.rootId === null && !activeRemoteWorkspace,
    keyboardShortcuts.app.openDirectory,
    handleSelectLocalDirectory
  )

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
        showRememberedDevicesAdminEntry={showRememberedDevicesAdminEntry}
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
