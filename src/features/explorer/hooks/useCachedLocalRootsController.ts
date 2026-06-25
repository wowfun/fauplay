import { useCallback, useEffect, useState } from 'react'
import type { CachedRootEntry } from '@/types'
import { listCachedRoots } from '@/lib/rootHandleCache'
import {
  getRootPathMapUpdatedEventName,
  getRootPathStorageKey,
  listLocalRootBindings,
  syncLocalRootBindingsFromRuntime,
} from '@/lib/reveal'
import {
  mergeCachedLocalRootEntries,
  shouldRefreshCachedLocalRootsForStorageKey,
} from '@/features/explorer/lib/localFileSystemModel'

export interface UseCachedLocalRootsControllerParams {
  rootLabelFallback: string
}

export function useCachedLocalRootsController({
  rootLabelFallback,
}: UseCachedLocalRootsControllerParams) {
  const [cachedRoots, setCachedRoots] = useState<CachedRootEntry[]>([])
  const [isCachedRootsReady, setIsCachedRootsReady] = useState(false)

  const refreshCachedRoots = useCallback(async () => {
    await syncLocalRootBindingsFromRuntime()

    const entries = await listCachedRoots()
    setCachedRoots(mergeCachedLocalRootEntries({
      cachedRoots: entries,
      bindings: listLocalRootBindings(),
      rootLabelFallback,
    }))
    setIsCachedRootsReady(true)
  }, [rootLabelFallback])

  useEffect(() => {
    void refreshCachedRoots()
  }, [refreshCachedRoots])

  useEffect(() => {
    const eventName = getRootPathMapUpdatedEventName()
    const rootPathStorageKey = getRootPathStorageKey()
    const handleRootPathMapUpdated = () => {
      void refreshCachedRoots()
    }
    const handleStorage = (event: StorageEvent) => {
      if (!shouldRefreshCachedLocalRootsForStorageKey({
        eventKey: event.key,
        rootPathStorageKey,
      })) return
      void refreshCachedRoots()
    }

    window.addEventListener(eventName, handleRootPathMapUpdated)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(eventName, handleRootPathMapUpdated)
      window.removeEventListener('storage', handleStorage)
    }
  }, [refreshCachedRoots])

  return {
    cachedRoots,
    isCachedRootsReady,
    refreshCachedRoots,
  }
}
