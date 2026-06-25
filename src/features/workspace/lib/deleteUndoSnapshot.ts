import type { DuplicateSelectionRule } from './duplicateSelection.ts'
import {
  type DeleteUndoBatch,
  type DeleteUndoPreviewSnapshot,
  type DeleteUndoRestoreItem,
  type DeleteUndoSnapshot,
  normalizeAbsolutePath,
  pathRefersToDeletedAbsolutePath,
  remapFileItemAfterRestore,
  remapPathForRoot,
} from './deleteUndo.ts'
import type { WorkspaceActiveSurface } from './projectionTabRecords.ts'
import type { FileItem, FilterState, ResultPanelDisplayMode, ResultProjection } from '@/types'

export interface CreateDeleteUndoPreviewSnapshotParams {
  showPreviewPane: boolean
  selectedFile: FileItem | null
  previewFile: FileItem | null
}

export interface CreateDeleteUndoSnapshotParams {
  rootId: string
  rootName: string
  rootPath: string | null
  currentPath: string
  visitedAt: number
  filter: FilterState
  isFlattenView: boolean
  activeSurface: WorkspaceActiveSurface
  directorySelectedPaths: string[]
  directoryFocusedPath: string | null
  isResultPanelOpen: boolean
  resultPanelDisplayMode: ResultPanelDisplayMode
  resultPanelHeightPx: number
  lastNormalResultPanelHeightPx: number
  projectionTabs: ResultProjection[]
  activeProjectionTabId: string | null
  projectionSelectedPathsById: Record<string, string[]>
  projectionFocusedPathById: Record<string, string | null>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  preview: DeleteUndoPreviewSnapshot
}

export interface CreateDeleteUndoBatchParams {
  id: string
  createdAt: number
  restoreItems: DeleteUndoRestoreItem[] | undefined
  snapshot: DeleteUndoSnapshot | null
}

export function cloneFileItem(file: FileItem | null): FileItem | null {
  if (!file) return null
  return {
    ...file,
    lastModified: file.lastModified ? new Date(file.lastModified) : undefined,
  }
}

export function cloneResultProjection(projection: ResultProjection): ResultProjection {
  return {
    ...projection,
    files: projection.files.map((file) => cloneFileItem(file) ?? file),
  }
}

export function cloneStringArrayRecord(record: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, [...value]])
  )
}

export function cloneNullableStringRecord(record: Record<string, string | null>): Record<string, string | null> {
  return { ...record }
}

export function cloneDuplicateSelectionRuleRecord(
  record: Record<string, DuplicateSelectionRule | null>
): Record<string, DuplicateSelectionRule | null> {
  return { ...record }
}

export function createDeleteUndoPreviewSnapshot({
  showPreviewPane,
  selectedFile,
  previewFile,
}: CreateDeleteUndoPreviewSnapshotParams): DeleteUndoPreviewSnapshot {
  return {
    showPreviewPane,
    selectedFile: cloneFileItem(selectedFile),
    previewFile: cloneFileItem(previewFile),
  }
}

