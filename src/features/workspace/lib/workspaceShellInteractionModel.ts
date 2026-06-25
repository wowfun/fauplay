import type { FileItem, FilterState } from '../../../types/index.ts'
import type { ViewportMode } from '../types/presentation.ts'

export const WORKSPACE_TRASH_ROUTE_PATH = '@trash'

export type WorkspaceShellPresentationTransitionIntent =
  | { kind: 'none' }
  | { kind: 'close-preview-pane'; openFileInLightbox: FileItem | null }

export interface ResolveWorkspaceShellPresentationTransitionParams {
  previousShellKind: ViewportMode
  currentShellKind: ViewportMode
  supportsPersistentPreviewPane: boolean
  showPreviewPane: boolean
  selectedFile: FileItem | null
  previewFile: FileItem | null
}

export type WorkspaceDirectoryEntryInteraction =
  | { kind: 'directory-name-click'; dirName: string }
  | { kind: 'entry-click'; item: FileItem }
  | { kind: 'entry-double-click'; item: FileItem }

export type WorkspaceDirectoryEntryInteractionIntent =
  | { kind: 'none' }
  | { kind: 'navigate-directory'; dirName: string }
  | { kind: 'open-file'; file: FileItem; focusedPath: string; target: 'primary' | 'secondary' }

export type WorkspaceTrashNavigationIntent =
  | { kind: 'none' }
  | { kind: 'navigate-to-path'; path: string; resetFlattenView: boolean }

export type WorkspaceShellSurfaceResetIntent =
  | { kind: 'none' }
  | { kind: 'reset-directory-surface' }
  | { kind: 'reset-workspace-surface' }

export interface ResolveWorkspaceShellNavigationContextTransitionParams {
  previousRootId: string | null
  currentRootId: string | null
  previousCurrentPath: string | null
  currentPath: string | null
}

export type WorkspaceAnnotationFilterGateIntent =
  | { kind: 'none' }
  | { kind: 'reset-annotation-filter'; filter: FilterState }

export interface ResolveWorkspaceAnnotationFilterGateIntentParams {
  isAnnotationFilterGateResolved: boolean
  isReviewFilterGateResolved: boolean
  showAnnotationFilterControls: boolean
  filter: FilterState
}

export function resolveWorkspaceShellPresentationTransition({
  previousShellKind,
  currentShellKind,
  supportsPersistentPreviewPane,
  showPreviewPane,
  selectedFile,
  previewFile,
}: ResolveWorkspaceShellPresentationTransitionParams): WorkspaceShellPresentationTransitionIntent {
  if (previousShellKind === currentShellKind) return { kind: 'none' }
  if (supportsPersistentPreviewPane) return { kind: 'none' }
  if (!showPreviewPane || selectedFile?.kind !== 'file') return { kind: 'none' }

  return {
    kind: 'close-preview-pane',
    openFileInLightbox: previewFile ? null : selectedFile,
  }
}

export function resolveWorkspaceTrashNavigationIntent({
  hasTrashEntries,
}: {
  hasTrashEntries: boolean
}): WorkspaceTrashNavigationIntent {
  if (!hasTrashEntries) return { kind: 'none' }
  return {
    kind: 'navigate-to-path',
    path: WORKSPACE_TRASH_ROUTE_PATH,
    resetFlattenView: true,
  }
}

export function resolveWorkspaceShellNavigationContextTransition({
  previousRootId,
  currentRootId,
  previousCurrentPath,
  currentPath,
}: ResolveWorkspaceShellNavigationContextTransitionParams): WorkspaceShellSurfaceResetIntent {
  if (previousRootId !== null && previousRootId !== currentRootId) {
    return { kind: 'reset-workspace-surface' }
  }

  if (previousCurrentPath !== null && previousCurrentPath !== currentPath) {
    return { kind: 'reset-directory-surface' }
  }

  return { kind: 'none' }
}

export function resolveWorkspaceAnnotationFilterGateIntent({
  isAnnotationFilterGateResolved,
  isReviewFilterGateResolved,
  showAnnotationFilterControls,
  filter,
}: ResolveWorkspaceAnnotationFilterGateIntentParams): WorkspaceAnnotationFilterGateIntent {
  if (!isAnnotationFilterGateResolved || !isReviewFilterGateResolved || showAnnotationFilterControls) {
    return { kind: 'none' }
  }
  if (isWorkspaceAnnotationFilterAtDefault(filter)) return { kind: 'none' }

  return {
    kind: 'reset-annotation-filter',
    filter: {
      ...filter,
      annotationFilterMode: 'all',
      annotationIncludeMatchMode: 'or',
      annotationIncludeTagKeys: [],
      annotationExcludeTagKeys: [],
    },
  }
}

function isWorkspaceAnnotationFilterAtDefault(filter: FilterState): boolean {
  return (
    filter.annotationFilterMode === 'all'
    && filter.annotationIncludeMatchMode === 'or'
    && filter.annotationIncludeTagKeys.length === 0
    && filter.annotationExcludeTagKeys.length === 0
  )
}

export function resolveWorkspaceDirectoryEntryInteraction(
  interaction: WorkspaceDirectoryEntryInteraction
): WorkspaceDirectoryEntryInteractionIntent {
  if (interaction.kind === 'directory-name-click') {
    return {
      kind: 'navigate-directory',
      dirName: interaction.dirName,
    }
  }

  if (interaction.item.kind === 'directory') {
    if (interaction.kind === 'entry-click') {
      return {
        kind: 'navigate-directory',
        dirName: interaction.item.name,
      }
    }
    return { kind: 'none' }
  }

  return {
    kind: 'open-file',
    file: interaction.item,
    focusedPath: interaction.item.path,
    target: interaction.kind === 'entry-double-click' ? 'secondary' : 'primary',
  }
}
