import type { AccessProvider, ActiveRemoteWorkspace } from './accessState.ts'
import type { LocalPublishedRootSyncEntry, RemoteRootEntry } from './remoteAccess.ts'

export interface ResolveInitialAccessProviderParams {
  storedProvider: AccessProvider
  activeRemoteWorkspace: ActiveRemoteWorkspace | null
}

export interface ResolveAppWorkspaceVisibilityParams {
  accessProvider: AccessProvider
  activeRemoteWorkspace: ActiveRemoteWorkspace | null
  localRootId: string | null
}

export interface AppWorkspaceVisibility {
  shouldShowRemoteWorkspace: boolean
  shouldShowLocalWorkspace: boolean
  shouldShowStartupScreen: boolean
}

export interface LocalPublishedRootSyncRoot {
  rootId: string
  rootName: string
  boundRootPath?: string
}

export interface LocalPublishedRootSyncFavorite {
  rootId: string
  path: string
}

export type RemoteStep = 'idle' | 'token' | 'roots'

export type RemoteRootsConnectionPlan =
  | {
    kind: 'error'
    message: string
  }
  | {
    kind: 'auto-select'
    root: RemoteRootEntry
    nextRemoteStep: RemoteStep
    nextAccessProvider: Extract<AccessProvider, 'remote-readonly'>
  }
  | {
    kind: 'choose-root'
    nextRemoteStep: RemoteStep
  }

export function resolveInitialAccessProvider({
  storedProvider,
  activeRemoteWorkspace,
}: ResolveInitialAccessProviderParams): AccessProvider {
  return storedProvider === 'remote-readonly' && activeRemoteWorkspace
    ? 'remote-readonly'
    : 'local-browser'
}

export function resolveAppWorkspaceVisibility({
  accessProvider,
  activeRemoteWorkspace,
  localRootId,
}: ResolveAppWorkspaceVisibilityParams): AppWorkspaceVisibility {
  const shouldShowRemoteWorkspace = accessProvider === 'remote-readonly' && Boolean(activeRemoteWorkspace)
  const shouldShowLocalWorkspace = !shouldShowRemoteWorkspace && Boolean(localRootId)
  return {
    shouldShowRemoteWorkspace,
    shouldShowLocalWorkspace,
    shouldShowStartupScreen: !shouldShowRemoteWorkspace && !shouldShowLocalWorkspace,
  }
}

export function readRemoteConnectErrorMessage(
  error: unknown,
  fallback: string,
  unauthorizedMessage: string = '远程会话已失效，请重新连接',
): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'REMOTE_UNAUTHORIZED') {
    return unauthorizedMessage
  }
  return error instanceof Error ? error.message : fallback
}

export function resolveRemoteRootsConnectionPlan(roots: RemoteRootEntry[]): RemoteRootsConnectionPlan {
  if (roots.length === 0) {
    return {
      kind: 'error',
      message: '当前远程服务未配置可访问的 Root',
    }
  }
  if (roots.length === 1) {
    return {
      kind: 'auto-select',
      root: roots[0]!,
      nextRemoteStep: 'roots',
      nextAccessProvider: 'remote-readonly',
    }
  }
  return {
    kind: 'choose-root',
    nextRemoteStep: 'roots',
  }
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

function normalizeRootRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}
