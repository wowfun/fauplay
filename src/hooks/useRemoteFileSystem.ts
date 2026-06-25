import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildRemoteServiceKey, fromRemoteUiRootId, toRemoteUiRootId } from '@/lib/accessState'
import {
  callRemoteAccessHttp,
  loadRemoteAccessFavorites,
  removeRemoteAccessFavorite,
  type RemoteRootEntry,
  upsertRemoteAccessFavorite,
} from '@/lib/remoteAccess'
import { filterExplorerListingFiles } from '@/features/explorer/lib/fileListingFilterModel'
import { isFavoriteFolderActive } from '@/features/explorer/lib/favoriteFolderModel'
import {
  buildRemoteRootEntryMap,
  createRemoteChildDirectoryPath,
  normalizeRemoteRootRelativePath,
  parseRemoteListingItems,
  resolveRemoteParentPath,
  toRemoteChildDirectoryNames,
  toRemoteFavoriteFolderEntries,
} from '@/features/explorer/lib/remoteFileSystemModel'
import type {
  AddressPathHistoryEntry,
  FavoriteFolderEntry,
  FileItem,
} from '@/types'

const ROOT_LABEL_FALLBACK = '根目录'
const REMOTE_VIRTUAL_TRASH_PATH = '@trash'

function toUiRootId(configRootId: string): string {
  return toRemoteUiRootId(configRootId)
}

function fromUiRootId(uiRootId: string): string {
  return fromRemoteUiRootId(uiRootId) || uiRootId
}

function toFavoriteFolderEntries(
  roots: RemoteRootEntry[],
  items: Array<{ rootId: string; path: string; favoritedAtMs: number }>,
): FavoriteFolderEntry[] {
  return toRemoteFavoriteFolderEntries({
    roots,
    items,
    rootLabelFallback: ROOT_LABEL_FALLBACK,
    toUiRootId,
  })
}

interface UseRemoteFileSystemOptions {
  roots: RemoteRootEntry[]
  initialConfigRootId: string
}

