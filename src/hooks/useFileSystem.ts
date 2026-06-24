import { useCallback, useEffect, useRef, useState } from 'react'
import { appConfig } from '@/config/appConfig'
import type {
  AddressPathHistoryEntry,
  CachedRootEntry,
  FavoriteFolderEntry,
  FileItem,
  ListingPageState,
  ListingQueryState,
} from '@/types'
import { openDirectory, readDirectory, isHiddenSystemDirectory } from '@/lib/fileSystem'
import {
  listRuntimeGlobalTrash,
  listRuntimeLocalDirectory,
  listRuntimeRootTrash,
  toRuntimeFileItems,
  toRuntimeGlobalTrashFileItems,
  toRuntimeRootTrashFileItems,
} from '@/lib/runtimeApi'
import {
  getCachedRootHandle,
  listCachedRoots,
  markCachedRootAsUsed,
  removeCachedRoot,
  upsertCachedRootHandle,
} from '@/lib/rootHandleCache'
import {
  ensureRootPath,
  getBoundRootPath,
  getRootPathMapUpdatedEventName,
  listLocalRootBindings,
  syncLocalRootBindingsFromRuntime,
} from '@/lib/reveal'
import {
  isFavoriteFolderActive,
  parseFavoriteFolders,
  removeFavoriteFolder as removeFavoriteFolderEntry,
  toggleFavoriteFolder,
  updateFavoriteFolderRootName,
} from '@/features/explorer/lib/favoriteFolderModel'
import {
  DEFAULT_LISTING_QUERY,
  type RuntimeListingPageCursor,
  isSameListingQuery,
  isSameRuntimeListingPageCursor,
  normalizeListingQuery,
  sortTrashFileItems,
  toRuntimeListingQueryRequest,
} from '@/features/explorer/lib/listingQueryModel'
import { filterExplorerListingFiles } from '@/features/explorer/lib/fileListingFilterModel'

const ROOT_CACHE_MISS_MESSAGE = '历史目录缓存不存在，请重新选择文件夹'
const ROOT_PERMISSION_DENIED_MESSAGE = '目录访问权限不可用，请重新选择文件夹'
const FAVORITE_FOLDERS_STORAGE_KEY = 'fauplay:favorite-folders'
const FAVORITE_FOLDERS_MAX_ITEMS = appConfig.favorites.maxItems
const ROOT_LABEL_FALLBACK = '根目录'
const VIRTUAL_TRASH_PATH = '@trash'
const RUNTIME_LISTING_PAGE_SIZE = 500
const FAVORITE_FOLDER_MODEL_OPTIONS = {
  maxItems: FAVORITE_FOLDERS_MAX_ITEMS,
  rootLabelFallback: ROOT_LABEL_FALLBACK,
}
function withBasePath(items: FileItem[], basePath: string): FileItem[] {
  if (!basePath) return items
  return items.map((item) => ({
    ...item,
    path: `${basePath}/${item.path}`,
  }))
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function rootNameFromPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || ROOT_LABEL_FALLBACK
}

function isVirtualTrashPath(path: string): boolean {
  return normalizeRelativePath(path) === VIRTUAL_TRASH_PATH
}

function createSessionRootId(handle: FileSystemDirectoryHandle): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `session:${handle.name}:${suffix}`
}

interface NavigateToPathOptions {
  resetFlattenView?: boolean
}

interface LoadDirectoryItemsOptions {
  rootId?: string | null
  resolveDirectoryHandle?: () => Promise<FileSystemDirectoryHandle | null>
}

function saveFavoriteFolders(entries: FavoriteFolderEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FAVORITE_FOLDERS_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

function loadFavoriteFolders(): FavoriteFolderEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = parseFavoriteFolders(
      window.localStorage.getItem(FAVORITE_FOLDERS_STORAGE_KEY),
      FAVORITE_FOLDER_MODEL_OPTIONS
    )
    if (parsed.shouldRewrite) {
      saveFavoriteFolders(parsed.entries)
    }
    return parsed.entries
  } catch {
    return []
  }
}

