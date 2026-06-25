import { useCallback, useState } from 'react'
import { appConfig } from '@/config/appConfig'
import type {
  AddressPathHistoryEntry,
  FavoriteFolderEntry,
  FileItem,
} from '@/types'
import { openDirectory, isHiddenSystemDirectory } from '@/lib/fileSystem'
import {
  listRuntimeGlobalTrash,
  listRuntimeLocalDirectory,
  listRuntimeRootTrash,
  toRuntimeGlobalTrashFileItems,
  toRuntimeRootTrashFileItems,
} from '@/lib/runtimeApi'
import { upsertCachedRootHandle } from '@/lib/rootHandleCache'
import {
  ensureRootPath,
  getBoundRootPath,
} from '@/lib/reveal'
import {
  FAVORITE_FOLDERS_STORAGE_KEY,
} from '@/features/explorer/lib/favoriteFolderStore'
import { useCachedLocalRootsController } from '@/features/explorer/hooks/useCachedLocalRootsController'
import { useFavoriteFolderController } from '@/features/explorer/hooks/useFavoriteFolderController'
import { useLocalListingController } from '@/features/explorer/hooks/useLocalListingController'
import { useLocalRootActivationController } from '@/features/explorer/hooks/useLocalRootActivationController'
import { sortTrashFileItems } from '@/features/explorer/lib/listingQueryModel'
import { filterExplorerListingFiles } from '@/features/explorer/lib/fileListingFilterModel'
import {
  createLocalChildDirectoryPath,
  isLocalVirtualTrashPath,
  normalizeLocalRootRelativePath,
  resolveLocalRootActivationTarget,
  resolveLocalNavigationTarget,
  resolveLocalParentPath,
  sortLocalChildDirectoryNames,
} from '@/features/explorer/lib/localFileSystemModel'

const ROOT_CACHE_MISS_MESSAGE = '历史目录缓存不存在，请重新选择文件夹'
const ROOT_PERMISSION_DENIED_MESSAGE = '目录访问权限不可用，请重新选择文件夹'
const FAVORITE_FOLDERS_MAX_ITEMS = appConfig.favorites.maxItems
const ROOT_LABEL_FALLBACK = '根目录'
const VIRTUAL_TRASH_PATH = '@trash'
const RUNTIME_LISTING_PAGE_SIZE = 500
const FAVORITE_FOLDER_MODEL_OPTIONS = {
  maxItems: FAVORITE_FOLDERS_MAX_ITEMS,
  rootLabelFallback: ROOT_LABEL_FALLBACK,
}

function createSessionRootId(handle: FileSystemDirectoryHandle): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `session:${handle.name}:${suffix}`
}

interface NavigateToPathOptions {
  resetFlattenView?: boolean
}

