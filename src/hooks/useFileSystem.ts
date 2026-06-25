import { useCallback, useState } from 'react'
import { appConfig } from '@/config/appConfig'
import type {
  AddressPathHistoryEntry,
  FavoriteFolderEntry,
} from '@/types'
import {
  FAVORITE_FOLDERS_STORAGE_KEY,
} from '@/features/explorer/lib/favoriteFolderStore'
import { useCachedLocalRootsController } from '@/features/explorer/hooks/useCachedLocalRootsController'
import { useFavoriteFolderController } from '@/features/explorer/hooks/useFavoriteFolderController'
import { useLocalDirectoryAccessController } from '@/features/explorer/hooks/useLocalDirectoryAccessController'
import { useLocalListingController } from '@/features/explorer/hooks/useLocalListingController'
import { useLocalRootActivationController } from '@/features/explorer/hooks/useLocalRootActivationController'
import { useLocalRootCommandController } from '@/features/explorer/hooks/useLocalRootCommandController'
import { useTrashListingController } from '@/features/explorer/hooks/useTrashListingController'
import { filterExplorerListingFiles } from '@/features/explorer/lib/fileListingFilterModel'
import {
  createLocalChildDirectoryPath,
  isLocalVirtualTrashPath,
  normalizeLocalRootRelativePath,
  resolveLocalRootActivationTarget,
  resolveLocalNavigationTarget,
  resolveLocalParentPath,
} from '@/features/explorer/lib/localFileSystemModel'

const ROOT_CACHE_MISS_MESSAGE = '历史目录缓存不存在，请重新选择文件夹'
const ROOT_PERMISSION_DENIED_MESSAGE = '目录访问权限不可用，请重新选择文件夹'
const FAVORITE_FOLDERS_MAX_ITEMS = appConfig.favorites.maxItems
const ROOT_LABEL_FALLBACK = '根目录'
const VIRTUAL_TRASH_PATH = '@trash'
const RUNTIME_LISTING_PAGE_SIZE = 500
const RUNTIME_TRASH_LISTING_TIMEOUT_MS = 120000
const FAVORITE_FOLDER_MODEL_OPTIONS = {
  maxItems: FAVORITE_FOLDERS_MAX_ITEMS,
  rootLabelFallback: ROOT_LABEL_FALLBACK,
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

  const {
    getDirectoryHandleByPathFromRoot,
    getDirectoryHandleByPath,
    getCurrentDirectoryHandle,
    listChildDirectories,
  } = useLocalDirectoryAccessController({
    rootHandle,
    rootId,
    currentPath,
    virtualTrashPath: VIRTUAL_TRASH_PATH,
    permissionDeniedMessage: ROOT_PERMISSION_DENIED_MESSAGE,
  })

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

  const {
    loadUnifiedTrashItems,
  } = useTrashListingController({
    virtualTrashPath: VIRTUAL_TRASH_PATH,
    timeoutMs: RUNTIME_TRASH_LISTING_TIMEOUT_MS,
    replaceListingItems,
    setCurrentPath,
    setIsFlattenView,
    setRootHandle,
    setRootId,
  })

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

  const {
    selectDirectory,
    openCachedRoot,
    rebindCachedRootPath,
  } = useLocalRootCommandController({
    cachedRoots,
    rootLabelFallback: ROOT_LABEL_FALLBACK,
    activateRootHandle,
    activateInactiveLocalRootTarget,
    warmupRootPathBinding,
    refreshCachedRoots,
    setIsLoading,
    setError,
  })

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
