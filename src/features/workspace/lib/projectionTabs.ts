import type { DuplicateSelectionRule } from '@/features/workspace/lib/duplicateSelection'
import type { FileItem, ResultProjection } from '@/types'

export type WorkspaceActiveSurface =
  | { kind: 'directory' }
  | { kind: 'projection'; tabId: string }

interface PruneProjectionTabsAfterDeletedFilesParams {
  projectionTabs: ResultProjection[]
  projectionSelectedPathsById: Record<string, string[]>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  projectionFocusedPathById: Record<string, string | null>
  activeProjectionTabId: string | null
  activeSurface: WorkspaceActiveSurface
  lastProjectionTabId: string | null
  deletedAbsolutePaths?: string[]
  deletedProjectionPaths?: string[]
  projectionTabId?: string | null
}

interface PrunedProjectionTabsState {
  projectionTabs: ResultProjection[]
  projectionSelectedPathsById: Record<string, string[]>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  projectionFocusedPathById: Record<string, string | null>
  activeProjectionTabId: string | null
  activeSurface: WorkspaceActiveSurface
  lastProjectionTabId: string | null
  shouldCloseResultPanel: boolean
}

interface ResolveProjectionTabCloseStateParams {
  projectionTabs: ResultProjection[]
  projectionSelectedPathsById: Record<string, string[]>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  projectionFocusedPathById: Record<string, string | null>
  activeSurface: WorkspaceActiveSurface
  lastProjectionTabId: string | null
  closingTabId: string
}

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

export type ProjectionTabClosePreviewAlignment =
  | { kind: 'none' }
  | { kind: 'directory' }
  | { kind: 'projection'; path: string | null }

export interface ProjectionTabCloseState {
  projectionTabs: ResultProjection[]
  projectionSelectedPathsById: Record<string, string[]>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  projectionFocusedPathById: Record<string, string | null>
  activeProjectionTabId: string | null
  activeSurface: WorkspaceActiveSurface
  lastProjectionTabId: string | null
  shouldCloseResultPanel: boolean
  previewAlignment: ProjectionTabClosePreviewAlignment
}

export function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function normalizeRootRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

export function resolveProjectionPreferredPath(
  projection: ResultProjection | null,
  preferredPath: string | null | undefined
): string | null {
  if (!projection) return null
  const normalizedPreferredPath = normalizeRootRelativePath(preferredPath || '')
  if (
    normalizedPreferredPath
    && projection.files.some((file) => normalizeRootRelativePath(file.path) === normalizedPreferredPath)
  ) {
    return normalizedPreferredPath
  }
  return projection.files[0]?.path ?? null
}

