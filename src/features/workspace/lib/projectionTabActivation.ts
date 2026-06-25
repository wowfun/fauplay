import type { FileItem, ResultPanelDisplayMode, ResultProjection } from '../../../types/index.ts'
import {
  pruneProjectionAfterDeletedAbsolutePaths,
  resolveProjectionPreferredPath,
  type WorkspaceActiveSurface,
} from './projectionTabRecords.ts'

interface ResolveProjectionActivationPlanParams {
  projectionTabs: ResultProjection[]
  target:
    | { kind: 'projection'; projection: ResultProjection }
    | { kind: 'tab'; tabId: string }
    | {
      kind: 'fallback'
      activeProjectionTabId: string | null
      lastProjectionTabId: string | null
    }
  projectionFocusedPathById: Record<string, string | null>
  deletedAbsolutePaths?: ReadonlySet<string>
}

interface ResolveProjectionPanelDisplayTogglePlanParams {
  projectionTabs: ResultProjection[]
  activeProjectionTabId: string | null
  projectionFocusedPathById: Record<string, string | null>
  currentDisplayMode: ResultPanelDisplayMode
  lastNormalHeightPx: number
}

export type ProjectionActivationPreviewAlignment =
  | { kind: 'projection'; path: string | null }

export type ProjectionActivationPlan =
  | { kind: 'none' }
  | {
    kind: 'activate'
    projectionTabs: ResultProjection[]
    activeProjectionTabId: string
    activeSurface: Extract<WorkspaceActiveSurface, { kind: 'projection' }>
    lastProjectionTabId: string
    shouldOpenResultPanel: boolean
    previewAlignment: ProjectionActivationPreviewAlignment
  }

export type ProjectionFileInteractionTrigger = 'click' | 'double-click'

export interface ProjectionPanelDisplayTogglePlan {
  nextDisplayMode: ResultPanelDisplayMode
  nextHeightPx: number | null
  activation: {
    activeProjectionTabId: string
    activeSurface: Extract<WorkspaceActiveSurface, { kind: 'projection' }>
    lastProjectionTabId: string
    previewAlignment: ProjectionActivationPreviewAlignment
  } | null
}

export type ProjectionFileInteractionPlan =
  | { kind: 'none' }
  | {
    kind: 'activate-item'
    activeProjectionTabId: string
    activeSurface: Extract<WorkspaceActiveSurface, { kind: 'projection' }>
    lastProjectionTabId: string
    focusedPath: string | null
    openFile: {
      target: 'primary' | 'secondary'
      file: FileItem
    } | null
  }

interface ResolveProjectionFileInteractionPlanParams {
  activeProjectionTabId: string | null | undefined
  item: FileItem
  trigger: ProjectionFileInteractionTrigger
}

export function resolveProjectionActivationPlan({
  projectionTabs,
  target,
  projectionFocusedPathById,
  deletedAbsolutePaths = new Set(),
}: ResolveProjectionActivationPlanParams): ProjectionActivationPlan {
  const activationProjection = (() => {
    if (target.kind === 'fallback') {
      return resolveFallbackProjectionForActivation({
        projectionTabs,
        activeProjectionTabId: target.activeProjectionTabId,
        lastProjectionTabId: target.lastProjectionTabId,
      })
    }
    if (target.kind === 'tab') {
      return projectionTabs.find((projection) => projection.id === target.tabId) ?? null
    }

    return pruneProjectionAfterDeletedAbsolutePaths(
      target.projection,
      deletedAbsolutePaths
    )
  })()
  if (!activationProjection) {
    return { kind: 'none' }
  }

  const existingIndex = projectionTabs.findIndex((item) => item.id === activationProjection.id)
  const nextProjectionTabs = (() => {
    if (target.kind === 'fallback' || target.kind === 'tab') {
      return projectionTabs
    }
    if (existingIndex < 0) {
      return [...projectionTabs, activationProjection]
    }
    const next = [...projectionTabs]
    next[existingIndex] = activationProjection
    return next
  })()

  return {
    kind: 'activate',
    projectionTabs: nextProjectionTabs,
    activeProjectionTabId: activationProjection.id,
    activeSurface: { kind: 'projection', tabId: activationProjection.id },
    lastProjectionTabId: activationProjection.id,
    shouldOpenResultPanel: true,
    previewAlignment: {
      kind: 'projection',
      path: resolveProjectionPreferredPath(
        activationProjection,
        projectionFocusedPathById[activationProjection.id]
      ),
    },
  }
}

export function resolveProjectionPanelDisplayTogglePlan({
  projectionTabs,
  activeProjectionTabId,
  projectionFocusedPathById,
  currentDisplayMode,
  lastNormalHeightPx,
}: ResolveProjectionPanelDisplayTogglePlanParams): ProjectionPanelDisplayTogglePlan {
  const fallbackProjection = resolveActiveProjectionForPanelDisplayToggle({
    projectionTabs,
    activeProjectionTabId,
  })
  const activation = fallbackProjection
    ? {
      activeProjectionTabId: fallbackProjection.id,
      activeSurface: { kind: 'projection' as const, tabId: fallbackProjection.id },
      lastProjectionTabId: fallbackProjection.id,
      previewAlignment: {
        kind: 'projection' as const,
        path: resolveProjectionPreferredPath(
          fallbackProjection,
          projectionFocusedPathById[fallbackProjection.id],
        ),
      },
    }
    : null

  if (currentDisplayMode === 'maximized') {
    return {
      nextDisplayMode: 'normal',
      nextHeightPx: lastNormalHeightPx,
      activation,
    }
  }

  return {
    nextDisplayMode: 'maximized',
    nextHeightPx: null,
    activation,
  }
}

export function resolveProjectionFileInteractionPlan({
  activeProjectionTabId,
  item,
  trigger,
}: ResolveProjectionFileInteractionPlanParams): ProjectionFileInteractionPlan {
  if (!activeProjectionTabId) {
    return { kind: 'none' }
  }
  if (trigger === 'double-click' && item.kind !== 'file') {
    return { kind: 'none' }
  }

  return {
    kind: 'activate-item',
    activeProjectionTabId,
    activeSurface: { kind: 'projection', tabId: activeProjectionTabId },
    lastProjectionTabId: activeProjectionTabId,
    focusedPath: item.kind === 'file' ? item.path : null,
    openFile: item.kind === 'file'
      ? {
        target: trigger === 'double-click' ? 'secondary' : 'primary',
        file: item,
      }
      : null,
  }
}

function resolveActiveProjectionForPanelDisplayToggle({
  projectionTabs,
  activeProjectionTabId,
}: {
  projectionTabs: ResultProjection[]
  activeProjectionTabId: string | null
}): ResultProjection | null {
  return (
    (activeProjectionTabId
      ? projectionTabs.find((projection) => projection.id === activeProjectionTabId)
      : null)
    ?? projectionTabs[0]
    ?? null
  )
}

function resolveFallbackProjectionForActivation({
  projectionTabs,
  activeProjectionTabId,
  lastProjectionTabId,
}: {
  projectionTabs: ResultProjection[]
  activeProjectionTabId: string | null
  lastProjectionTabId: string | null
}): ResultProjection | null {
  return (
    (activeProjectionTabId
      ? projectionTabs.find((projection) => projection.id === activeProjectionTabId)
      : null)
    ?? (lastProjectionTabId
      ? projectionTabs.find((projection) => projection.id === lastProjectionTabId)
      : null)
    ?? projectionTabs[0]
    ?? null
  )
}
