import type { CachedRootEntry } from '../../../types/index.ts'

export interface ResolveSelectedLocalRootIdParams {
  cachedRootId?: string | null
  sessionRootId: string
}

export interface ResolveCachedRootRebindTargetParams {
  targetRootId: string
  cachedRoots: CachedRootEntry[]
  rootLabelFallback: string
}

export interface CachedRootRebindTarget {
  rootId: string
  rootLabel: string
}

export function resolveSelectedLocalRootId({
  cachedRootId,
  sessionRootId,
}: ResolveSelectedLocalRootIdParams): string {
  return cachedRootId || sessionRootId
}

export function resolveCachedRootRebindTarget({
  targetRootId,
  cachedRoots,
  rootLabelFallback,
}: ResolveCachedRootRebindTargetParams): CachedRootRebindTarget | null {
  if (!targetRootId) return null

  const targetRoot = cachedRoots.find((item) => item.rootId === targetRootId)
  return {
    rootId: targetRootId,
    rootLabel: targetRoot?.rootName || rootLabelFallback,
  }
}
