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

export type RemoteStep = 'idle' | 'token' | 'roots'

export type RemoteAccessResetReason =
  | 'open-connect'
  | 'cancel-connect'
  | 'restore-failed'
  | 'session-invalidated'
  | 'disconnect-workspace'
  | 'forget-device'

export type ResolveRemoteAccessResetPlanParams =
  | {
    reason: Exclude<RemoteAccessResetReason, 'restore-failed'>
  }
  | {
    reason: 'restore-failed'
    remoteError: string
  }

export interface RemoteAccessResetPlan {
  clearActiveRemoteWorkspace: boolean
  remoteRoots: RemoteRootEntry[]
  remoteToken: string
  rememberRemoteDevice: boolean
  rememberRemoteDeviceLabel: string
  remoteStep: RemoteStep
  remoteError?: string | null
  nextAccessProvider?: Extract<AccessProvider, 'local-browser'>
}

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

export type RemoteWorkspaceRestorePlan =
  | {
    kind: 'restore'
    root: RemoteRootEntry
  }
  | {
    kind: 'error'
    message: string
  }

export type RemoteAccessConnectionCommitPlan =
  | {
    kind: 'error'
    message: string
  }
  | {
    kind: 'commit'
    remoteRoots: RemoteRootEntry[]
    remoteStep: RemoteStep
    clearConnectionDraft: boolean
    activeRemoteRoot?: RemoteRootEntry
    nextAccessProvider?: Extract<AccessProvider, 'remote-readonly'>
  }

export interface RemoteRootSelectionCommitPlan {
  remoteError: null
  activeRemoteRoot: RemoteRootEntry
  nextAccessProvider: Extract<AccessProvider, 'remote-readonly'>
}

export interface ResolveRemoteRememberedDeviceDraftChangePlanParams {
  nextRememberDevice: boolean
  currentDeviceLabel: string
}

export interface RemoteRememberedDeviceDraftChangePlan {
  rememberRemoteDevice: boolean
  rememberRemoteDeviceLabel: string
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

export function resolveRemoteAccessConnectionCommitPlan({
  roots,
  clearConnectionDraft,
}: {
  roots: RemoteRootEntry[]
  clearConnectionDraft: boolean
}): RemoteAccessConnectionCommitPlan {
  const connectionPlan = resolveRemoteRootsConnectionPlan(roots)
  if (connectionPlan.kind === 'error') {
    return connectionPlan
  }

  const base = {
    kind: 'commit' as const,
    remoteRoots: roots,
    remoteStep: connectionPlan.nextRemoteStep,
    clearConnectionDraft,
  }

  if (connectionPlan.kind === 'auto-select') {
    return {
      ...base,
      activeRemoteRoot: connectionPlan.root,
      nextAccessProvider: connectionPlan.nextAccessProvider,
    }
  }

  return base
}

export function resolveRemoteRootSelectionCommitPlan(root: RemoteRootEntry): RemoteRootSelectionCommitPlan {
  return {
    remoteError: null,
    activeRemoteRoot: root,
    nextAccessProvider: 'remote-readonly',
  }
}

export function resolveRemoteRememberedDeviceDraftChangePlan({
  nextRememberDevice,
  currentDeviceLabel,
}: ResolveRemoteRememberedDeviceDraftChangePlanParams): RemoteRememberedDeviceDraftChangePlan {
  return {
    rememberRemoteDevice: nextRememberDevice,
    rememberRemoteDeviceLabel: nextRememberDevice ? currentDeviceLabel : '',
  }
}

export function resolveRemoteWorkspaceRestorePlan({
  activeRemoteWorkspace,
  roots,
}: {
  activeRemoteWorkspace: ActiveRemoteWorkspace
  roots: RemoteRootEntry[]
}): RemoteWorkspaceRestorePlan {
  const matchedRoot = roots.find((item) => item.id === activeRemoteWorkspace.configRootId) ?? null
  if (!matchedRoot) {
    return {
      kind: 'error',
      message: '远程 Root 已不存在或当前会话无权访问',
    }
  }

  return {
    kind: 'restore',
    root: matchedRoot,
  }
}

export function resolveRemoteAccessResetPlan(params: ResolveRemoteAccessResetPlanParams): RemoteAccessResetPlan {
  const { reason } = params
  const base = {
    remoteRoots: [],
    remoteToken: '',
    rememberRemoteDevice: false,
    rememberRemoteDeviceLabel: '',
  }

  if (reason === 'open-connect') {
    return {
      ...base,
      clearActiveRemoteWorkspace: false,
      remoteStep: 'token',
      remoteError: null,
    }
  }

  if (reason === 'cancel-connect') {
    return {
      ...base,
      clearActiveRemoteWorkspace: false,
      remoteStep: 'idle',
      remoteError: null,
    }
  }

  if (reason === 'session-invalidated') {
    return {
      ...base,
      clearActiveRemoteWorkspace: true,
      remoteStep: 'token',
      remoteError: '远程会话已失效，请重新连接',
      nextAccessProvider: 'local-browser',
    }
  }

  if (reason === 'restore-failed') {
    return {
      ...base,
      clearActiveRemoteWorkspace: true,
      remoteStep: 'token',
      remoteError: params.remoteError,
      nextAccessProvider: 'local-browser',
    }
  }

  if (reason === 'disconnect-workspace') {
    return {
      ...base,
      clearActiveRemoteWorkspace: true,
      remoteStep: 'token',
      remoteError: null,
      nextAccessProvider: 'local-browser',
    }
  }

  return {
    ...base,
    clearActiveRemoteWorkspace: true,
    remoteStep: 'token',
    nextAccessProvider: 'local-browser',
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
