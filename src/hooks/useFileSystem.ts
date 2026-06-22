import { useCallback, useEffect, useRef, useState } from 'react'
import { appConfig } from '@/config/appConfig'
import { callGatewayHttp } from '@/lib/gateway'
import type {
  AddressPathHistoryEntry,
  CachedRootEntry,
  FavoriteFolderEntry,
  FileItem,
  FilterState,
  ListingPageState,
  ListingQueryState,
} from '@/types'
import { openDirectory, readDirectory, isHiddenSystemDirectory, isImageFile, isVideoFile } from '@/lib/fileSystem'
import { listRuntimeLocalDirectory, toRuntimeFileItems } from '@/lib/runtimeApi'
import {
  getCachedRootHandle,
  listCachedRoots,
  markCachedRootAsUsed,
  removeCachedRoot,
  upsertCachedRootHandle,
} from '@/lib/rootHandleCache'
import { ensureRootPath, getBoundRootPath, getRootPathMapUpdatedEventName } from '@/lib/reveal'

const ROOT_CACHE_MISS_MESSAGE = '历史目录缓存不存在，请重新选择文件夹'
const ROOT_PERMISSION_DENIED_MESSAGE = '目录访问权限不可用，请重新选择文件夹'
const FAVORITE_FOLDERS_STORAGE_KEY = 'fauplay:favorite-folders'
const FAVORITE_FOLDERS_MAX_ITEMS = appConfig.favorites.maxItems
const ROOT_LABEL_FALLBACK = '根目录'
const VIRTUAL_TRASH_PATH = '@trash'
const RUNTIME_LISTING_PAGE_SIZE = 500
const DEFAULT_LISTING_QUERY: ListingQueryState = {
  search: '',
  type: 'all',
  hideEmptyFolders: false,
  sortBy: 'name',
  sortOrder: 'asc',
}

interface RuntimeListingPageCursor {
  rootPath: string
  rootRelativePath: string
  flattened: boolean
  query: ListingQueryState
  nextOffset: number
}

interface RecycleListItem {
  path?: string
  absolutePath?: string
  name?: string
  size?: number
  mimeType?: string
  previewKind?: string
  displayPath?: string
  deletedAt?: number
  sourceType?: string
  sourceRootPath?: string
  sourceRelativePath?: string
  recycleId?: string
  originalAbsolutePath?: string
  lastModifiedMs?: number
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

function isVirtualTrashPath(path: string): boolean {
  return normalizeRelativePath(path) === VIRTUAL_TRASH_PATH
}

function normalizeListingQuery(query: ListingQueryState): ListingQueryState {
  return {
    search: query.search.trim(),
    type: query.type === 'image' || query.type === 'video' ? query.type : 'all',
    hideEmptyFolders: query.hideEmptyFolders === true,
    sortBy: query.sortBy === 'date' || query.sortBy === 'size' ? query.sortBy : 'name',
    sortOrder: query.sortOrder === 'desc' ? 'desc' : 'asc',
  }
}

function isSameListingQuery(left: ListingQueryState, right: ListingQueryState): boolean {
  return (
    left.search === right.search
    && left.type === right.type
    && left.hideEmptyFolders === right.hideEmptyFolders
    && left.sortBy === right.sortBy
    && left.sortOrder === right.sortOrder
  )
}

function toRuntimeListingQueryRequest(query: ListingQueryState) {
  return {
    nameContains: query.search,
    entryFilter: query.type,
    hideEmptyFolders: query.hideEmptyFolders,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  }
}

function isSameRuntimeListingPageCursor(
  left: RuntimeListingPageCursor | null,
  right: RuntimeListingPageCursor
): boolean {
  return Boolean(
    left
    && left.rootPath === right.rootPath
    && left.rootRelativePath === right.rootRelativePath
    && left.flattened === right.flattened
    && isSameListingQuery(left.query, right.query)
    && left.nextOffset === right.nextOffset
  )
}

function toTrashFileItem(item: RecycleListItem): FileItem | null {
  const absolutePath = typeof item.absolutePath === 'string' ? item.absolutePath.trim() : ''
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!absolutePath || !name) {
    return null
  }

  const filePath = typeof item.path === 'string' && item.path.trim()
    ? item.path.trim()
    : absolutePath
  const lastModifiedMs = Number.isFinite(Number(item.lastModifiedMs))
    ? Number(item.lastModifiedMs)
    : (Number.isFinite(Number(item.deletedAt)) ? Number(item.deletedAt) : undefined)

