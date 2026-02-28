import { useState, useCallback } from 'react'
import type { FileItem, FilterState } from '@/types'
import { openDirectory, readDirectory, isImageFile, isVideoFile } from '@/lib/fileSystem'

function withBasePath(items: FileItem[], basePath: string): FileItem[] {
  if (!basePath) return items
  return items.map((item) => ({
    ...item,
    path: `${basePath}/${item.path}`,
  }))
}

export function useFileSystem() {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const [currentPath, setCurrentPath] = useState<string>('')
  const [isFlattenView, setIsFlattenView] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const getCurrentDirectoryHandle = useCallback(async () => {
    if (!rootHandle) return null

    let current: FileSystemDirectoryHandle = rootHandle
    if (!currentPath) return current

    const pathParts = currentPath.split('/').filter(Boolean)
    for (const part of pathParts) {
      const opts: FileSystemPermissionDescriptor = { mode: 'read' }
      const permission = await current.queryPermission(opts)
      if (permission === 'prompt') {
        await current.requestPermission(opts)
      }
      current = await current.getDirectoryHandle(part)
    }

    return current
  }, [rootHandle, currentPath])

  const selectDirectory = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const handle = await openDirectory()
      if (!handle) {
        setIsLoading(false)
        return
      }

      setRootHandle(handle)
      setCurrentPath('')
      setIsFlattenView(false)
      await loadDirectoryItems(handle, '', false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [loadDirectoryItems])

  const navigateToDirectory = useCallback(async (dirName: string) => {
    if (!rootHandle) return

    setIsLoading(true)
    setError(null)

    try {
      const current = await getCurrentDirectoryHandle()
      if (!current) return

      const opts: FileSystemPermissionDescriptor = { mode: 'read' }
      const permission = await current.queryPermission(opts)
      if (permission === 'prompt') {
        await current.requestPermission(opts)
      }

      const subDir = await current.getDirectoryHandle(dirName)
      const nextPath = currentPath ? `${currentPath}/${dirName}` : dirName
      setCurrentPath(nextPath)
      await loadDirectoryItems(subDir, nextPath, isFlattenView)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [rootHandle, currentPath, getCurrentDirectoryHandle, isFlattenView, loadDirectoryItems])

  const navigateUp = useCallback(async () => {
    if (!rootHandle || !currentPath) return

    setIsLoading(true)
    setError(null)

    try {
      const pathParts = currentPath.split('/')
      pathParts.pop()

      if (pathParts.length === 0) {
        setCurrentPath('')
        await loadDirectoryItems(rootHandle, '', isFlattenView)
      } else {
        let current: FileSystemDirectoryHandle = rootHandle
        for (const part of pathParts) {
          current = await current.getDirectoryHandle(part)
        }

        const nextPath = pathParts.join('/')
        setCurrentPath(nextPath)
        await loadDirectoryItems(current, nextPath, isFlattenView)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [rootHandle, currentPath, isFlattenView, loadDirectoryItems])

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
          cmp = (a.lastModified?.getTime() || 0) - (b.lastModified?.getTime() || 0)
          break
        case 'size':
          cmp = (a.size || 0) - (b.size || 0)
          break
      }

      return filter.sortOrder === 'asc' ? cmp : -cmp
    })

    return result
  }, [])

  return {
    rootHandle,
    files,
    currentPath,
    isFlattenView,
    isLoading,
    error,
    selectDirectory,
    navigateToDirectory,
    navigateUp,
    setFlattenView,
    filterFiles,
  }
}
