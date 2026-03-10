import { useCallback, useEffect, useState } from 'react'
import type { AddressPathHistoryEntry, CachedRootEntry, FileItem, FilterState } from '@/types'
import { openDirectory, readDirectory, isHiddenSystemDirectory, isImageFile, isVideoFile } from '@/lib/fileSystem'
import {
  getCachedRootHandle,
  listCachedRoots,
  markCachedRootAsUsed,
  removeCachedRoot,
  upsertCachedRootHandle,
} from '@/lib/rootHandleCache'
import { ensureRootPath } from '@/lib/reveal'

const ROOT_CACHE_MISS_MESSAGE = '历史目录缓存不存在，请重新选择文件夹'
const ROOT_PERMISSION_DENIED_MESSAGE = '目录访问权限不可用，请重新选择文件夹'

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
  const [cachedRoots, setCachedRoots] = useState<CachedRootEntry[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [currentPath, setCurrentPath] = useState<string>('')
  const [isFlattenView, setIsFlattenView] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshCachedRoots = useCallback(async () => {
    const entries = await listCachedRoots()
    setCachedRoots(entries)
  }, [])

  useEffect(() => {
    void refreshCachedRoots()
  }, [refreshCachedRoots])

  const loadDirectoryItems = useCallback(async (
    dirHandle: FileSystemDirectoryHandle,
    basePath: string,
    flattenView: boolean
  ) => {
    const result = await readDirectory(dirHandle, flattenView)
    if (flattenView) {
      setFiles(withBasePath(result.files, basePath))
      return
    }

    const allItems = [...result.directories, ...result.files]
    setFiles(withBasePath(allItems, basePath))
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
    const targetDirectory = await getDirectoryHandleByPathFromRoot(nextRootHandle, normalizedPath)
    await loadDirectoryItems(targetDirectory, normalizedPath, false)
    setRootHandle(nextRootHandle)
    setRootId(nextRootId)
    setCurrentPath(normalizedPath)
    setIsFlattenView(false)
  }, [getDirectoryHandleByPathFromRoot, loadDirectoryItems])

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

  const listChildDirectories = useCallback(async (targetPath: string): Promise<string[]> => {
    if (!rootHandle) return []

    const normalizedPath = normalizeRelativePath(targetPath)
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
  }, [rootHandle, getDirectoryHandleByPath])

  const selectDirectory = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const handle = await openDirectory()
      if (!handle) return

      const cached = await upsertCachedRootHandle(handle).catch(() => null)
      const resolvedRootId = cached?.rootId ?? createSessionRootId(handle)

      await activateRootHandle(handle, resolvedRootId, '')
      warmupRootPathBinding(resolvedRootId, handle.name)
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

      await activateRootHandle(cachedHandle, targetRootId, '')
      await markCachedRootAsUsed(targetRootId)
      warmupRootPathBinding(targetRootId, cachedHandle.name)
      await refreshCachedRoots()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [activateRootHandle, ensureDirectoryReadable, refreshCachedRoots, warmupRootPathBinding])

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
      const targetDirectory = await getDirectoryHandleByPath(normalizedPath)
      if (!targetDirectory) return false
      await loadDirectoryItems(targetDirectory, normalizedPath, nextFlattenView)
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
  }, [rootHandle, isFlattenView, getDirectoryHandleByPath, loadDirectoryItems])

  const openHistoryEntry = useCallback(async (entry: AddressPathHistoryEntry): Promise<boolean> => {
    if (!entry.rootId) return false

    const normalizedPath = normalizeRelativePath(entry.path)
    if (rootHandle && rootId === entry.rootId) {
      return navigateToPath(normalizedPath, { resetFlattenView: true })
    }

    setIsLoading(true)
    setError(null)

    try {
      const cachedHandle = await getCachedRootHandle(entry.rootId)
      if (!cachedHandle) {
        await removeCachedRoot(entry.rootId)
        await refreshCachedRoots()
        setError(ROOT_CACHE_MISS_MESSAGE)
        return false
      }

      const granted = await ensureDirectoryReadable(cachedHandle)
      if (!granted) {
        await removeCachedRoot(entry.rootId)
        await refreshCachedRoots()
        setError(ROOT_PERMISSION_DENIED_MESSAGE)
        return false
      }

      await activateRootHandle(cachedHandle, entry.rootId, normalizedPath)
      await markCachedRootAsUsed(entry.rootId)
      warmupRootPathBinding(entry.rootId, cachedHandle.name)
      await refreshCachedRoots()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [activateRootHandle, ensureDirectoryReadable, navigateToPath, refreshCachedRoots, rootHandle, rootId, warmupRootPathBinding])

  const navigateToDirectory = useCallback(async (dirName: string) => {
    const nextPath = currentPath ? `${currentPath}/${dirName}` : dirName
    await navigateToPath(nextPath)
  }, [currentPath, navigateToPath])

  const navigateUp = useCallback(async () => {
    if (!currentPath) return
    const parentPath = currentPath.split('/').filter(Boolean).slice(0, -1).join('/')
    await navigateToPath(parentPath)
  }, [currentPath, navigateToPath])

  const setFlattenView = useCallback(async (flattenView: boolean) => {
    if (!rootHandle) return

    setIsLoading(true)
    setError(null)
    try {
      const current = await getCurrentDirectoryHandle()
      if (!current) return
      await loadDirectoryItems(current, currentPath, flattenView)
      setIsFlattenView(flattenView)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [rootHandle, getCurrentDirectoryHandle, loadDirectoryItems, currentPath])

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
      }

      return filter.sortOrder === 'asc' ? cmp : -cmp
    })

    return result
  }, [])

  return {
    rootHandle,
    rootId,
    cachedRoots,
    files,
    currentPath,
    isFlattenView,
    isLoading,
    error,
    selectDirectory,
    openCachedRoot,
    openHistoryEntry,
    navigateToPath,
    navigateToDirectory,
    navigateUp,
    listChildDirectories,
    setFlattenView,
    filterFiles,
  }
}
