import { useCallback } from 'react'
import type { CachedRootEntry } from '@/types'
import { openDirectory } from '@/lib/fileSystem'
import { upsertCachedRootHandle } from '@/lib/rootHandleCache'
import { ensureRootPath } from '@/lib/reveal'
import type { ActivateInactiveLocalRootTargetOptions } from '@/features/explorer/hooks/useLocalRootActivationController'
import {
  resolveCachedRootRebindTarget,
  resolveSelectedLocalRootId,
} from '@/features/explorer/lib/localRootCommandModel'

export interface UseLocalRootCommandControllerParams {
  cachedRoots: CachedRootEntry[]
  rootLabelFallback: string
  activateRootHandle: (
    nextRootHandle: FileSystemDirectoryHandle,
    nextRootId: string,
    targetPath: string
  ) => Promise<void>
  activateInactiveLocalRootTarget: (options: ActivateInactiveLocalRootTargetOptions) => Promise<boolean>
  warmupRootPathBinding: (targetRootId: string, targetRootLabel: string) => void
  refreshCachedRoots: () => Promise<void>
  setIsLoading: (isLoading: boolean) => void
  setError: (message: string | null) => void
}

function createSessionRootId(handle: FileSystemDirectoryHandle): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `session:${handle.name}:${suffix}`
}

export function useLocalRootCommandController({
  cachedRoots,
  rootLabelFallback,
  activateRootHandle,
  activateInactiveLocalRootTarget,
  warmupRootPathBinding,
  refreshCachedRoots,
  setIsLoading,
  setError,
}: UseLocalRootCommandControllerParams) {
  const selectDirectory = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const handle = await openDirectory()
      if (!handle) return

      const cached = await upsertCachedRootHandle(handle).catch(() => null)
      const resolvedRootId = resolveSelectedLocalRootId({
        cachedRootId: cached?.rootId,
        sessionRootId: createSessionRootId(handle),
      })

      warmupRootPathBinding(resolvedRootId, handle.name)
      await activateRootHandle(handle, resolvedRootId, '')
      await refreshCachedRoots()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [activateRootHandle, refreshCachedRoots, setError, setIsLoading, warmupRootPathBinding])

  const openCachedRoot = useCallback(async (targetRootId: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      return await activateInactiveLocalRootTarget({
        targetRootId,
        targetPath: '',
      })
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [activateInactiveLocalRootTarget, setError, setIsLoading])

  const rebindCachedRootPath = useCallback(async (targetRootId: string): Promise<boolean> => {
    const rebindTarget = resolveCachedRootRebindTarget({
      targetRootId,
      cachedRoots,
      rootLabelFallback,
    })
    if (!rebindTarget) return false

    try {
      const nextPath = ensureRootPath({
        rootId: rebindTarget.rootId,
        rootLabel: rebindTarget.rootLabel,
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
  }, [cachedRoots, refreshCachedRoots, rootLabelFallback, setError])

  return {
    selectDirectory,
    openCachedRoot,
    rebindCachedRootPath,
  }
}