export function useFileSystem() {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [rootId, setRootId] = useState<string | null>(null)
  const [rootName, setRootName] = useState<string>(ROOT_LABEL_FALLBACK)
  const [currentPath, setCurrentPath] = useState<string>('')
  const [isFlattenView, setIsFlattenView] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    cachedRoots,
    isCachedRootsReady,
    refreshCachedRoots,
  } = useCachedLocalRootsController({
    rootLabelFallback: ROOT_LABEL_FALLBACK,
  })

  const {
    favoriteFolders,
    isCurrentPathFavorited,
    removeFavoriteFolder,
    toggleCurrentFolderFavorite,
  } = useFavoriteFolderController({
    rootId,
    rootName,
    currentPath,
    virtualTrashPath: VIRTUAL_TRASH_PATH,
    storageKey: FAVORITE_FOLDERS_STORAGE_KEY,
    ...FAVORITE_FOLDER_MODEL_OPTIONS,
  })

  const getDirectoryHandleByPathFromRoot = useCallback(async (
    baseRoot: FileSystemDirectoryHandle,
    targetPath: string
  ) => {
    let current: FileSystemDirectoryHandle = baseRoot
    const normalizedPath = normalizeLocalRootRelativePath(targetPath)
    if (!normalizedPath) return current

    const pathParts = normalizedPath.split('/').filter(Boolean)
    for (const part of pathParts) {
      const opts: FileSystemPermissionDescriptor = { mode: 'read' }
      const permission = await current.queryPermission(opts)
      if (permission === 'denied') {
        throw new Error(ROOT_PERMISSION_DENIED_MESSAGE)
      }
      if (permission === 'prompt') {
        const requested = await current.requestPermission(opts)
        if (requested !== 'granted') {
          throw new Error(ROOT_PERMISSION_DENIED_MESSAGE)
        }
      }
      current = await current.getDirectoryHandle(part)
    }

    return current
  }, [])

  const getDirectoryHandleByPath = useCallback(async (targetPath: string) => {
    if (!rootHandle) return null
    return getDirectoryHandleByPathFromRoot(rootHandle, targetPath)
  }, [rootHandle, getDirectoryHandleByPathFromRoot])

  const getCurrentDirectoryHandle = useCallback(async () => {
    return getDirectoryHandleByPath(currentPath)
  }, [getDirectoryHandleByPath, currentPath])

  const {
    files,
    listingPage,
    loadDirectoryItems,
    loadNextListingPage,
    replaceListingItems,
    setListingQuery,
  } = useLocalListingController({
    rootId,
    currentPath,
    isFlattenView,
    virtualTrashPath: VIRTUAL_TRASH_PATH,
    pageSize: RUNTIME_LISTING_PAGE_SIZE,
    permissionDeniedMessage: ROOT_PERMISSION_DENIED_MESSAGE,
    resolveCurrentDirectoryHandle: getCurrentDirectoryHandle,
    setIsLoading,
    setError,
  })

  const loadUnifiedTrashItems = useCallback(async (targetRootId: string | null, targetRootHandle: FileSystemDirectoryHandle | null) => {
    const boundRootPath = targetRootId ? getBoundRootPath(targetRootId) : null
    let rootTrashFiles: FileItem[] = []

    if (boundRootPath) {
      const runtimeRootTrash = await listRuntimeRootTrash({ rootPath: boundRootPath }, 120000)
      rootTrashFiles = toRuntimeRootTrashFileItems(runtimeRootTrash.entries, boundRootPath)
    }

    const globalTrash = await listRuntimeGlobalTrash({}, 120000)
    const globalTrashFiles = toRuntimeGlobalTrashFileItems(globalTrash.entries)
    const nextFiles = sortTrashFileItems([...rootTrashFiles, ...globalTrashFiles])

    replaceListingItems(nextFiles)
    setCurrentPath(VIRTUAL_TRASH_PATH)
    setIsFlattenView(false)
    if (targetRootHandle) {
      setRootHandle(targetRootHandle)
    }
    if (targetRootId) {
      setRootId(targetRootId)
    }
  }, [replaceListingItems])

  const activateRootHandle = useCallback(async (
    nextRootHandle: FileSystemDirectoryHandle,
    nextRootId: string,
    targetPath: string
  ) => {
    const normalizedPath = normalizeLocalRootRelativePath(targetPath)
    if (isLocalVirtualTrashPath(normalizedPath, VIRTUAL_TRASH_PATH)) {
      await loadUnifiedTrashItems(nextRootId, nextRootHandle)
      return
    }
    await loadDirectoryItems(null, normalizedPath, false, {
      rootId: nextRootId,
      resolveDirectoryHandle: () => getDirectoryHandleByPathFromRoot(nextRootHandle, normalizedPath),
    })
    setRootHandle(nextRootHandle)
    setRootId(nextRootId)
    setRootName(nextRootHandle.name || ROOT_LABEL_FALLBACK)
    setCurrentPath(normalizedPath)
    setIsFlattenView(false)
  }, [getDirectoryHandleByPathFromRoot, loadDirectoryItems, loadUnifiedTrashItems])

  const activateRuntimeRoot = useCallback(async (
    nextRootId: string,
    nextRootName: string,
    targetPath: string
  ) => {
    const normalizedPath = normalizeLocalRootRelativePath(targetPath)
    if (isLocalVirtualTrashPath(normalizedPath, VIRTUAL_TRASH_PATH)) {
      await loadUnifiedTrashItems(nextRootId, null)
      setRootHandle(null)
      setRootName(nextRootName || ROOT_LABEL_FALLBACK)
      return
    }

    await loadDirectoryItems(null, normalizedPath, false, {
      rootId: nextRootId,
    })
    setRootHandle(null)
    setRootId(nextRootId)
    setRootName(nextRootName || ROOT_LABEL_FALLBACK)
    setCurrentPath(normalizedPath)
    setIsFlattenView(false)
  }, [loadDirectoryItems, loadUnifiedTrashItems])

  const listChildDirectories = useCallback(async (targetPath: string): Promise<string[]> => {
    const normalizedPath = normalizeLocalRootRelativePath(targetPath)
    if (isLocalVirtualTrashPath(normalizedPath, VIRTUAL_TRASH_PATH)) {
      return []
    }

    const boundRootPath = rootId ? getBoundRootPath(rootId) : null
    if (boundRootPath) {
      try {
        const runtimeListing = await listRuntimeLocalDirectory({
          rootPath: boundRootPath,
          rootRelativePath: normalizedPath,
        })
        return sortLocalChildDirectoryNames(runtimeListing.entries
          .filter((entry) => entry.kind === 'directory')
          .map((entry) => entry.name))
      } catch {
        // Fall back to File System Access while the runtime-backed Listing path is being adopted.
      }
    }

    if (!rootHandle) return []

    const directory = await getDirectoryHandleByPath(normalizedPath)
    if (!directory) return []

    const directoryNames: string[] = []
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== 'directory') continue
      if (isHiddenSystemDirectory(name)) continue
      directoryNames.push(name)
    }

    return sortLocalChildDirectoryNames(directoryNames)
  }, [rootHandle, rootId, getDirectoryHandleByPath])

  const {
    activateInactiveLocalRootTarget,
    warmupRootPathBinding,
  } = useLocalRootActivationController({
    cachedRoots,
    rootLabelFallback: ROOT_LABEL_FALLBACK,
    cacheMissMessage: ROOT_CACHE_MISS_MESSAGE,
    permissionDeniedMessage: ROOT_PERMISSION_DENIED_MESSAGE,
    activateRootHandle,
    activateRuntimeRoot,
    refreshCachedRoots,
    setError,
  })

  const selectDirectory = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const handle = await openDirectory()
      if (!handle) return

      const cached = await upsertCachedRootHandle(handle).catch(() => null)
      const resolvedRootId = cached?.rootId ?? createSessionRootId(handle)

      warmupRootPathBinding(resolvedRootId, handle.name)
      await activateRootHandle(handle, resolvedRootId, '')
      await refreshCachedRoots()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [activateRootHandle, refreshCachedRoots, warmupRootPathBinding])

  const openCachedRoot = useCallback(async (targetRootId: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      return await activateInactiveLocalRootTarget({
        targetRootId,
        targetPath: '',
      })
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [activateInactiveLocalRootTarget])

  const rebindCachedRootPath = useCallback(async (targetRootId: string): Promise<boolean> => {
    if (!targetRootId) return false

    const targetRoot = cachedRoots.find((item) => item.rootId === targetRootId)
    const rootLabel = targetRoot?.rootName || ROOT_LABEL_FALLBACK

    try {
      const nextPath = ensureRootPath({
        rootId: targetRootId,
        rootLabel,
        promptIfMissing: true,
        forcePrompt: true,
      })
      if (!nextPath) return false

      await refreshCachedRoots()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    }
  }, [cachedRoots, refreshCachedRoots])

  const navigateToPath = useCallback(async (
    targetPath: string,
    options: NavigateToPathOptions = {}
  ): Promise<boolean> => {
    if (!rootId) return false

    const navigationTarget = resolveLocalNavigationTarget({
      targetPath,
      currentFlattened: isFlattenView,
      resetFlattened: options.resetFlattenView === true,
      virtualTrashPath: VIRTUAL_TRASH_PATH,
    })

    setIsLoading(true)
    setError(null)

    try {
      if (navigationTarget.isVirtualTrash) {
        await loadUnifiedTrashItems(rootId, rootHandle)
        return true
      }
      await loadDirectoryItems(null, navigationTarget.path, navigationTarget.flattened, {
        rootId,
        resolveDirectoryHandle: () => getDirectoryHandleByPath(navigationTarget.path),
      })
      setCurrentPath(navigationTarget.path)
      if (navigationTarget.flattened !== isFlattenView) {
        setIsFlattenView(navigationTarget.flattened)
      }
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [rootHandle, isFlattenView, getDirectoryHandleByPath, loadDirectoryItems, loadUnifiedTrashItems, rootId])

  const openPathInRoot = useCallback(async (targetRootId: string, targetPath: string): Promise<boolean> => {
    if (!targetRootId) return false

    const currentRootTarget = resolveLocalRootActivationTarget({
      targetRootId,
      targetPath,
      currentRootId: rootId,
      targetRoot: null,
      boundRootPath: null,
      hasCachedHandle: false,
      rootLabelFallback: ROOT_LABEL_FALLBACK,
    })
    if (currentRootTarget.type === 'current-root') {
      return navigateToPath(currentRootTarget.path, { resetFlattenView: true })
    }

    setIsLoading(true)
    setError(null)

    try {
      return await activateInactiveLocalRootTarget({
        targetRootId,
        targetPath,
      })
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [
    activateInactiveLocalRootTarget,
    navigateToPath,
    rootId,
  ])

  const openHistoryEntry = useCallback((entry: AddressPathHistoryEntry): Promise<boolean> => {
    return openPathInRoot(entry.rootId, entry.path)
  }, [openPathInRoot])

  const openFavoriteFolder = useCallback((entry: FavoriteFolderEntry): Promise<boolean> => {
    return openPathInRoot(entry.rootId, entry.path)
  }, [openPathInRoot])

  const navigateToDirectory = useCallback(async (dirName: string) => {
    const nextPath = createLocalChildDirectoryPath(currentPath, dirName)
    await navigateToPath(nextPath)
  }, [currentPath, navigateToPath])

  const navigateUp = useCallback(async () => {
    const parentPath = resolveLocalParentPath(currentPath, VIRTUAL_TRASH_PATH)
    if (parentPath === null) return
    await navigateToPath(parentPath)
  }, [currentPath, navigateToPath])

  const setFlattenView = useCallback(async (flattenView: boolean) => {
    if (!rootId) return

    setIsLoading(true)
    setError(null)
    try {
      await loadDirectoryItems(null, currentPath, flattenView, {
        rootId,
        resolveDirectoryHandle: getCurrentDirectoryHandle,
      })
      setIsFlattenView(flattenView)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [getCurrentDirectoryHandle, loadDirectoryItems, currentPath, rootId])

  const filterFiles = useCallback(filterExplorerListingFiles, [])

  return {
    rootHandle,
    rootId,
    rootName,
    cachedRoots,
    isCachedRootsReady,
    favoriteFolders,
    isCurrentPathFavorited,
    files,
    listingPage,
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
    loadNextListingPage,
    setListingQuery,
    setFlattenView,
    filterFiles,
  }
}
