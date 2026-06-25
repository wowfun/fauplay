import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import type { FileItem } from '@/types'
import type { WorkspaceMutationCommitParams } from '../types/mutation.ts'
import {
  resolveWorkspaceMutationDeleteUndoPlan,
  shouldCreateDeleteUndoBatchForMutation,
  type DeleteUndoProjectionPruneParams,
} from './deleteUndoMutationPlan.ts'
import {
  resolveWorkspacePreviewMutationPlan,
  type PruneDeletedProjectionTabsParams,
  type WorkspacePreviewMutationSurface,
} from './previewMutationPlan.ts'

export type WorkspaceMutationCommitPruneParams =
  | DeleteUndoProjectionPruneParams
  | PruneDeletedProjectionTabsParams

export type WorkspaceMutationCommitEffect =
  | { kind: 'prune-deleted-projection-tabs'; params: WorkspaceMutationCommitPruneParams }
  | { kind: 'align-preview-to-path'; path: string }
  | { kind: 'navigate-media-next'; target: 'modal' | 'pane' }
  | { kind: 'open-file'; target: 'modal' | 'primary'; file: FileItem }
  | { kind: 'refresh-current-path' }
  | { kind: 'refresh-filter-tag-snapshots' }
  | { kind: 'push-delete-undo-batch' }

export interface ResolveWorkspacePreviewMutationCommitEffectsParams {
  params?: PreviewMutationCommitParams
  activeSurface: WorkspacePreviewMutationSurface
  activeSurfaceFileItems: FileItem[]
  activePreviewFile: FileItem | null
  isPreviewModalOpen: boolean
}

export interface WorkspaceMutationCommitEffectHandlers {
  pruneDeletedProjectionTabs: (params: WorkspaceMutationCommitPruneParams) => void
  alignPreviewToPath: (path: string) => void
  navigateMediaNext: (target: 'modal' | 'pane') => void
  openFile: (target: 'modal' | 'primary', file: FileItem) => void
  refreshCurrentPath: () => void | Promise<void>
  refreshFilterTagSnapshots: () => void | Promise<void>
  pushDeleteUndoBatch: () => void
}

export function resolveWorkspaceMutationCommitEffects(
  params?: WorkspaceMutationCommitParams
): WorkspaceMutationCommitEffect[] {
  const deleteUndoPlan = resolveWorkspaceMutationDeleteUndoPlan(params)
  const effects: WorkspaceMutationCommitEffect[] = []

  if (deleteUndoPlan.shouldPruneDeletedProjectionTabs && deleteUndoPlan.pruneDeletedProjectionTabsParams) {
    effects.push({
      kind: 'prune-deleted-projection-tabs',
      params: deleteUndoPlan.pruneDeletedProjectionTabsParams,
    })
  }

  return appendMutationRefreshEffects(effects, params)
}

export function resolveWorkspacePreviewMutationCommitEffects({
  params,
  activeSurface,
  activeSurfaceFileItems,
  activePreviewFile,
  isPreviewModalOpen,
}: ResolveWorkspacePreviewMutationCommitEffectsParams): WorkspaceMutationCommitEffect[] {
  const mutationPlan = resolveWorkspacePreviewMutationPlan({
    params,
    activeSurface,
    activeSurfaceFileItems,
    activePreviewFile,
    isPreviewModalOpen,
  })
  const effects: WorkspaceMutationCommitEffect[] = []

  if (mutationPlan.preferredPreviewPath) {
    effects.push({
      kind: 'align-preview-to-path',
      path: mutationPlan.preferredPreviewPath,
    })
    return appendMutationRefreshEffects(effects, params)
  }

  if (mutationPlan.shouldPruneDeletedProjectionTabs) {
    effects.push({
      kind: 'prune-deleted-projection-tabs',
      params: mutationPlan.pruneDeletedProjectionTabsParams,
    })
  }

  if (mutationPlan.previewContinuation.kind === 'navigate-media-next') {
    effects.push({
      kind: 'navigate-media-next',
      target: mutationPlan.previewContinuation.target,
    })
  }

  if (mutationPlan.previewContinuation.kind === 'open-file') {
    effects.push({
      kind: 'open-file',
      target: mutationPlan.previewContinuation.target,
      file: mutationPlan.previewContinuation.file,
    })
  }

  return appendMutationRefreshEffects(effects, params)
}

export async function runWorkspaceMutationCommitEffects(
  effects: WorkspaceMutationCommitEffect[],
  handlers: WorkspaceMutationCommitEffectHandlers
): Promise<void> {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'prune-deleted-projection-tabs':
        handlers.pruneDeletedProjectionTabs(effect.params)
        break
      case 'align-preview-to-path':
        handlers.alignPreviewToPath(effect.path)
        break
      case 'navigate-media-next':
        handlers.navigateMediaNext(effect.target)
        break
      case 'open-file':
        handlers.openFile(effect.target, effect.file)
        break
      case 'refresh-current-path':
        await handlers.refreshCurrentPath()
        break
      case 'refresh-filter-tag-snapshots':
        await handlers.refreshFilterTagSnapshots()
        break
      case 'push-delete-undo-batch':
        handlers.pushDeleteUndoBatch()
        break
    }
  }
}

function appendMutationRefreshEffects(
  effects: WorkspaceMutationCommitEffect[],
  params: WorkspaceMutationCommitParams | PreviewMutationCommitParams | undefined
): WorkspaceMutationCommitEffect[] {
  effects.push(
    { kind: 'refresh-current-path' },
    { kind: 'refresh-filter-tag-snapshots' },
  )

  if (shouldCreateDeleteUndoBatchForMutation(params)) {
    effects.push({ kind: 'push-delete-undo-batch' })
  }

  return effects
}
