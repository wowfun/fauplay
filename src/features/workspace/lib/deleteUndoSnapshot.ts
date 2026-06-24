import type { DuplicateSelectionRule } from './duplicateSelection.ts'
import {
  type DeleteUndoSnapshot,
  normalizeAbsolutePath,
  pathRefersToDeletedAbsolutePath,
  remapFileItemAfterRestore,
  remapPathForRoot,
} from './deleteUndo.ts'
import type { FileItem, ResultProjection } from '@/types'

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
