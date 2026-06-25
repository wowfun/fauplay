import type { FileItem } from '../../../types/index.ts'
import type { ViewportMode } from '../types/presentation.ts'

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