export function createDeleteUndoSnapshot({
  rootId,
  rootName,
  rootPath,
  currentPath,
  visitedAt,
  filter,
  isFlattenView,
  activeSurface,
  directorySelectedPaths,
  directoryFocusedPath,
  isResultPanelOpen,
  resultPanelDisplayMode,
  resultPanelHeightPx,
  lastNormalResultPanelHeightPx,
  projectionTabs,
  activeProjectionTabId,
  projectionSelectedPathsById,
  projectionFocusedPathById,
  duplicateSelectionRuleByProjectionId,
  preview,
}: CreateDeleteUndoSnapshotParams): DeleteUndoSnapshot | null {
  if (!rootId) return null

  return {
    historyEntry: {
      rootId,
      rootName: rootName || '根目录',
      path: currentPath,
      visitedAt,
    },
    rootPath,
    currentPath,
    filter: cloneFilterState(filter),
    isFlattenView,
    activeSurface: activeSurface.kind === 'projection'
      ? { kind: 'projection', tabId: activeSurface.tabId }
      : { kind: 'directory' },
    directorySelectedPaths: [...directorySelectedPaths],
    directoryFocusedPath,
    isResultPanelOpen,
    resultPanelDisplayMode,
    resultPanelHeightPx,
    lastNormalResultPanelHeightPx,
    projectionTabs: projectionTabs.map((projection) => cloneResultProjection(projection)),
    activeProjectionTabId,
    projectionSelectedPathsById: cloneStringArrayRecord(projectionSelectedPathsById),
    projectionFocusedPathById: cloneNullableStringRecord(projectionFocusedPathById),
    duplicateSelectionRuleByProjectionId: cloneDuplicateSelectionRuleRecord(duplicateSelectionRuleByProjectionId),
    preview: createDeleteUndoPreviewSnapshot(preview),
  }
}

export function createDeleteUndoBatch({
  id,
  createdAt,
  restoreItems,
  snapshot,
}: CreateDeleteUndoBatchParams): DeleteUndoBatch | null {
  if (!snapshot || !Array.isArray(restoreItems) || restoreItems.length === 0) {
    return null
  }

  return {
    id,
    createdAt,
    deletedCount: restoreItems.length,
    restoreItems,
    snapshot,
  }
}

function cloneFilterState(filter: FilterState): FilterState {
  return {
    ...filter,
    annotationIncludeTagKeys: [...filter.annotationIncludeTagKeys],
    annotationExcludeTagKeys: [...filter.annotationExcludeTagKeys],
  }
}