export function pruneProjectionAfterDeletedAbsolutePaths(
  projection: ResultProjection,
  deletedAbsolutePaths: ReadonlySet<string>
): ResultProjection | null {
  if (deletedAbsolutePaths.size === 0) {
    return projection
  }

  const nextFiles = projection.files.filter((file) => {
    const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
    return !absolutePath || !deletedAbsolutePaths.has(absolutePath)
  })
  if (nextFiles.length === 0) {
    return null
  }
  if (nextFiles.length === projection.files.length) {
    return projection
  }
  return {
    ...projection,
    files: nextFiles,
  }
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

export function resolveProjectionTabCloseState({
  projectionTabs,
  projectionSelectedPathsById,
  duplicateSelectionRuleByProjectionId,
  projectionFocusedPathById,
  activeSurface,
  lastProjectionTabId,
  closingTabId,
}: ResolveProjectionTabCloseStateParams): ProjectionTabCloseState {
  const closingIndex = projectionTabs.findIndex((projection) => projection.id === closingTabId)
  const remainingTabs = projectionTabs.filter((projection) => projection.id !== closingTabId)
  const nextActiveTabId = (() => {
    if (remainingTabs.length === 0) return null
    if (closingIndex < 0) return remainingTabs[0]?.id ?? null
    return remainingTabs[closingIndex]?.id ?? remainingTabs[closingIndex - 1]?.id ?? remainingTabs[0]?.id ?? null
  })()
  const nextProjectionSelectedPathsById = omitRecordKey(projectionSelectedPathsById, closingTabId)
  const nextDuplicateSelectionRuleByProjectionId = omitRecordKey(duplicateSelectionRuleByProjectionId, closingTabId)
  const nextProjectionFocusedPathById = omitRecordKey(projectionFocusedPathById, closingTabId)

  if (!nextActiveTabId) {
    return {
      projectionTabs: remainingTabs,
      projectionSelectedPathsById: nextProjectionSelectedPathsById,
      duplicateSelectionRuleByProjectionId: nextDuplicateSelectionRuleByProjectionId,
      projectionFocusedPathById: nextProjectionFocusedPathById,
      activeProjectionTabId: null,
      activeSurface: { kind: 'directory' },
      lastProjectionTabId: null,
      shouldCloseResultPanel: true,
      previewAlignment: { kind: 'directory' },
    }
  }

  const shouldMoveActiveSurface = activeSurface.kind === 'projection' && activeSurface.tabId === closingTabId
  const nextActiveSurface = shouldMoveActiveSurface
    ? { kind: 'projection' as const, tabId: nextActiveTabId }
    : activeSurface
  const nextLastProjectionTabId = lastProjectionTabId === closingTabId
    ? nextActiveTabId
    : lastProjectionTabId
  const nextProjection = remainingTabs.find((projection) => projection.id === nextActiveTabId) ?? null

  return {
    projectionTabs: remainingTabs,
    projectionSelectedPathsById: nextProjectionSelectedPathsById,
    duplicateSelectionRuleByProjectionId: nextDuplicateSelectionRuleByProjectionId,
    projectionFocusedPathById: nextProjectionFocusedPathById,
    activeProjectionTabId: nextActiveTabId,
    activeSurface: nextActiveSurface,
    lastProjectionTabId: nextLastProjectionTabId,
    shouldCloseResultPanel: false,
    previewAlignment: shouldMoveActiveSurface
      ? {
        kind: 'projection',
        path: resolveProjectionPreferredPath(nextProjection, projectionFocusedPathById[nextActiveTabId]),
      }
      : { kind: 'none' },
  }
}

export function pruneProjectionTabsAfterDeletedFiles({
  projectionTabs,
  projectionSelectedPathsById,
  duplicateSelectionRuleByProjectionId,
  projectionFocusedPathById,
  activeProjectionTabId,
  activeSurface,
  lastProjectionTabId,
  deletedAbsolutePaths,
  deletedProjectionPaths,
  projectionTabId,
}: PruneProjectionTabsAfterDeletedFilesParams): PrunedProjectionTabsState | null {
  if (projectionTabs.length === 0) {
    return null
  }

  const deletedAbsolutePathSet = new Set(
    (deletedAbsolutePaths ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
  )
  const deletedProjectionPathSet = new Set(
    (deletedProjectionPaths ?? [])
      .map((item) => normalizeRootRelativePath(item))
      .filter(Boolean)
  )
  if (deletedAbsolutePathSet.size === 0 && deletedProjectionPathSet.size === 0) {
    return null
  }

  let didChange = false
  const nextTabs = projectionTabs
    .map((projection) => {
      const isTargetProjection = projection.id === projectionTabId
      const nextFiles = projection.files.filter((file) => {
        const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
        const filePath = normalizeRootRelativePath(file.path)
        if (absolutePath && deletedAbsolutePathSet.has(absolutePath)) {
          return false
        }
        if (isTargetProjection && filePath && deletedProjectionPathSet.has(filePath)) {
          return false
        }
        return true
      })
      if (nextFiles.length !== projection.files.length) {
        didChange = true
      }
      return nextFiles.length === projection.files.length
        ? projection
        : {
          ...projection,
          files: nextFiles,
        }
    })
    .filter((projection) => projection.files.length > 0)

  if (!didChange && nextTabs.length === projectionTabs.length) {
    return null
  }

  const nextTabIdSet = new Set(nextTabs.map((projection) => projection.id))
  const nextProjectionSelectedPathsById: Record<string, string[]> = {}
  for (const projection of nextTabs) {
    const visiblePathSet = new Set(projection.files.map((file) => file.path))
    const nextSelectedPaths = (projectionSelectedPathsById[projection.id] ?? [])
      .filter((path) => visiblePathSet.has(path))
    if (nextSelectedPaths.length > 0) {
      nextProjectionSelectedPathsById[projection.id] = nextSelectedPaths
    }
  }

  const nextDuplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null> = {}
  for (const [tabId, rule] of Object.entries(duplicateSelectionRuleByProjectionId)) {
    if (nextTabIdSet.has(tabId)) {
      nextDuplicateSelectionRuleByProjectionId[tabId] = rule
    }
  }

  const nextProjectionFocusedPathById: Record<string, string | null> = {}
  for (const projection of nextTabs) {
    const currentFocusedPath = projectionFocusedPathById[projection.id] ?? null
    const visiblePathSet = new Set(projection.files.map((file) => file.path))
    if (currentFocusedPath && visiblePathSet.has(currentFocusedPath)) {
      nextProjectionFocusedPathById[projection.id] = currentFocusedPath
    }
  }

  const nextActiveProjectionTabId = (() => {
    if (nextTabs.length === 0) return null
    if (activeProjectionTabId && nextTabIdSet.has(activeProjectionTabId)) {
      return activeProjectionTabId
    }
    return nextTabs[0]?.id ?? null
  })()

  if (!nextActiveProjectionTabId) {
    return {
      projectionTabs: nextTabs,
      projectionSelectedPathsById: nextProjectionSelectedPathsById,
      duplicateSelectionRuleByProjectionId: nextDuplicateSelectionRuleByProjectionId,
      projectionFocusedPathById: nextProjectionFocusedPathById,
      activeProjectionTabId: null,
      activeSurface: { kind: 'directory' },
      lastProjectionTabId: null,
      shouldCloseResultPanel: true,
    }
  }

  const nextActiveSurface = (
    activeSurface.kind === 'projection' && !nextTabIdSet.has(activeSurface.tabId)
  )
    ? { kind: 'projection' as const, tabId: nextActiveProjectionTabId }
    : activeSurface
  const nextLastProjectionTabId = (
    lastProjectionTabId && !nextTabIdSet.has(lastProjectionTabId)
  )
    ? nextActiveProjectionTabId
    : lastProjectionTabId

  return {
    projectionTabs: nextTabs,
    projectionSelectedPathsById: nextProjectionSelectedPathsById,
    duplicateSelectionRuleByProjectionId: nextDuplicateSelectionRuleByProjectionId,
    projectionFocusedPathById: nextProjectionFocusedPathById,
    activeProjectionTabId: nextActiveProjectionTabId,
    activeSurface: nextActiveSurface,
    lastProjectionTabId: nextLastProjectionTabId,
    shouldCloseResultPanel: false,
  }
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record
  }
  const next = { ...record }
  delete next[key]
  return next
}
