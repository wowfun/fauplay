import type { DeleteUndoRestoreItem } from '@/features/workspace/lib/deleteUndo'

export interface PreviewMutationCommitParams {
  preferredPreviewPath?: string
  mutationToolName?: string
  deletedRelativePath?: string
  deletedAbsolutePaths?: string[]
  deletedProjectionPaths?: string[]
  projectionTabId?: string | null
  undoRestoreItems?: DeleteUndoRestoreItem[]
}
