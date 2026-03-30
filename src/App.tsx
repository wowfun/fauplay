import { Suspense, lazy, useEffect } from 'react'
import { useKeyboardShortcuts, useKeyboardShortcutsRuntime } from '@/config/shortcutStore'
import { useFileSystem } from '@/hooks/useFileSystem'
import { matchesAnyShortcut, type ShortcutBinding } from '@/lib/keyboard'
import { DirectorySelectionLayout } from '@/layouts/DirectorySelectionLayout'

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
  const {
    rootHandle,
    rootId,
    cachedRoots,
    favoriteFolders,
    isCurrentPathFavorited,
    files,
    currentPath,
    isFlattenView,
    isLoading,
    error,
    selectDirectory,
    openCachedRoot,
    rebindCachedRootPath,
    openFavoriteFolder,
    removeFavoriteFolder,
    toggleCurrentFolderFavorite,
    openHistoryEntry,
    navigateToPath,
    navigateToDirectory,
    navigateUp,
    listChildDirectories,
    setFlattenView,
    filterFiles,
  } = useFileSystem()
  useKeyboardShortcutsRuntime(rootHandle, rootId)
  const keyboardShortcuts = useKeyboardShortcuts()
  useDirectorySelectionShortcut(rootHandle === null, keyboardShortcuts.app.openDirectory, selectDirectory)

  if (!rootHandle) {
    return (
      <DirectorySelectionLayout
        isLoading={isLoading}
        error={error}
        onSelectDirectory={selectDirectory}
        cachedRoots={cachedRoots}
        favoriteFolders={favoriteFolders}
        onOpenCachedRoot={openCachedRoot}
        onRebindCachedRootPath={rebindCachedRootPath}
        onOpenFavoriteFolder={openFavoriteFolder}
        onRemoveFavoriteFolder={removeFavoriteFolder}
      />
    )
  }

  const resolvedRootId = rootId ?? getFallbackSessionRootId(rootHandle)

  return (
    <Suspense fallback={<WorkspaceLoadingFallback rootName={rootHandle.name} />}>
      <WorkspaceShell
        rootHandle={rootHandle}
        rootId={resolvedRootId}
        files={files}
        currentPath={currentPath}
        isFlattenView={isFlattenView}
        isLoading={isLoading}
        error={error}
        selectDirectory={selectDirectory}
        favoriteFolders={favoriteFolders}
        isCurrentPathFavorited={isCurrentPathFavorited}
        openFavoriteFolder={openFavoriteFolder}
        removeFavoriteFolder={removeFavoriteFolder}
        toggleCurrentFolderFavorite={toggleCurrentFolderFavorite}
        openHistoryEntry={openHistoryEntry}
        navigateToPath={navigateToPath}
        navigateToDirectory={navigateToDirectory}
        navigateUp={navigateUp}
        listChildDirectories={listChildDirectories}
        setFlattenView={setFlattenView}
        filterFiles={filterFiles}
      />
    </Suspense>
  )
}

export default App
