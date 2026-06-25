import { useCallback } from 'react'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import type { DeleteUndoBatch } from '@/features/workspace/lib/deleteUndo'
import type { WorkspaceActiveSurface } from '@/features/workspace/lib/projectionTabRecords'
import {
  runWorkspaceMutationCommitEffects,
  resolveWorkspaceMutationCommitEffects,
  resolveWorkspacePreviewMutationCommitEffects,
  type WorkspaceMutationCommitEffect,
  type WorkspaceMutationCommitPruneParams,
} from '@/features/workspace/lib/workspaceMutationCommitPlan'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import type { FileItem } from '@/types'

interface UseWorkspaceMutationCommitControllerParams {
  currentPath: string
  activeSurface: WorkspaceActiveSurface
  activeSurfaceFileItems: FileItem[]
  selectedFile: FileItem | null
  previewFile: FileItem | null
  createDeleteUndoBatchFromParams: (
    params: WorkspaceMutationCommitParams | PreviewMutationCommitParams | undefined
  ) => DeleteUndoBatch | null
  pushDeleteUndoBatch: (batch: DeleteUndoBatch | null) => void
  pruneDeletedFilesFromProjectionTabs: (params: WorkspaceMutationCommitPruneParams) => void
  alignPreviewToPath: (path: string) => void
  navigateMediaFromModal: (direction: 'prev' | 'next') => void
  navigateMediaFromPane: (direction: 'prev' | 'next') => void
  openFileInModal: (file: FileItem) => void
  openFileInPrimaryTarget: (file: FileItem) => void
  navigateToPath: (
    targetPath: string,
    options?: { resetFlattenView?: boolean }
  ) => Promise<boolean>
  refreshFilterTagSnapshots: () => Promise<void>
}

export function useWorkspaceMutationCommitController({
  currentPath,
  activeSurface,
  activeSurfaceFileItems,
  selectedFile,
  previewFile,
  createDeleteUndoBatchFromParams,
  pushDeleteUndoBatch,
  pruneDeletedFilesFromProjectionTabs,
  alignPreviewToPath,
  navigateMediaFromModal,
  navigateMediaFromPane,
  openFileInModal,
  openFileInPrimaryTarget,
  navigateToPath,
  refreshFilterTagSnapshots,
}: UseWorkspaceMutationCommitControllerParams) {
  const runWorkspaceMutationCommitEffectPlan = useCallback(async (
    effects: WorkspaceMutationCommitEffect[],
    deleteUndoBatch: DeleteUndoBatch | null
  ) => {
    await runWorkspaceMutationCommitEffects(effects, {
      pruneDeletedProjectionTabs: pruneDeletedFilesFromProjectionTabs,
      alignPreviewToPath,
      navigateMediaNext: (target) => {
        if (target === 'modal') {
          navigateMediaFromModal('next')
        } else {
          navigateMediaFromPane('next')
        }
      },
      openFile: (target, file) => {
        if (target === 'modal') {
          openFileInModal(file)
        } else {
          openFileInPrimaryTarget(file)
        }
      },
      refreshCurrentPath: async () => {
        await navigateToPath(currentPath)
      },
      refreshFilterTagSnapshots,
      pushDeleteUndoBatch: () => pushDeleteUndoBatch(deleteUndoBatch),
    })
  }, [
    alignPreviewToPath,
    currentPath,
    navigateMediaFromModal,
    navigateMediaFromPane,
    navigateToPath,
    openFileInModal,
    openFileInPrimaryTarget,
    pruneDeletedFilesFromProjectionTabs,
    pushDeleteUndoBatch,
    refreshFilterTagSnapshots,
  ])

  const handleWorkspaceMutationCommitted = useCallback(async (
    params?: WorkspaceMutationCommitParams
  ) => {
    await runWorkspaceMutationCommitEffectPlan(
      resolveWorkspaceMutationCommitEffects(params),
      createDeleteUndoBatchFromParams(params)
    )
  }, [
    createDeleteUndoBatchFromParams,
    runWorkspaceMutationCommitEffectPlan,
  ])

  const handlePreviewMutationCommitted = useCallback(async (
    params?: PreviewMutationCommitParams
  ) => {
    const deleteUndoBatch = createDeleteUndoBatchFromParams(params)
    const activePreviewFile = previewFile ?? selectedFile
    await runWorkspaceMutationCommitEffectPlan(
      resolveWorkspacePreviewMutationCommitEffects({
        params,
        activeSurface,
        activeSurfaceFileItems,
        activePreviewFile,
        isPreviewModalOpen: Boolean(previewFile),
      }),
      deleteUndoBatch
    )
  }, [
    activeSurface,
    activeSurfaceFileItems,
    createDeleteUndoBatchFromParams,
    previewFile,
    runWorkspaceMutationCommitEffectPlan,
    selectedFile,
  ])

  return {
    handleWorkspaceMutationCommitted,
    handlePreviewMutationCommitted,
  }
}
