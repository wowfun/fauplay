import type { PreviewMutationCommitParams } from '../../preview/types/mutation.ts'
import { getFilePreviewKind, isMediaPreviewKind } from '../../../lib/filePreview.ts'
import type { FileItem } from '../../../types/index.ts'
import { normalizeRootRelativePath } from './projectionTabs.ts'

export type WorkspacePreviewMutationSurface =
  | { kind: 'directory' }
  | { kind: 'projection'; tabId: string }

export type WorkspacePreviewContinuation =
  | { kind: 'none' }
  | { kind: 'navigate-media-next'; target: 'modal' | 'pane' }
  | { kind: 'open-file'; target: 'modal' | 'primary'; file: FileItem }

export interface PruneDeletedProjectionTabsParams {
  deletedAbsolutePaths: string[]
  deletedProjectionPaths: string[]
  projectionTabId: string | null
}

export interface ResolveWorkspacePreviewMutationPlanParams {
  params?: PreviewMutationCommitParams
  activeSurface: WorkspacePreviewMutationSurface
  activeSurfaceFileItems: FileItem[]
  activePreviewFile: FileItem | null
  isPreviewModalOpen: boolean
}

export interface WorkspacePreviewMutationPlan {
  preferredPreviewPath: string
  shouldPruneDeletedProjectionTabs: boolean
  pruneDeletedProjectionTabsParams: PruneDeletedProjectionTabsParams
  previewContinuation: WorkspacePreviewContinuation
}

export function resolveWorkspacePreviewMutationPlan({
  params,
  activeSurface,
  activeSurfaceFileItems,
  activePreviewFile,
  isPreviewModalOpen,
}: ResolveWorkspacePreviewMutationPlanParams): WorkspacePreviewMutationPlan {
  const preferredPreviewPath = normalizeRootRelativePath(params?.preferredPreviewPath || '')
  if (preferredPreviewPath) {
    return {
      preferredPreviewPath,
      shouldPruneDeletedProjectionTabs: false,
      pruneDeletedProjectionTabsParams: emptyPruneDeletedProjectionTabsParams(),
      previewContinuation: { kind: 'none' },
    }
  }

  if (params?.mutationToolName !== 'fs.softDelete') {
    return {
      preferredPreviewPath: '',
      shouldPruneDeletedProjectionTabs: false,
      pruneDeletedProjectionTabsParams: emptyPruneDeletedProjectionTabsParams(),
      previewContinuation: { kind: 'none' },
    }
  }

  const fallbackProjectionTabId = params.projectionTabId
    ?? (activeSurface.kind === 'projection' ? activeSurface.tabId : null)
  const fallbackDeletedProjectionPaths = (
    Array.isArray(params.deletedProjectionPaths) && params.deletedProjectionPaths.length > 0
  )
    ? params.deletedProjectionPaths
    : (
      fallbackProjectionTabId && activePreviewFile?.kind === 'file'
        ? [activePreviewFile.path]
        : []
    )
  const fallbackDeletedAbsolutePaths = (
    Array.isArray(params.deletedAbsolutePaths) && params.deletedAbsolutePaths.length > 0
  )
    ? params.deletedAbsolutePaths
    : (
      activePreviewFile?.kind === 'file'
      && typeof activePreviewFile.absolutePath === 'string'
      && activePreviewFile.absolutePath.trim()
        ? [activePreviewFile.absolutePath.trim()]
        : []
    )
  const pruneDeletedProjectionTabsParams = {
    deletedAbsolutePaths: fallbackDeletedAbsolutePaths,
    deletedProjectionPaths: fallbackDeletedProjectionPaths,
    projectionTabId: fallbackProjectionTabId,
  }

  return {
    preferredPreviewPath: '',
    shouldPruneDeletedProjectionTabs: (
      fallbackDeletedAbsolutePaths.length > 0 || fallbackDeletedProjectionPaths.length > 0
    ),
    pruneDeletedProjectionTabsParams,
    previewContinuation: resolvePreviewContinuationAfterDelete({
      deletedRelativePath: params.deletedRelativePath,
      activeSurfaceFileItems,
      activePreviewFile,
      isPreviewModalOpen,
    }),
  }
}

function resolvePreviewContinuationAfterDelete({
  deletedRelativePath,
  activeSurfaceFileItems,
  activePreviewFile,
  isPreviewModalOpen,
}: Pick<
  ResolveWorkspacePreviewMutationPlanParams,
  | 'activeSurfaceFileItems'
  | 'activePreviewFile'
  | 'isPreviewModalOpen'
> & {
  deletedRelativePath?: string
}): WorkspacePreviewContinuation {
  const normalizedDeletedPath = normalizeRootRelativePath(deletedRelativePath || '')
  const activePreviewPath = activePreviewFile?.kind === 'file'
    ? normalizeRootRelativePath(activePreviewFile.path)
    : ''

  if (
    !normalizedDeletedPath
    || activePreviewFile?.kind !== 'file'
    || activePreviewPath !== normalizedDeletedPath
  ) {
    return { kind: 'none' }
  }

  const previewKind = getFilePreviewKind(activePreviewFile.name)
  if (isMediaPreviewKind(previewKind)) {
    return {
      kind: 'navigate-media-next',
      target: isPreviewModalOpen ? 'modal' : 'pane',
    }
  }

  const nextFile = resolveNextWorkspaceFileAfterDelete(normalizedDeletedPath, activeSurfaceFileItems)
  if (!nextFile) {
    return { kind: 'none' }
  }

  return {
    kind: 'open-file',
    target: isPreviewModalOpen ? 'modal' : 'primary',
    file: nextFile,
  }
}

function resolveNextWorkspaceFileAfterDelete(
  deletedRelativePath: string,
  activeSurfaceFileItems: FileItem[]
): FileItem | null {
  const normalizedDeletedPath = normalizeRootRelativePath(deletedRelativePath)
  if (!normalizedDeletedPath || activeSurfaceFileItems.length <= 1) return null

  const deletedIndex = activeSurfaceFileItems.findIndex((file) => (
    normalizeRootRelativePath(file.path) === normalizedDeletedPath
  ))
  if (deletedIndex < 0) return null

  const nextIndex = (deletedIndex + 1) % activeSurfaceFileItems.length
  const nextFile = activeSurfaceFileItems[nextIndex]
  if (!nextFile) return null
  if (normalizeRootRelativePath(nextFile.path) === normalizedDeletedPath) return null
  return nextFile
}

function emptyPruneDeletedProjectionTabsParams(): PruneDeletedProjectionTabsParams {
  return {
    deletedAbsolutePaths: [],
    deletedProjectionPaths: [],
    projectionTabId: null,
  }
}