export function useFileSystem() {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [rootId, setRootId] = useState<string | null>(null)
  const [rootName, setRootName] = useState<string>(ROOT_LABEL_FALLBACK)
  const [cachedRoots, setCachedRoots] = useState<CachedRootEntry[]>([])
  const [isCachedRootsReady, setIsCachedRootsReady] = useState(false)
  const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolderEntry[]>(() => loadFavoriteFolders())
  const [files, setFiles] = useState<FileItem[]>([])
  const [listingQuery, setListingQueryState] = useState<ListingQueryState>(DEFAULT_LISTING_QUERY)
  const [runtimeListingPageCursor, setRuntimeListingPageCursor] = useState<RuntimeListingPageCursor | null>(null)
  const [isLoadingNextListingPage, setIsLoadingNextListingPage] = useState(false)
  const listingQueryRef = useRef<ListingQueryState>(DEFAULT_LISTING_QUERY)
  const runtimeListingPageCursorRef = useRef<RuntimeListingPageCursor | null>(null)
  const [currentPath, setCurrentPath] = useState<string>('')
  const [isFlattenView, setIsFlattenView] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshCachedRoots = useCallback(async () => {
    await syncLocalRootBindingsFromRuntime()

    const entries = await listCachedRoots()
    const cachedEntriesByRootId = new Map<string, CachedRootEntry>()
    for (const entry of entries) {
      cachedEntriesByRootId.set(entry.rootId, {
        ...entry,
        boundRootPath: getBoundRootPath(entry.rootId) ?? undefined,
      })
    }

    for (const binding of listLocalRootBindings()) {
      const existing = cachedEntriesByRootId.get(binding.rootId)
      if (existing) {
        cachedEntriesByRootId.set(binding.rootId, {
          ...existing,
          boundRootPath: binding.rootPath,
        })
        continue
      }

      cachedEntriesByRootId.set(binding.rootId, {
        rootId: binding.rootId,
        rootName: rootNameFromPath(binding.rootPath),
        lastUsedAt: 0,
        boundRootPath: binding.rootPath,
      })
    }

    setCachedRoots([...cachedEntriesByRootId.values()])
    setIsCachedRootsReady(true)
  }, [])

  useEffect(() => {
    void refreshCachedRoots()
  }, [refreshCachedRoots])

  useEffect(() => {
    runtimeListingPageCursorRef.current = runtimeListingPageCursor
  }, [runtimeListingPageCursor])

  useEffect(() => {
    listingQueryRef.current = listingQuery
  }, [listingQuery])

  useEffect(() => {
    const eventName = getRootPathMapUpdatedEventName()
    const handleRootPathMapUpdated = () => {
      void refreshCachedRoots()
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'fauplay:host-root-path-map') return
      void refreshCachedRoots()
    }

    window.addEventListener(eventName, handleRootPathMapUpdated)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(eventName, handleRootPathMapUpdated)
      window.removeEventListener('storage', handleStorage)
    }
  }, [refreshCachedRoots])

  useEffect(() => {
    saveFavoriteFolders(favoriteFolders)
  }, [favoriteFolders])

  const loadDirectoryItems = useCallback(async (
    dirHandle: FileSystemDirectoryHandle | null,
    basePath: string,
    flattenView: boolean,
    options: LoadDirectoryItemsOptions = {}
  ) => {
    const boundRootPath = options.rootId ? getBoundRootPath(options.rootId) : null
    if (boundRootPath) {
      try {
        const activeListingQuery = listingQueryRef.current
        const runtimeListing = await listRuntimeLocalDirectory({
          rootPath: boundRootPath,
          rootRelativePath: basePath,
          flattened: flattenView,
          limit: RUNTIME_LISTING_PAGE_SIZE,
          ...toRuntimeListingQueryRequest(activeListingQuery),
        })
        setFiles(toRuntimeFileItems(runtimeListing.entries, boundRootPath))
        setRuntimeListingPageCursor(runtimeListing.isTruncated && runtimeListing.nextOffset !== null
          ? {
              rootPath: boundRootPath,
              rootRelativePath: normalizeRelativePath(basePath),
              flattened: flattenView,
              query: activeListingQuery,
              nextOffset: runtimeListing.nextOffset,
            }
          : null)
        return
      } catch {
        // Fall back to File System Access while the runtime-backed Listing path is being adopted.
      }
    }

    setRuntimeListingPageCursor(null)

    const fallbackHandle = dirHandle ?? await options.resolveDirectoryHandle?.() ?? null
    if (!fallbackHandle) {
      throw new Error(ROOT_PERMISSION_DENIED_MESSAGE)
    }

    const result = await readDirectory(fallbackHandle, flattenView)
    if (flattenView) {
      setFiles(withBasePath(result.files, basePath))
      return
    }

    const allItems = [...result.directories, ...result.files]
    setFiles(withBasePath(allItems, basePath))
  }, [])

  const loadNextListingPage = useCallback(async (): Promise<void> => {
    const cursor = runtimeListingPageCursorRef.current
    if (!cursor || isLoadingNextListingPage) return

    setIsLoadingNextListingPage(true)
    setError(null)

    try {
      const runtimeListing = await listRuntimeLocalDirectory({
        rootPath: cursor.rootPath,
        rootRelativePath: cursor.rootRelativePath,
        flattened: cursor.flattened,
        limit: RUNTIME_LISTING_PAGE_SIZE,
        offset: cursor.nextOffset,
        ...toRuntimeListingQueryRequest(cursor.query),
      })

      if (!isSameRuntimeListingPageCursor(runtimeListingPageCursorRef.current, cursor)) {
        return
      }

      const nextItems = toRuntimeFileItems(runtimeListing.entries, cursor.rootPath)
      setFiles((previous) => {
        const existingPaths = new Set(previous.map((item) => item.path))
        const appendedItems = nextItems.filter((item) => !existingPaths.has(item.path))
        if (appendedItems.length === 0) return previous
        return [...previous, ...appendedItems]
      })
      setRuntimeListingPageCursor(runtimeListing.isTruncated && runtimeListing.nextOffset !== null
        ? {
            ...cursor,
            nextOffset: runtimeListing.nextOffset,
          }
        : null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoadingNextListingPage(false)
    }
  }, [isLoadingNextListingPage])

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

    setFiles(nextFiles)
    setRuntimeListingPageCursor(null)
    setCurrentPath(VIRTUAL_TRASH_PATH)
    setIsFlattenView(false)
    if (targetRootHandle) {
      setRootHandle(targetRootHandle)
    }
    if (targetRootId) {
      setRootId(targetRootId)
    }
  }, [])

  const ensureDirectoryReadable = useCallback(async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
    const opts: FileSystemPermissionDescriptor = { mode: 'read' }
    const permission = await handle.queryPermission(opts)
    if (permission === 'granted') return true
    if (permission === 'denied') return false

    const requested = await handle.requestPermission(opts)
    return requested === 'granted'
  }, [])

  const getDirectoryHandleByPathFromRoot = useCallback(async (
    baseRoot: FileSystemDirectoryHandle,
    targetPath: string
  ) => {
    let current: FileSystemDirectoryHandle = baseRoot
    const normalizedPath = normalizeRelativePath(targetPath)
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

  const activateRootHandle = useCallback(async (
    nextRootHandle: FileSystemDirectoryHandle,
    nextRootId: string,
    targetPath: string
  ) => {
    const normalizedPath = normalizeRelativePath(targetPath)
    if (isVirtualTrashPath(normalizedPath)) {
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
    const normalizedPath = normalizeRelativePath(targetPath)
    if (isVirtualTrashPath(normalizedPath)) {
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

  const warmupRootPathBinding = useCallback((targetRootId: string, targetRootLabel: string) => {
    try {
      ensureRootPath({
        rootId: targetRootId,
        rootLabel: targetRootLabel || '根目录',
        promptIfMissing: true,
      })
    } catch {
      // ignore mapping warmup errors, plugin call can still prompt on demand
    }
  }, [])

  const getDirectoryHandleByPath = useCallback(async (targetPath: string) => {
    if (!rootHandle) return null
    return getDirectoryHandleByPathFromRoot(rootHandle, targetPath)
  }, [rootHandle, getDirectoryHandleByPathFromRoot])

  const getCurrentDirectoryHandle = useCallback(async () => {
    return getDirectoryHandleByPath(currentPath)
  }, [getDirectoryHandleByPath, currentPath])

  const setListingQuery = useCallback(async (nextQuery: ListingQueryState): Promise<void> => {
    const normalizedQuery = normalizeListingQuery(nextQuery)
    if (isSameListingQuery(listingQueryRef.current, normalizedQuery)) return

    listingQueryRef.current = normalizedQuery
    setListingQueryState(normalizedQuery)
    setRuntimeListingPageCursor(null)

    if (!rootId || isVirtualTrashPath(currentPath)) return
    if (!getBoundRootPath(rootId)) return

    setIsLoading(true)
    setError(null)
    try {
      await loadDirectoryItems(null, currentPath, isFlattenView, {
        rootId,
        resolveDirectoryHandle: getCurrentDirectoryHandle,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [currentPath, getCurrentDirectoryHandle, isFlattenView, loadDirectoryItems, rootId])

  const listChildDirectories = useCallback(async (targetPath: string): Promise<string[]> => {
    const normalizedPath = normalizeRelativePath(targetPath)
    if (isVirtualTrashPath(normalizedPath)) {
      return []
    }

    const boundRootPath = rootId ? getBoundRootPath(rootId) : null
    if (boundRootPath) {
      try {
        const runtimeListing = await listRuntimeLocalDirectory({
          rootPath: boundRootPath,
          rootRelativePath: normalizedPath,
        })
        return runtimeListing.entries
          .filter((entry) => entry.kind === 'directory')
          .map((entry) => entry.name)
          .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))
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

    directoryNames.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))
    return directoryNames
  }, [rootHandle, rootId, getDirectoryHandleByPath])

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
      const targetRoot = cachedRoots.find((item) => item.rootId === targetRootId)
      const cachedHandle = await getCachedRootHandle(targetRootId)
      if (!cachedHandle) {
        const boundRootPath = targetRoot?.boundRootPath ?? getBoundRootPath(targetRootId)
        if (!boundRootPath) {
          await removeCachedRoot(targetRootId)
          await refreshCachedRoots()
          setError(ROOT_CACHE_MISS_MESSAGE)
          return false
        }

        await activateRuntimeRoot(targetRootId, targetRoot?.rootName || ROOT_LABEL_FALLBACK, '')
        await refreshCachedRoots()
        return true
      }

      const granted = await ensureDirectoryReadable(cachedHandle)
      if (!granted) {
        await removeCachedRoot(targetRootId)
        await refreshCachedRoots()
        setError(ROOT_PERMISSION_DENIED_MESSAGE)
        return false
      }

      warmupRootPathBinding(targetRootId, cachedHandle.name)
      await activateRootHandle(cachedHandle, targetRootId, '')
      await markCachedRootAsUsed(targetRootId)
      await refreshCachedRoots()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [activateRootHandle, activateRuntimeRoot, cachedRoots, ensureDirectoryReadable, refreshCachedRoots, warmupRootPathBinding])

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

    const normalizedPath = normalizeRelativePath(targetPath)
    const nextFlattenView = options.resetFlattenView ? false : isFlattenView

    setIsLoading(true)
    setError(null)

    try {
      if (isVirtualTrashPath(normalizedPath)) {
        await loadUnifiedTrashItems(rootId, rootHandle)
        return true
      }
      await loadDirectoryItems(null, normalizedPath, nextFlattenView, {
        rootId,
        resolveDirectoryHandle: () => getDirectoryHandleByPath(normalizedPath),
      })
      setCurrentPath(normalizedPath)
      if (options.resetFlattenView) {
        setIsFlattenView(false)
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

    const normalizedPath = normalizeRelativePath(targetPath)
    if (rootId === targetRootId) {
      return navigateToPath(normalizedPath, { resetFlattenView: true })
    }

    setIsLoading(true)
    setError(null)

    try {
      const targetRoot = cachedRoots.find((item) => item.rootId === targetRootId)
      const cachedHandle = await getCachedRootHandle(targetRootId)
      if (!cachedHandle) {
        const boundRootPath = targetRoot?.boundRootPath ?? getBoundRootPath(targetRootId)
        if (!boundRootPath) {
          await removeCachedRoot(targetRootId)
          await refreshCachedRoots()
          setError(ROOT_CACHE_MISS_MESSAGE)
          return false
        }

        await activateRuntimeRoot(targetRootId, targetRoot?.rootName || ROOT_LABEL_FALLBACK, normalizedPath)
        await refreshCachedRoots()
        return true
      }

      const granted = await ensureDirectoryReadable(cachedHandle)
      if (!granted) {
        await removeCachedRoot(targetRootId)
        await refreshCachedRoots()
        setError(ROOT_PERMISSION_DENIED_MESSAGE)
        return false
      }

      warmupRootPathBinding(targetRootId, cachedHandle.name)
      await activateRootHandle(cachedHandle, targetRootId, normalizedPath)
      await markCachedRootAsUsed(targetRootId)
      await refreshCachedRoots()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [
    activateRootHandle,
    activateRuntimeRoot,
    cachedRoots,
    ensureDirectoryReadable,
    navigateToPath,
    refreshCachedRoots,
    rootId,
    warmupRootPathBinding,
  ])

  const openHistoryEntry = useCallback((entry: AddressPathHistoryEntry): Promise<boolean> => {
    return openPathInRoot(entry.rootId, entry.path)
  }, [openPathInRoot])

  const openFavoriteFolder = useCallback((entry: FavoriteFolderEntry): Promise<boolean> => {
    return openPathInRoot(entry.rootId, entry.path)
  }, [openPathInRoot])

  const removeFavoriteFolder = useCallback((entry: FavoriteFolderEntry): void => {
    setFavoriteFolders((previous) => removeFavoriteFolderEntry(previous, entry))
  }, [])

  const toggleCurrentFolderFavorite = useCallback((): void => {
    if (!rootId) return
    setFavoriteFolders((previous) => (
      toggleFavoriteFolder(previous, {
        rootId,
        rootName: rootName || ROOT_LABEL_FALLBACK,
        path: currentPath,
        favoritedAt: Date.now(),
        ...FAVORITE_FOLDER_MODEL_OPTIONS,
        virtualTrashPath: VIRTUAL_TRASH_PATH,
      })
    ))
  }, [currentPath, rootId, rootName])

  useEffect(() => {
    if (!rootId) return
    setFavoriteFolders((previous) => updateFavoriteFolderRootName(previous, {
      rootId,
      rootName,
      ...FAVORITE_FOLDER_MODEL_OPTIONS,
    }))
  }, [rootId, rootName])

  const navigateToDirectory = useCallback(async (dirName: string) => {
    const nextPath = currentPath ? `${currentPath}/${dirName}` : dirName
    await navigateToPath(nextPath)
  }, [currentPath, navigateToPath])

  const navigateUp = useCallback(async () => {
    if (isVirtualTrashPath(currentPath)) {
      await navigateToPath('')
      return
    }
    if (!currentPath) return
    const parentPath = currentPath.split('/').filter(Boolean).slice(0, -1).join('/')
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

  const isCurrentPathFavorited = (() => {
    return isFavoriteFolderActive(favoriteFolders, {
      rootId,
      path: currentPath,
      virtualTrashPath: VIRTUAL_TRASH_PATH,
    })
  })()

  const listingPage: ListingPageState = {
    hasNextPage: runtimeListingPageCursor !== null,
    isLoadingNextPage: isLoadingNextListingPage,
  }

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