  return {
    name,
    path: filePath,
    kind: 'file',
    absolutePath,
    size: Number.isFinite(Number(item.size)) ? Number(item.size) : undefined,
    mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
    previewKind: (
      item.previewKind === 'image'
      || item.previewKind === 'video'
      || item.previewKind === 'text'
    ) ? item.previewKind : 'unsupported',
    displayPath: typeof item.displayPath === 'string' ? item.displayPath : absolutePath,
    deletedAt: Number.isFinite(Number(item.deletedAt)) ? Number(item.deletedAt) : undefined,
    sourceType: typeof item.sourceType === 'string' ? item.sourceType : undefined,
    sourceRootPath: typeof item.sourceRootPath === 'string' ? item.sourceRootPath : undefined,
    sourceRelativePath: typeof item.sourceRelativePath === 'string' ? item.sourceRelativePath : undefined,
    recycleId: typeof item.recycleId === 'string' ? item.recycleId : undefined,
    originalAbsolutePath: typeof item.originalAbsolutePath === 'string' ? item.originalAbsolutePath : undefined,
    lastModifiedMs,
    lastModified: typeof lastModifiedMs === 'number' ? new Date(lastModifiedMs) : undefined,
  }
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

function dedupeFavoriteFolders(entries: FavoriteFolderEntry[]): FavoriteFolderEntry[] {
  const latestEntryByKey = new Map<string, FavoriteFolderEntry>()

  for (const item of entries) {
    if (!item.rootId) continue
    const normalizedPath = normalizeRelativePath(item.path)
    const favoritedAt = Number.isFinite(item.favoritedAt) ? item.favoritedAt : 0
    const key = `${item.rootId}:${normalizedPath}`
    const existing = latestEntryByKey.get(key)
    if (!existing || favoritedAt > existing.favoritedAt) {
      latestEntryByKey.set(key, {
        rootId: item.rootId,
        rootName: item.rootName || ROOT_LABEL_FALLBACK,
        path: normalizedPath,
        favoritedAt,
      })
    }
  }

  return [...latestEntryByKey.values()]
    .sort((left, right) => right.favoritedAt - left.favoritedAt)
    .slice(0, FAVORITE_FOLDERS_MAX_ITEMS)
}

interface ParsedFavoriteFolders {
  entries: FavoriteFolderEntry[]
  shouldRewrite: boolean
}

function parseFavoriteFolders(raw: string | null): ParsedFavoriteFolders {
  if (!raw) return { entries: [], shouldRewrite: false }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return { entries: [], shouldRewrite: true }

    let hasInvalidEntry = false
    let hasFallbackRootName = false
    const validEntries: FavoriteFolderEntry[] = []

    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        hasInvalidEntry = true
        continue
      }
      const candidate = item as Partial<FavoriteFolderEntry>
      if (
        typeof candidate.rootId !== 'string'
        || typeof candidate.path !== 'string'
        || typeof candidate.favoritedAt !== 'number'
      ) {
        hasInvalidEntry = true
        continue
      }

