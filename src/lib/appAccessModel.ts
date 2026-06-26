import type { AccessProvider, ActiveRemoteWorkspace } from './accessState.ts'

export {
  buildLocalPublishedRootSyncPayload,
  resolveLocalPublishedRootSyncPlan,
  resolveLocalWorkspaceIdentity,
} from './appAccessLocalModel.ts'
export type {
  LocalPublishedRootSyncFavorite,
  LocalPublishedRootSyncPlan,
  LocalPublishedRootSyncRoot,
  LocalWorkspaceIdentity,
  ResolveLocalPublishedRootSyncPlanParams,
  ResolveLocalWorkspaceIdentityParams,
} from './appAccessLocalModel.ts'
export {
  readRemoteConnectErrorMessage,
  resolveRemoteAccessConnectionCommitPlan,
  resolveRemoteAccessResetPlan,
  resolveRemoteRememberedDeviceDraftChangePlan,
  resolveRemoteRootSelectionCommitPlan,
  resolveRemoteRootsConnectionPlan,
  resolveRemoteWorkspaceRestorePlan,
} from './appAccessRemoteModel.ts'
export type {
  RemoteAccessConnectionCommitPlan,
  RemoteAccessResetPlan,
  RemoteAccessResetReason,
  RemoteRememberedDeviceDraftChangePlan,
  RemoteRootSelectionCommitPlan,
  RemoteRootsConnectionPlan,
  RemoteStep,
  RemoteWorkspaceRestorePlan,
  ResolveRemoteAccessResetPlanParams,
  ResolveRemoteRememberedDeviceDraftChangePlanParams,
} from './appAccessRemoteModel.ts'

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
