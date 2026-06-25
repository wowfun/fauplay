import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import type { WorkspaceMutationCommitParams } from '../types/mutation.ts'

type DeleteUndoMutationCommitParams = WorkspaceMutationCommitParams | PreviewMutationCommitParams | undefined

export interface DeleteUndoProjectionPruneParams {
  deletedAbsolutePaths?: string[]
  deletedProjectionPaths?: string[]
  projectionTabId?: string | null
}

export interface WorkspaceMutationDeleteUndoPlan {
  shouldCreateDeleteUndoBatch: boolean
  shouldPruneDeletedProjectionTabs: boolean
  pruneDeletedProjectionTabsParams: DeleteUndoProjectionPruneParams | null
}

const SOFT_DELETE_TOOL_NAME = 'fs.softDelete'

export function shouldCreateDeleteUndoBatchForMutation(params: DeleteUndoMutationCommitParams): boolean {
  return params?.mutationToolName === SOFT_DELETE_TOOL_NAME
}

export function resolveWorkspaceMutationDeleteUndoPlan(
  params: WorkspaceMutationCommitParams | undefined
): WorkspaceMutationDeleteUndoPlan {
  const shouldCreateDeleteUndoBatch = shouldCreateDeleteUndoBatchForMutation(params)
  if (!shouldCreateDeleteUndoBatch || !hasDeletedProjectionTargets(params)) {
    return {
      shouldCreateDeleteUndoBatch,
      shouldPruneDeletedProjectionTabs: false,
      pruneDeletedProjectionTabsParams: null,
    }
  }

  return {
    shouldCreateDeleteUndoBatch,
    shouldPruneDeletedProjectionTabs: true,
    pruneDeletedProjectionTabsParams: {
      deletedAbsolutePaths: params?.deletedAbsolutePaths,
      deletedProjectionPaths: params?.deletedProjectionPaths,
      projectionTabId: params?.projectionTabId,
    },
  }
}

function hasDeletedProjectionTargets(params: WorkspaceMutationCommitParams | undefined): boolean {
  return Boolean(
    (Array.isArray(params?.deletedAbsolutePaths) && params.deletedAbsolutePaths.length > 0)
    || (Array.isArray(params?.deletedProjectionPaths) && params.deletedProjectionPaths.length > 0)
  )
}
