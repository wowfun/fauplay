export interface WorkspaceMutationCommitParams {
  mutationToolName?: string
  deletedAbsolutePaths?: string[]
  deletedProjectionPaths?: string[]
  projectionTabId?: string | null
}
