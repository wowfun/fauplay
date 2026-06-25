import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  resolveProjectionFileInteractionPlan,
  type ProjectionFileInteractionPlan,
} from '@/features/workspace/lib/projectionTabActivation'
import {
  resolveProjectionFocusedPathByIdUpdate,
  type WorkspaceActiveSurface,
} from '@/features/workspace/lib/projectionTabRecords'
import type { WorkspaceProjectionInteraction } from '@/features/workspace/types/projectionInteraction'
import type { FileItem } from '@/types'

interface UseWorkspaceProjectionFileInteractionParams {
  activeProjectionTabId: string | null | undefined
  interactionRef: MutableRefObject<WorkspaceProjectionInteraction | null>
  lastProjectionTabIdRef: MutableRefObject<string | null>
  setActiveProjectionTabId: Dispatch<SetStateAction<string | null>>
  setActiveSurface: Dispatch<SetStateAction<WorkspaceActiveSurface>>
  setProjectionFocusedPathById: Dispatch<SetStateAction<Record<string, string | null>>>
}

export function useWorkspaceProjectionFileInteraction({
  activeProjectionTabId,
  interactionRef,
  lastProjectionTabIdRef,
  setActiveProjectionTabId,
  setActiveSurface,
  setProjectionFocusedPathById,
}: UseWorkspaceProjectionFileInteractionParams) {
  const applyProjectionFileInteractionPlan = useCallback((plan: ProjectionFileInteractionPlan) => {
    if (plan.kind === 'none') {
      return
    }

    setActiveProjectionTabId(plan.activeProjectionTabId)
    lastProjectionTabIdRef.current = plan.lastProjectionTabId
    setActiveSurface(plan.activeSurface)
    if (plan.focusedPath) {
      setProjectionFocusedPathById((previous) => (
        resolveProjectionFocusedPathByIdUpdate(previous, plan.activeProjectionTabId, plan.focusedPath)
      ))
    }
    if (plan.openFile?.target === 'primary') {
      interactionRef.current?.openFileInPrimaryTarget(plan.openFile.file)
    }
    if (plan.openFile?.target === 'secondary') {
      interactionRef.current?.openFileInSecondaryTarget(plan.openFile.file)
    }
  }, [
    interactionRef,
    lastProjectionTabIdRef,
    setActiveProjectionTabId,
    setActiveSurface,
    setProjectionFocusedPathById,
  ])

  const handleProjectionFileClick = useCallback((file: FileItem) => {
    applyProjectionFileInteractionPlan(resolveProjectionFileInteractionPlan({
      activeProjectionTabId,
      item: file,
      trigger: 'click',
    }))
  }, [activeProjectionTabId, applyProjectionFileInteractionPlan])

  const handleProjectionFileDoubleClick = useCallback((file: FileItem) => {
    applyProjectionFileInteractionPlan(resolveProjectionFileInteractionPlan({
      activeProjectionTabId,
      item: file,
      trigger: 'double-click',
    }))
  }, [activeProjectionTabId, applyProjectionFileInteractionPlan])

  return {
    handleProjectionFileClick,
    handleProjectionFileDoubleClick,
  }
}
