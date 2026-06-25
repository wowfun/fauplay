import { useCallback } from 'react'
import type { FileItem } from '@/types'
import {
  listRuntimeGlobalTrash,
  listRuntimeRootTrash,
  toRuntimeGlobalTrashFileItems,
  toRuntimeRootTrashFileItems,
} from '@/lib/runtimeApi'
import { getBoundRootPath } from '@/lib/reveal'
import { toUnifiedTrashListingItems } from '@/features/explorer/lib/trashListingModel'

export interface UseTrashListingControllerParams {
  virtualTrashPath: string
  timeoutMs: number
  replaceListingItems: (nextFiles: FileItem[]) => void
  setCurrentPath: (path: string) => void
  setIsFlattenView: (isFlattenView: boolean) => void
  setRootHandle: (rootHandle: FileSystemDirectoryHandle | null) => void
  setRootId: (rootId: string | null) => void
}

export function useTrashListingController({
  virtualTrashPath,
  timeoutMs,
  replaceListingItems,
  setCurrentPath,
  setIsFlattenView,
  setRootHandle,
  setRootId,
}: UseTrashListingControllerParams) {
  const loadUnifiedTrashItems = useCallback(async (
    targetRootId: string | null,
    targetRootHandle: FileSystemDirectoryHandle | null
  ) => {
    const boundRootPath = targetRootId ? getBoundRootPath(targetRootId) : null
    let rootTrashFiles: FileItem[] = []

    if (boundRootPath) {
      const runtimeRootTrash = await listRuntimeRootTrash({ rootPath: boundRootPath }, timeoutMs)
      rootTrashFiles = toRuntimeRootTrashFileItems(runtimeRootTrash.entries, boundRootPath)
    }

    const globalTrash = await listRuntimeGlobalTrash({}, timeoutMs)
    const globalTrashFiles = toRuntimeGlobalTrashFileItems(globalTrash.entries)
    const nextFiles = toUnifiedTrashListingItems({
      rootTrashFiles,
      globalTrashFiles,
    })

    replaceListingItems(nextFiles)
    setCurrentPath(virtualTrashPath)
    setIsFlattenView(false)
    if (targetRootHandle) {
      setRootHandle(targetRootHandle)
    }
    if (targetRootId) {
      setRootId(targetRootId)
    }
  }, [
    replaceListingItems,
    setCurrentPath,
    setIsFlattenView,
    setRootHandle,
    setRootId,
    timeoutMs,
    virtualTrashPath,
  ])

  return {
    loadUnifiedTrashItems,
  }
}
