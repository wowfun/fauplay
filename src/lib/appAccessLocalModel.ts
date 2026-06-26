import type { LocalPublishedRootSyncEntry } from './remoteAccess.ts'

export interface LocalPublishedRootSyncRoot {
  rootId: string
  rootName: string
  boundRootPath?: string
}

export interface LocalPublishedRootSyncFavorite {
  rootId: string
  path: string
}

export interface ResolveLocalWorkspaceIdentityParams {
  rootId: string | null
  rootName: string | null
  rootHandleName: string | null
  fallbackSessionRootId: string | null
}

export interface LocalWorkspaceIdentity {
  rootId: string
  rootName: string
  workspaceKey: string
  storageNamespace: 'local-browser'
}

export interface ResolveLocalPublishedRootSyncPlanParams {
  isLoopbackUi: boolean
  isCachedRootsReady: boolean
  cachedRoots: LocalPublishedRootSyncRoot[]
  favoriteFolders: LocalPublishedRootSyncFavorite[]
  lastSyncedSignature: string | null
}

export type LocalPublishedRootSyncPlan =
  | { kind: 'skip' }
  | {
    kind: 'sync'
    payload: LocalPublishedRootSyncEntry[]
    signature: string
  }

export function buildLocalPublishedRootSyncPayload(
  cachedRoots: LocalPublishedRootSyncRoot[],
  favoriteFolders: LocalPublishedRootSyncFavorite[],
): LocalPublishedRootSyncEntry[] {
  return cachedRoots.flatMap((root) => {
    const absolutePath = typeof root.boundRootPath === 'string' ? root.boundRootPath.trim() : ''
    if (!absolutePath) return []
    const favoritePaths = [
      ...new Set(
        favoriteFolders
          .filter((item) => item.rootId === root.rootId)
          .map((item) => normalizeRootRelativePath(item.path)),
      ),
    ]
    return [{
      label: root.rootName,
      absolutePath,
      favoritePaths,
    }]
  })
}

export function resolveLocalWorkspaceIdentity({
  rootId,
  rootName,
  rootHandleName,
  fallbackSessionRootId,
}: ResolveLocalWorkspaceIdentityParams): LocalWorkspaceIdentity {
  const resolvedRootId = rootId ?? fallbackSessionRootId ?? 'local-runtime'
  const resolvedRootName = rootName || rootHandleName || '根目录'
  return {
    rootId: resolvedRootId,
    rootName: resolvedRootName,
    workspaceKey: `local:${resolvedRootId}`,
    storageNamespace: 'local-browser',
  }
}

export function resolveLocalPublishedRootSyncPlan({
  isLoopbackUi,
  isCachedRootsReady,
  cachedRoots,
  favoriteFolders,
  lastSyncedSignature,
}: ResolveLocalPublishedRootSyncPlanParams): LocalPublishedRootSyncPlan {
  if (!isLoopbackUi || !isCachedRootsReady) {
    return { kind: 'skip' }
  }

  const payload = buildLocalPublishedRootSyncPayload(cachedRoots, favoriteFolders)
  const signature = JSON.stringify(payload)
  if (lastSyncedSignature === signature) {
    return { kind: 'skip' }
  }

  return {
    kind: 'sync',
    payload,
    signature,
  }
}

function normalizeRootRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}
