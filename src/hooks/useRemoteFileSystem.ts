import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildRemoteServiceKey, fromRemoteUiRootId, toRemoteUiRootId } from '@/lib/accessState'
import {
  callRemoteGatewayHttp,
  loadRemoteGatewayFavorites,
  removeRemoteGatewayFavorite,
  type RemoteRootEntry,
  upsertRemoteGatewayFavorite,
} from '@/lib/gateway'
import { isImageFile, isVideoFile } from '@/lib/fileSystem'
import type {
  AddressPathHistoryEntry,
  FavoriteFolderEntry,
  FileItem,
  FilterState,
} from '@/types'

const ROOT_LABEL_FALLBACK = '根目录'

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function buildRootEntryMap(roots: RemoteRootEntry[]): Map<string, RemoteRootEntry> {
  return new Map(roots.map((root) => [root.id, root]))
}

function toUiRootId(configRootId: string): string {
  return toRemoteUiRootId(configRootId)
}

function fromUiRootId(uiRootId: string): string {
  return fromRemoteUiRootId(uiRootId) || uiRootId
}

function parseRemoteFileItems(payload: unknown, configRootId: string): FileItem[] {
  if (!payload || typeof payload !== 'object') return []
  const rawItems = Array.isArray((payload as { items?: unknown[] }).items)
    ? (payload as { items?: unknown[] }).items
    : []

  return (rawItems ?? []).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const candidate = item as Partial<FileItem>
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const filePath = typeof candidate.path === 'string' ? normalizeRelativePath(candidate.path) : ''
    const kind = candidate.kind === 'directory' ? 'directory' : candidate.kind === 'file' ? 'file' : null
    if (!name || !filePath || !kind) return []

    const lastModifiedMs = Number.isFinite(Number(candidate.lastModifiedMs))
      ? Number(candidate.lastModifiedMs)
      : undefined

    return [{
      name,
      path: filePath,
      kind,
      remoteRootId: configRootId,
      isEmpty: typeof candidate.isEmpty === 'boolean' ? candidate.isEmpty : undefined,
      size: Number.isFinite(Number(candidate.size)) ? Number(candidate.size) : undefined,
      lastModifiedMs,
      lastModified: typeof lastModifiedMs === 'number' ? new Date(lastModifiedMs) : undefined,
      mimeType: typeof candidate.mimeType === 'string' ? candidate.mimeType : undefined,
      previewKind: candidate.previewKind,
      displayPath: typeof candidate.displayPath === 'string' ? candidate.displayPath : filePath,
    }]
  })
}

function toFavoriteFolderEntries(
  roots: RemoteRootEntry[],
  items: Array<{ rootId: string; path: string; favoritedAtMs: number }>,
): FavoriteFolderEntry[] {
  const rootEntryById = buildRootEntryMap(roots)
  return items.flatMap((item) => {
    const rootEntry = rootEntryById.get(item.rootId)
    if (!rootEntry) return []
    return [{
      rootId: toUiRootId(item.rootId),
      rootName: rootEntry.label || ROOT_LABEL_FALLBACK,
      path: normalizeRelativePath(item.path),
      favoritedAt: item.favoritedAtMs,
    }]
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
  const rootEntryByConfigId = useMemo(() => buildRootEntryMap(roots), [roots])
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
        const items = await loadRemoteGatewayFavorites()
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
    const normalizedPath = normalizeRelativePath(targetPath)
    const result = await callRemoteGatewayHttp('/v1/remote/files/list', {
      rootId: configRootId,
      path: normalizedPath,
      flattenView,
    }, 120000)
    setFiles(parseRemoteFileItems(result, configRootId))
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
    const nextPath = currentPath ? `${currentPath}/${dirName}` : dirName
    await navigateToPath(nextPath)
  }, [currentPath, navigateToPath])

  const navigateUp = useCallback(async () => {
    if (!currentPath) return
    const parentPath = currentPath.split('/').filter(Boolean).slice(0, -1).join('/')
    await navigateToPath(parentPath)
  }, [currentPath, navigateToPath])

  const listChildDirectories = useCallback(async (targetPath: string): Promise<string[]> => {
    if (!currentConfigRootId) return []
    const result = await callRemoteGatewayHttp('/v1/remote/files/list', {
      rootId: currentConfigRootId,
      path: normalizeRelativePath(targetPath),
      flattenView: false,
    }, 120000)
    return parseRemoteFileItems(result, currentConfigRootId)
      .filter((item) => item.kind === 'directory')
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))
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
      await removeRemoteGatewayFavorite(configRootId, normalizeRelativePath(entry.path))
      const items = await loadRemoteGatewayFavorites()
      setFavoriteFolders(toFavoriteFolderEntries(roots, items))
    }

    void run().catch((err) => {
      setError((err as Error).message)
    })
  }, [roots])

  const toggleCurrentFolderFavorite = useCallback((): void => {
    if (!rootId) return
    const normalizedPath = normalizeRelativePath(currentPath)
    const configRootId = fromUiRootId(rootId)
    if (!configRootId) return

    const run = async () => {
      const alreadyFavorited = favoriteFolders.some((item) => (
        item.rootId === rootId && normalizeRelativePath(item.path) === normalizedPath
      ))
      if (alreadyFavorited) {
        await removeRemoteGatewayFavorite(configRootId, normalizedPath)
      } else {
        await upsertRemoteGatewayFavorite(configRootId, normalizedPath)
      }
      const items = await loadRemoteGatewayFavorites()
      setFavoriteFolders(toFavoriteFolderEntries(roots, items))
    }

    void run().catch((err) => {
      setError((err as Error).message)
    })
  }, [currentPath, favoriteFolders, rootId, roots])

  const filterFiles = useCallback((inputFiles: FileItem[], filter: FilterState): FileItem[] => {
    let result = [...inputFiles]

    if (filter.hideEmptyFolders) {
      result = result.filter((file) => file.kind === 'file' || !file.isEmpty)
    }

    if (filter.search) {
      const search = filter.search.toLowerCase()
      result = result.filter((file) => file.name.toLowerCase().includes(search))
    }

    if (filter.type !== 'all') {
      result = result.filter((file) => {
        if (filter.type === 'image') return file.kind === 'directory' || isImageFile(file.name)
        if (filter.type === 'video') return file.kind === 'directory' || isVideoFile(file.name)
        return true
      })
    }

    result.sort((left, right) => {
      if (left.kind === 'directory' && right.kind === 'file') return -1
      if (left.kind === 'file' && right.kind === 'directory') return 1

      let cmp = 0
      switch (filter.sortBy) {
        case 'name':
          cmp = left.name.localeCompare(right.name)
          break
        case 'date':
          if (typeof left.lastModifiedMs !== 'number' || typeof right.lastModifiedMs !== 'number') {
            cmp = left.name.localeCompare(right.name)
          } else {
            cmp = left.lastModifiedMs - right.lastModifiedMs
          }
          break
        case 'size':
          if (typeof left.size !== 'number' || typeof right.size !== 'number') {
            cmp = left.name.localeCompare(right.name)
          } else {
            cmp = left.size - right.size
          }
          break
        case 'annotationTime':
          cmp = left.name.localeCompare(right.name)
          break
      }
      return filter.sortOrder === 'asc' ? cmp : -cmp
    })

    return result
  }, [])

  const isCurrentPathFavorited = (() => {
    if (!rootId) return false
    const normalizedPath = normalizeRelativePath(currentPath)
    return favoriteFolders.some((item) => (
      item.rootId === rootId && normalizeRelativePath(item.path) === normalizedPath
    ))
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
