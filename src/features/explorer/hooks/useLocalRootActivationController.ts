import { useCallback } from 'react'
import type { CachedRootEntry } from '@/types'
import {
  getCachedRootHandle,
  markCachedRootAsUsed,
  removeCachedRoot,
} from '@/lib/rootHandleCache'
import {
  ensureRootPath,
  getBoundRootPath,
} from '@/lib/reveal'
import { resolveLocalRootActivationTarget } from '@/features/explorer/lib/localFileSystemModel'

export interface ActivateInactiveLocalRootTargetOptions {
  targetRootId: string
  targetPath: string
}

export interface UseLocalRootActivationControllerParams {
  cachedRoots: CachedRootEntry[]
  rootLabelFallback: string
  cacheMissMessage: string
  permissionDeniedMessage: string
  activateRootHandle: (
    nextRootHandle: FileSystemDirectoryHandle,
    nextRootId: string,
    targetPath: string
  ) => Promise<void>
  activateRuntimeRoot: (
    nextRootId: string,
    nextRootName: string,
    targetPath: string
  ) => Promise<void>
  refreshCachedRoots: () => Promise<void>
  setError: (message: string | null) => void
}

export function useLocalRootActivationController({
  cachedRoots,
  rootLabelFallback,
  cacheMissMessage,
  permissionDeniedMessage,
  activateRootHandle,
  activateRuntimeRoot,
  refreshCachedRoots,
  setError,
}: UseLocalRootActivationControllerParams) {
  const ensureDirectoryReadable = useCallback(async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
    const opts: FileSystemPermissionDescriptor = { mode: 'read' }
    const permission = await handle.queryPermission(opts)
    if (permission === 'granted') return true
    if (permission === 'denied') return false

    const requested = await handle.requestPermission(opts)
    return requested === 'granted'
  }, [])

  const warmupRootPathBinding = useCallback((targetRootId: string, targetRootLabel: string) => {
    try {
      ensureRootPath({
        rootId: targetRootId,
        rootLabel: targetRootLabel || rootLabelFallback,
        promptIfMissing: true,
      })
    } catch {
      // ignore mapping warmup errors, plugin call can still prompt on demand
    }
  }, [rootLabelFallback])

  const activateInactiveLocalRootTarget = useCallback(async ({
    targetRootId,
    targetPath,
  }: ActivateInactiveLocalRootTargetOptions): Promise<boolean> => {
    const targetRoot = cachedRoots.find((item) => item.rootId === targetRootId)
    const cachedHandle = await getCachedRootHandle(targetRootId)
    const boundRootPath = targetRoot?.boundRootPath ?? getBoundRootPath(targetRootId)
    const activationTarget = resolveLocalRootActivationTarget({
      targetRootId,
      targetPath,
      currentRootId: null,
      targetRoot,
      boundRootPath,
      hasCachedHandle: cachedHandle !== null,
      rootLabelFallback,
    })

    if (activationTarget.type === 'cache-miss') {
      await removeCachedRoot(activationTarget.rootId)
      await refreshCachedRoots()
      setError(cacheMissMessage)
      return false
    }

    if (activationTarget.type === 'runtime-root') {
      await activateRuntimeRoot(activationTarget.rootId, activationTarget.rootName, activationTarget.path)
      await refreshCachedRoots()
      return true
    }

    if (activationTarget.type === 'browser-root') {
      if (!cachedHandle) return false

      const granted = await ensureDirectoryReadable(cachedHandle)
      if (!granted) {
        await removeCachedRoot(activationTarget.rootId)
        await refreshCachedRoots()
        setError(permissionDeniedMessage)
        return false
      }

      warmupRootPathBinding(activationTarget.rootId, cachedHandle.name)
      await activateRootHandle(cachedHandle, activationTarget.rootId, activationTarget.path)
      await markCachedRootAsUsed(activationTarget.rootId)
      await refreshCachedRoots()
      return true
    }

    return true
  }, [
    activateRootHandle,
    activateRuntimeRoot,
    cacheMissMessage,
    cachedRoots,
    ensureDirectoryReadable,
    permissionDeniedMessage,
    refreshCachedRoots,
    rootLabelFallback,
    setError,
    warmupRootPathBinding,
  ])

  return {
    activateInactiveLocalRootTarget,
    warmupRootPathBinding,
  }
}
