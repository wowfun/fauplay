import type { DuplicateSelectionRule } from './duplicateSelection.ts'
import type { ResultProjection } from '../../../types/index.ts'
import {
  normalizeRootRelativePath,
  resolveProjectionPreferredPath,
  type WorkspaceActiveSurface,
} from './projectionTabRecords.ts'

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
