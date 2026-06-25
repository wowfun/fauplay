import type { WorkspaceActiveSurface } from './projectionTabRecords.ts'
import type { ResultProjection } from '../../../types/index.ts'

export type WorkspaceProjectionTabConsistencyPlan =
  | { kind: 'none' }
  | {
    kind: 'set-active-tab'
    activeProjectionTabId: string | null
    lastProjectionTabId: string | null | undefined
  }

export type WorkspaceProjectionSurfaceRecoveryPlan =
  | { kind: 'none' }
  | {
    kind: 'return-to-directory'
    previewAlignmentPath: string | null
  }

export interface ResolveWorkspaceProjectionTabConsistencyPlanParams {
  projectionTabs: ResultProjection[]
  activeProjectionTabId: string | null
}

export interface ResolveWorkspaceProjectionSurfaceRecoveryPlanParams {
  projectionTabs: ResultProjection[]
  activeSurface: WorkspaceActiveSurface
  directoryFocusedPath: string | null
}

export function resolveWorkspaceProjectionTabConsistencyPlan({
  projectionTabs,
  activeProjectionTabId,
}: ResolveWorkspaceProjectionTabConsistencyPlanParams): WorkspaceProjectionTabConsistencyPlan {
  if (projectionTabs.length === 0) {
    if (activeProjectionTabId === null) return { kind: 'none' }
    return {
      kind: 'set-active-tab',
      activeProjectionTabId: null,
      lastProjectionTabId: undefined,
    }
  }

  if (activeProjectionTabId && projectionTabs.some((projection) => projection.id === activeProjectionTabId)) {
    return { kind: 'none' }
  }

  const fallbackTabId = projectionTabs[0]?.id ?? null
  return {
    kind: 'set-active-tab',
    activeProjectionTabId: fallbackTabId,
    lastProjectionTabId: fallbackTabId,
  }
}

export function resolveWorkspaceProjectionSurfaceRecoveryPlan({
  projectionTabs,
  activeSurface,
  directoryFocusedPath,
}: ResolveWorkspaceProjectionSurfaceRecoveryPlanParams): WorkspaceProjectionSurfaceRecoveryPlan {
  if (activeSurface.kind !== 'projection') return { kind: 'none' }
  if (projectionTabs.some((projection) => projection.id === activeSurface.tabId)) return { kind: 'none' }
  return {
    kind: 'return-to-directory',
    previewAlignmentPath: directoryFocusedPath,
  }
}
