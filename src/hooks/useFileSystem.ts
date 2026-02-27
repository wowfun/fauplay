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
  const [rootHandle, setRootHandle] = useState<any>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const [currentPath, setCurrentPath] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

      const result = await readDirectory(handle, false)
      const allItems = [...result.directories, ...result.files]
      setFiles(withBasePath(allItems, ''))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const navigateToDirectory = useCallback(async (dirName: string) => {
    if (!rootHandle) return

    setIsLoading(true)
    setError(null)

    try {
      let current: any = rootHandle
      
      if (currentPath) {
        const pathParts = currentPath.split('/')
        for (const part of pathParts) {
          const opts: any = { mode: 'read' }
          const permission = await (current as any).queryPermission(opts)
          if (permission === 'prompt') {
            await (current as any).requestPermission(opts)
          }
          current = await current.getDirectoryHandle(part)
        }
      }

      const opts: any = { mode: 'read' }
      const permission = await current.queryPermission(opts)
      if (permission === 'prompt') {
        await current.requestPermission(opts)
      }
      
      const subDir = await current.getDirectoryHandle(dirName)
      const result = await readDirectory(subDir, false)
      const allItems = [...result.directories, ...result.files]
      const nextPath = currentPath ? `${currentPath}/${dirName}` : dirName
      setFiles(withBasePath(allItems, nextPath))
      setCurrentPath(nextPath)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [rootHandle, currentPath])

  const navigateUp = useCallback(async () => {
    if (!rootHandle || !currentPath) return

    setIsLoading(true)
    setError(null)

    try {
      const pathParts = currentPath.split('/')
      pathParts.pop()

      if (pathParts.length === 0) {
        const result = await readDirectory(rootHandle, false)
        setFiles(withBasePath([...result.directories, ...result.files], ''))
        setCurrentPath('')
      } else {
        let current: any = rootHandle
        for (const part of pathParts) {
          current = await current.getDirectoryHandle(part)
        }

        const result = await readDirectory(current, false)
        const nextPath = pathParts.join('/')
        setFiles(withBasePath([...result.directories, ...result.files], nextPath))
        setCurrentPath(nextPath)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [rootHandle, currentPath])

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
    isLoading,
    error,
    selectDirectory,
    navigateToDirectory,
    navigateUp,
    filterFiles,
  }
}