      if (typeof candidate.rootName !== 'string') {
        hasFallbackRootName = true
      }
      validEntries.push({
        rootId: candidate.rootId,
        rootName: candidate.rootName || ROOT_LABEL_FALLBACK,
        path: candidate.path,
        favoritedAt: candidate.favoritedAt,
      })
    }

    const dedupedEntries = dedupeFavoriteFolders(validEntries)
    return {
      entries: dedupedEntries,
      shouldRewrite: hasInvalidEntry || hasFallbackRootName || dedupedEntries.length !== validEntries.length,
    }
  } catch {
    return { entries: [], shouldRewrite: true }
  }
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
    const parsed = parseFavoriteFolders(window.localStorage.getItem(FAVORITE_FOLDERS_STORAGE_KEY))
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
    const entries = await listCachedRoots()
    setCachedRoots(entries.map((entry) => ({
      ...entry,
      boundRootPath: getBoundRootPath(entry.rootId) ?? undefined,
    })))
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
        setFiles(toRuntimeFileItems(runtimeListing.entries))
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

      const nextItems = toRuntimeFileItems(runtimeListing.entries)
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
    const response = await callGatewayHttp<{ items?: RecycleListItem[] }>('/v1/recycle/items/list', {
      ...(boundRootPath ? { rootPath: boundRootPath } : {}),
      includeRootTrash: true,
      includeGlobalRecycle: true,
    }, 120000)
    const nextFiles = Array.isArray(response.items)
      ? response.items
        .map((item) => toTrashFileItem(item))
        .filter((item): item is FileItem => item !== null)
      : []

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
    setCurrentPath(normalizedPath)
    setIsFlattenView(false)
  }, [getDirectoryHandleByPathFromRoot, loadDirectoryItems, loadUnifiedTrashItems])

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

    if (!rootHandle || !rootId || isVirtualTrashPath(currentPath)) return
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
  }, [currentPath, getCurrentDirectoryHandle, isFlattenView, loadDirectoryItems, rootHandle, rootId])

  const listChildDirectories = useCallback(async (targetPath: string): Promise<string[]> => {
    if (!rootHandle) return []

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
      const cachedHandle = await getCachedRootHandle(targetRootId)
      if (!cachedHandle) {
        await removeCachedRoot(targetRootId)
        await refreshCachedRoots()
        setError(ROOT_CACHE_MISS_MESSAGE)
        return false
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
  }, [activateRootHandle, ensureDirectoryReadable, refreshCachedRoots, warmupRootPathBinding])

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
    if (!rootHandle) return false

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
    if (rootHandle && rootId === targetRootId) {
      return navigateToPath(normalizedPath, { resetFlattenView: true })
    }

    setIsLoading(true)
    setError(null)

    try {
      const cachedHandle = await getCachedRootHandle(targetRootId)
      if (!cachedHandle) {
        await removeCachedRoot(targetRootId)
        await refreshCachedRoots()
        setError(ROOT_CACHE_MISS_MESSAGE)
        return false
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
    ensureDirectoryReadable,
    navigateToPath,
    refreshCachedRoots,
    rootHandle,
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
    const targetPath = normalizeRelativePath(entry.path)
    const targetKey = `${entry.rootId}:${targetPath}`
    setFavoriteFolders((previous) => previous.filter((item) => {
      const key = `${item.rootId}:${normalizeRelativePath(item.path)}`
      return key !== targetKey
    }))
  }, [])

  const toggleCurrentFolderFavorite = useCallback((): void => {
    if (!rootId) return
    const normalizedPath = normalizeRelativePath(currentPath)
    if (isVirtualTrashPath(normalizedPath)) return
    const targetKey = `${rootId}:${normalizedPath}`

    setFavoriteFolders((previous) => {
      const alreadyFavorited = previous.some((item) => {
        const key = `${item.rootId}:${normalizeRelativePath(item.path)}`
        return key === targetKey
      })
      if (alreadyFavorited) {
        return previous.filter((item) => {
          const key = `${item.rootId}:${normalizeRelativePath(item.path)}`
          return key !== targetKey
        })
      }

      return dedupeFavoriteFolders([{
        rootId,
        rootName: rootHandle?.name || ROOT_LABEL_FALLBACK,
        path: normalizedPath,
        favoritedAt: Date.now(),
      }, ...previous])
    })
  }, [currentPath, rootHandle, rootId])

  useEffect(() => {
    if (!rootId) return
    const latestRootName = rootHandle?.name || ROOT_LABEL_FALLBACK

    setFavoriteFolders((previous) => {
      let hasChanged = false
      const updated = previous.map((item) => {
        if (item.rootId !== rootId || item.rootName === latestRootName) {
          return item
        }
        hasChanged = true
        return {
          ...item,
          rootName: latestRootName,
        }
      })
      if (!hasChanged) return previous
      return dedupeFavoriteFolders(updated)
    })
  }, [rootHandle, rootId])

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
    if (!rootHandle) return

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
  }, [rootHandle, getCurrentDirectoryHandle, loadDirectoryItems, currentPath, rootId])

  const filterFiles = useCallback((files: FileItem[], filter: FilterState): FileItem[] => {
    let result = [...files]

    if (filter.hideEmptyFolders) {
      result = result.filter(f => f.kind === 'file' || !f.isEmpty)
    }

    if (filter.search) {
      const search = filter.search.toLowerCase()
      result = result.filter(f => f.name.toLowerCase().includes(search))
    }

    if (filter.type !== 'all') {
      result = result.filter(f => {
        if (filter.type === 'image') return f.kind === 'directory' || isImageFile(f.name)
        if (filter.type === 'video') return f.kind === 'directory' || isVideoFile(f.name)
        return true
      })
    }

    result.sort((a, b) => {
      if (a.kind === 'directory' && b.kind === 'file') return -1
      if (a.kind === 'file' && b.kind === 'directory') return 1

      let cmp = 0
      switch (filter.sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'date':
          if (!a.lastModified || !b.lastModified) {
            cmp = a.name.localeCompare(b.name)
          } else {
            cmp = a.lastModified.getTime() - b.lastModified.getTime()
          }
          break
        case 'size':
          if (typeof a.size !== 'number' || typeof b.size !== 'number') {
            cmp = a.name.localeCompare(b.name)
          } else {
            cmp = a.size - b.size
          }
          break
        case 'annotationTime':
          cmp = a.name.localeCompare(b.name)
          break
      }

      return filter.sortOrder === 'asc' ? cmp : -cmp
    })

    return result
  }, [])

  const isCurrentPathFavorited = (() => {
    if (!rootId) return false
    const normalizedPath = normalizeRelativePath(currentPath)
    if (isVirtualTrashPath(normalizedPath)) return false
    return favoriteFolders.some((item) => {
      return item.rootId === rootId && normalizeRelativePath(item.path) === normalizedPath
    })
  })()

  const listingPage: ListingPageState = {
    hasNextPage: runtimeListingPageCursor !== null,
    isLoadingNextPage: isLoadingNextListingPage,
  }

  return {
    rootHandle,
    rootId,
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
