import { useCallback } from 'react'
import { isHiddenSystemDirectory } from '@/lib/fileSystem'
import { listRuntimeLocalDirectory } from '@/lib/runtimeApi'
import { getBoundRootPath } from '@/lib/reveal'
import {
  isLocalVirtualTrashPath,
  normalizeLocalRootRelativePath,
  sortLocalChildDirectoryNames,
  toLocalChildDirectoryNames,
} from '@/features/explorer/lib/localFileSystemModel'

export interface UseLocalDirectoryAccessControllerParams {
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string | null
  currentPath: string
  virtualTrashPath: string
  permissionDeniedMessage: string
}

export function useLocalDirectoryAccessController({
  rootHandle,
  rootId,
  currentPath,
  virtualTrashPath,
  permissionDeniedMessage,
}: UseLocalDirectoryAccessControllerParams) {
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
        throw new Error(permissionDeniedMessage)
      }
      if (permission === 'prompt') {
        const requested = await current.requestPermission(opts)
        if (requested !== 'granted') {
          throw new Error(permissionDeniedMessage)
        }
      }
      current = await current.getDirectoryHandle(part)
    }

    return current
  }, [permissionDeniedMessage])

  const getDirectoryHandleByPath = useCallback(async (targetPath: string) => {
    if (!rootHandle) return null
    return getDirectoryHandleByPathFromRoot(rootHandle, targetPath)
  }, [getDirectoryHandleByPathFromRoot, rootHandle])

  const getCurrentDirectoryHandle = useCallback(async () => {
    return getDirectoryHandleByPath(currentPath)
  }, [currentPath, getDirectoryHandleByPath])

  const listChildDirectories = useCallback(async (targetPath: string): Promise<string[]> => {
    const normalizedPath = normalizeLocalRootRelativePath(targetPath)
    if (isLocalVirtualTrashPath(normalizedPath, virtualTrashPath)) {
      return []
    }

    const boundRootPath = rootId ? getBoundRootPath(rootId) : null
    if (boundRootPath) {
      try {
        const runtimeListing = await listRuntimeLocalDirectory({
          rootPath: boundRootPath,
          rootRelativePath: normalizedPath,
        })
        return toLocalChildDirectoryNames(runtimeListing.entries)
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
  }, [getDirectoryHandleByPath, rootHandle, rootId, virtualTrashPath])

  return {
    getDirectoryHandleByPathFromRoot,
    getDirectoryHandleByPath,
    getCurrentDirectoryHandle,
    listChildDirectories,
  }
}
