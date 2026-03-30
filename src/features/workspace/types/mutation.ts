import type { DeleteUndoRestoreItem } from '@/features/workspace/lib/deleteUndo'

export interface WorkspaceMutationCommitParams {
  mutationToolName?: string
  deletedAbsolutePaths?: string[]
  deletedProjectionPaths?: string[]
  projectionTabId?: string | null
  undoRestoreItems?: DeleteUndoRestoreItem[]
}