export function useRemoteFileSystem({
  roots,
  initialConfigRootId,
}: UseRemoteFileSystemOptions) {
  const rootEntryByConfigId = useMemo(() => buildRemoteRootEntryMap(roots), [roots])
  const hasRemoteRoots = roots.length > 0
  const serviceKey = useMemo(() => buildRemoteServiceKey(), [])
  const [currentConfigRootId, setCurrentConfigRootId] = useState(initialConfigRootId)
  const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolderEntry[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [isFlattenView, setIsFlattenView] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rootEntry = rootEntryByConfigId.get(currentConfigRootId) ?? null
  const rootId = rootEntry ? toUiRootId(rootEntry.id) : null
  const rootName = rootEntry?.label || ROOT_LABEL_FALLBACK

  useEffect(() => {
    if (!initialConfigRootId) return
    setCurrentConfigRootId(initialConfigRootId)
  }, [initialConfigRootId])

  useEffect(() => {
    if (!hasRemoteRoots) {
      setFavoriteFolders([])
      return
    }

    let cancelled = false
    const refreshFavorites = async () => {
      try {
        const items = await loadRemoteAccessFavorites()
        if (!cancelled) {
          setFavoriteFolders(toFavoriteFolderEntries(roots, items))
        }
      } catch {
        if (!cancelled) {
          setFavoriteFolders([])
        }
      }
    }

    void refreshFavorites()
    return () => {
      cancelled = true
    }
  }, [hasRemoteRoots, roots, serviceKey])

  const loadDirectory = useCallback(async (
    configRootId: string,
    targetPath: string,
    flattenView: boolean
  ) => {
    const normalizedPath = normalizeRemoteRootRelativePath(targetPath)
    const result = await callRemoteAccessHttp('/v1/remote/files/list', {
      rootId: configRootId,
      path: normalizedPath,
      flattenView,
    }, 120000)
    setFiles(parseRemoteListingItems(result, configRootId))
    setCurrentPath(normalizedPath)
    setIsFlattenView(flattenView)
    setCurrentConfigRootId(configRootId)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadInitialDirectory = async () => {
      if (!initialConfigRootId) return
      setIsLoading(true)
      setError(null)
      try {
        await loadDirectory(initialConfigRootId, '', false)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialDirectory()
    return () => {
      cancelled = true
    }
  }, [initialConfigRootId, loadDirectory])

  const navigateToPath = useCallback(async (targetPath: string): Promise<boolean> => {
    if (!currentConfigRootId) return false
    setIsLoading(true)
    setError(null)
    try {
      await loadDirectory(currentConfigRootId, targetPath, isFlattenView)
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [currentConfigRootId, isFlattenView, loadDirectory])

  const openPathInRoot = useCallback(async (targetUiRootId: string, targetPath: string): Promise<boolean> => {
    const nextConfigRootId = fromUiRootId(targetUiRootId)
    if (!nextConfigRootId) return false
    setIsLoading(true)
    setError(null)
    try {
      await loadDirectory(nextConfigRootId, targetPath, false)
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [loadDirectory])

  const navigateToDirectory = useCallback(async (dirName: string) => {
    const nextPath = createRemoteChildDirectoryPath(currentPath, dirName)
    await navigateToPath(nextPath)
  }, [currentPath, navigateToPath])

  const navigateUp = useCallback(async () => {
    const parentPath = resolveRemoteParentPath(currentPath)
    if (parentPath === null) return
    await navigateToPath(parentPath)
  }, [currentPath, navigateToPath])

  const listChildDirectories = useCallback(async (targetPath: string): Promise<string[]> => {
    if (!currentConfigRootId) return []
    const result = await callRemoteAccessHttp('/v1/remote/files/list', {
      rootId: currentConfigRootId,
      path: normalizeRemoteRootRelativePath(targetPath),
      flattenView: false,
    }, 120000)
    return toRemoteChildDirectoryNames(result, currentConfigRootId)
  }, [currentConfigRootId])

  const setFlattenView = useCallback(async (flattenView: boolean) => {
    if (!currentConfigRootId) return
    setIsLoading(true)
    setError(null)
    try {
      await loadDirectory(currentConfigRootId, currentPath, flattenView)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [currentConfigRootId, currentPath, loadDirectory])

  const openHistoryEntry = useCallback((entry: AddressPathHistoryEntry): Promise<boolean> => {
    return openPathInRoot(entry.rootId, entry.path)
  }, [openPathInRoot])

  const openFavoriteFolder = useCallback((entry: FavoriteFolderEntry): Promise<boolean> => {
    return openPathInRoot(entry.rootId, entry.path)
  }, [openPathInRoot])

  const removeFavoriteFolder = useCallback((entry: FavoriteFolderEntry): void => {
    const run = async () => {
      const configRootId = fromUiRootId(entry.rootId)
      if (!configRootId) return
      await removeRemoteAccessFavorite(configRootId, normalizeRemoteRootRelativePath(entry.path))
      const items = await loadRemoteAccessFavorites()
      setFavoriteFolders(toFavoriteFolderEntries(roots, items))
    }

    void run().catch((err) => {
      setError((err as Error).message)
    })
  }, [roots])

  const toggleCurrentFolderFavorite = useCallback((): void => {
    if (!rootId) return
    const normalizedPath = normalizeRemoteRootRelativePath(currentPath)
    const configRootId = fromUiRootId(rootId)
    if (!configRootId) return

    const run = async () => {
      const alreadyFavorited = isFavoriteFolderActive(favoriteFolders, {
        rootId,
        path: normalizedPath,
        virtualTrashPath: REMOTE_VIRTUAL_TRASH_PATH,
      })
      if (alreadyFavorited) {
        await removeRemoteAccessFavorite(configRootId, normalizedPath)
      } else {
        await upsertRemoteAccessFavorite(configRootId, normalizedPath)
      }
      const items = await loadRemoteAccessFavorites()
      setFavoriteFolders(toFavoriteFolderEntries(roots, items))
    }

    void run().catch((err) => {
      setError((err as Error).message)
    })
  }, [currentPath, favoriteFolders, rootId, roots])

  const filterFiles = useCallback(filterExplorerListingFiles, [])

  const isCurrentPathFavorited = (() => {
    return isFavoriteFolderActive(favoriteFolders, {
      rootId,
      path: currentPath,
      virtualTrashPath: REMOTE_VIRTUAL_TRASH_PATH,
    })
  })()

  return {
    rootHandle: null as FileSystemDirectoryHandle | null,
    rootId,
    rootName,
    serviceKey,
    favoriteFolders,
    isCurrentPathFavorited,
    files,
    currentPath,
    isFlattenView,
    isLoading,
    error,
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
  }
}