export function buildRestoredDeleteUndoSnapshot(
  snapshot: DeleteUndoSnapshot,
  restoredAbsolutePathByOriginalAbsolutePath: Map<string, string>,
  failedOriginalAbsolutePathSet: Set<string>
): DeleteUndoSnapshot {
  const projectionPathRemapById = new Map<string, Map<string, string>>()
  const remappedProjectionTabs = snapshot.projectionTabs
    .map((projection) => {
      const pathMap = new Map<string, string>()
      const remappedFiles = projection.files
        .map((file) => {
          const remappedFile = remapFileItemAfterRestore(
            file,
            file.sourceRootPath ?? snapshot.rootPath,
            restoredAbsolutePathByOriginalAbsolutePath
          )
          pathMap.set(file.path, remappedFile.path)
          return remappedFile
        })
        .filter((file) => {
          const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
          return !absolutePath || !failedOriginalAbsolutePathSet.has(normalizeAbsolutePath(absolutePath))
        })

      projectionPathRemapById.set(projection.id, pathMap)

      return {
        ...projection,
        files: remappedFiles,
      }
    })
    .filter((projection) => projection.files.length > 0)

  const remapProjectionPath = (tabId: string, path: string | null | undefined): string | null => {
    const normalizedPath = typeof path === 'string' ? path.trim() : ''
    if (!normalizedPath) {
      return null
    }
    const nextPath = projectionPathRemapById.get(tabId)?.get(normalizedPath)
    return nextPath ?? normalizedPath
  }

  const nextProjectionSelectedPathsById: Record<string, string[]> = {}
  const nextProjectionFocusedPathById: Record<string, string | null> = {}
  for (const projection of remappedProjectionTabs) {
    const visiblePathSet = new Set(projection.files.map((file) => file.path))
    const nextSelectedPaths = (snapshot.projectionSelectedPathsById[projection.id] ?? [])
      .map((path) => remapProjectionPath(projection.id, path))
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
      .filter((path) => visiblePathSet.has(path))
    if (nextSelectedPaths.length > 0) {
      nextProjectionSelectedPathsById[projection.id] = nextSelectedPaths
    }
    const nextFocusedPath = remapProjectionPath(
      projection.id,
      snapshot.projectionFocusedPathById[projection.id] ?? null
    )
    if (nextFocusedPath && visiblePathSet.has(nextFocusedPath)) {
      nextProjectionFocusedPathById[projection.id] = nextFocusedPath
    }
  }

  const nextDirectorySelectedPaths = snapshot.directorySelectedPaths
    .map((path) => remapPathForRoot(path, snapshot.rootPath, restoredAbsolutePathByOriginalAbsolutePath))
    .filter((path): path is string => Boolean(path))
    .filter((path) => !pathRefersToDeletedAbsolutePath(path, snapshot.rootPath, failedOriginalAbsolutePathSet))

  const nextDirectoryFocusedPath = (() => {
    const remappedPath = remapPathForRoot(
      snapshot.directoryFocusedPath,
      snapshot.rootPath,
      restoredAbsolutePathByOriginalAbsolutePath
    )
    if (pathRefersToDeletedAbsolutePath(remappedPath, snapshot.rootPath, failedOriginalAbsolutePathSet)) {
      return null
    }
    return remappedPath
  })()

  const remappedSelectedPreviewFile = snapshot.preview.selectedFile
    ? remapFileItemAfterRestore(
      snapshot.preview.selectedFile,
      snapshot.preview.selectedFile.sourceRootPath ?? snapshot.rootPath,
      restoredAbsolutePathByOriginalAbsolutePath
    )
    : null
  const remappedPreviewFile = snapshot.preview.previewFile
    ? remapFileItemAfterRestore(
      snapshot.preview.previewFile,
      snapshot.preview.previewFile.sourceRootPath ?? snapshot.rootPath,
      restoredAbsolutePathByOriginalAbsolutePath
    )
    : null

  const nextSelectedPreviewFile = (
    remappedSelectedPreviewFile
    && !pathRefersToDeletedAbsolutePath(
      remappedSelectedPreviewFile.absolutePath ?? remappedSelectedPreviewFile.path,
      remappedSelectedPreviewFile.sourceRootPath ?? snapshot.rootPath,
      failedOriginalAbsolutePathSet
    )
  )
    ? remappedSelectedPreviewFile
    : null
  const nextPreviewFile = (
    remappedPreviewFile
    && !pathRefersToDeletedAbsolutePath(
      remappedPreviewFile.absolutePath ?? remappedPreviewFile.path,
      remappedPreviewFile.sourceRootPath ?? snapshot.rootPath,
      failedOriginalAbsolutePathSet
    )
  )
    ? remappedPreviewFile
    : null

  const visibleTabIdSet = new Set(remappedProjectionTabs.map((projection) => projection.id))
  const nextActiveProjectionTabId = (
    snapshot.activeProjectionTabId
    && visibleTabIdSet.has(snapshot.activeProjectionTabId)
  )
    ? snapshot.activeProjectionTabId
    : (remappedProjectionTabs[0]?.id ?? null)
  const nextActiveSurface = (
    snapshot.activeSurface.kind === 'projection'
    && nextActiveProjectionTabId
  )
    ? { kind: 'projection' as const, tabId: nextActiveProjectionTabId }
    : { kind: 'directory' as const }

  return {
    ...snapshot,
    directorySelectedPaths: nextDirectorySelectedPaths,
    directoryFocusedPath: nextDirectoryFocusedPath,
    isResultPanelOpen: snapshot.isResultPanelOpen && remappedProjectionTabs.length > 0,
    projectionTabs: remappedProjectionTabs,
    activeProjectionTabId: nextActiveProjectionTabId,
    projectionSelectedPathsById: nextProjectionSelectedPathsById,
    projectionFocusedPathById: nextProjectionFocusedPathById,
    activeSurface: nextActiveSurface,
    preview: {
      showPreviewPane: snapshot.preview.showPreviewPane && nextSelectedPreviewFile?.kind === 'file',
      selectedFile: nextSelectedPreviewFile,
      previewFile: nextPreviewFile,
    },
  }
}
