import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { DuplicateSelectionRule } from '@/features/workspace/lib/duplicateSelection'
import {
  pruneProjectionTabsAfterDeletedFiles,
  resolveProjectionTabCloseState,
} from '@/features/workspace/lib/projectionTabClosure'
import type { WorkspaceActiveSurface } from '@/features/workspace/lib/projectionTabRecords'
import type { WorkspaceProjectionInteraction } from '@/features/workspace/types/projectionInteraction'
import { toToolScopedProjectionId } from '@/lib/projection'
import type { ResultProjection } from '@/types'

interface PruneDeletedProjectionTabsParams {
  deletedAbsolutePaths?: string[]
  deletedProjectionPaths?: string[]
  projectionTabId?: string | null
}

interface UseWorkspaceProjectionTabLifecycleParams {
  projectionTabs: ResultProjection[]
  projectionSelectedPathsById: Record<string, string[]>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  projectionFocusedPathById: Record<string, string | null>
  activeProjectionTabId: string | null
  activeSurface: WorkspaceActiveSurface
  directoryFocusedPath: string | null
  lastProjectionTabIdRef: MutableRefObject<string | null>
  deletedProjectionAbsolutePathSetRef: MutableRefObject<Set<string>>
  interactionRef: MutableRefObject<WorkspaceProjectionInteraction | null>
  setProjectionTabs: Dispatch<SetStateAction<ResultProjection[]>>
  setProjectionSelectedPathsById: Dispatch<SetStateAction<Record<string, string[]>>>
  setDuplicateSelectionRuleByProjectionId: Dispatch<SetStateAction<Record<string, DuplicateSelectionRule | null>>>
  setProjectionFocusedPathById: Dispatch<SetStateAction<Record<string, string | null>>>
  setActiveProjectionTabId: Dispatch<SetStateAction<string | null>>
  setActiveSurface: Dispatch<SetStateAction<WorkspaceActiveSurface>>
  setIsResultPanelOpen: (isOpen: boolean) => void
}

export function useWorkspaceProjectionTabLifecycle({
  projectionTabs,
  projectionSelectedPathsById,
  duplicateSelectionRuleByProjectionId,
  projectionFocusedPathById,
  activeProjectionTabId,
  activeSurface,
  directoryFocusedPath,
  lastProjectionTabIdRef,
  deletedProjectionAbsolutePathSetRef,
  interactionRef,
  setProjectionTabs,
  setProjectionSelectedPathsById,
  setDuplicateSelectionRuleByProjectionId,
  setProjectionFocusedPathById,
  setActiveProjectionTabId,
  setActiveSurface,
  setIsResultPanelOpen,
}: UseWorkspaceProjectionTabLifecycleParams) {
  const handleCloseProjectionTab = useCallback((tabId: string) => {
    const nextState = resolveProjectionTabCloseState({
      projectionTabs,
      projectionSelectedPathsById,
      duplicateSelectionRuleByProjectionId,
      projectionFocusedPathById,
      activeSurface,
      lastProjectionTabId: lastProjectionTabIdRef.current,
      closingTabId: tabId,
    })

    setProjectionTabs(nextState.projectionTabs)
    setProjectionSelectedPathsById(nextState.projectionSelectedPathsById)
    setDuplicateSelectionRuleByProjectionId(nextState.duplicateSelectionRuleByProjectionId)
    setProjectionFocusedPathById(nextState.projectionFocusedPathById)
    setActiveProjectionTabId(nextState.activeProjectionTabId)
    setActiveSurface(nextState.activeSurface)
    lastProjectionTabIdRef.current = nextState.lastProjectionTabId

    if (nextState.shouldCloseResultPanel) {
      setIsResultPanelOpen(false)
    }
    if (nextState.previewAlignment.kind === 'directory') {
      interactionRef.current?.alignPreviewToPath(directoryFocusedPath)
    }
    if (nextState.previewAlignment.kind === 'projection') {
      interactionRef.current?.alignPreviewToPath(nextState.previewAlignment.path)
    }
  }, [
    activeSurface,
    directoryFocusedPath,
    duplicateSelectionRuleByProjectionId,
    interactionRef,
    lastProjectionTabIdRef,
    projectionFocusedPathById,
    projectionSelectedPathsById,
    projectionTabs,
    setActiveProjectionTabId,
    setActiveSurface,
    setDuplicateSelectionRuleByProjectionId,
    setIsResultPanelOpen,
    setProjectionFocusedPathById,
    setProjectionSelectedPathsById,
    setProjectionTabs,
  ])

  const handleDismissProjectionTool = useCallback((toolName: string) => {
    handleCloseProjectionTab(toToolScopedProjectionId(toolName))
  }, [handleCloseProjectionTab])

  const pruneDeletedFilesFromProjectionTabs = useCallback((params: PruneDeletedProjectionTabsParams) => {
    if (projectionTabs.length === 0) {
      return
    }

    const deletedAbsolutePaths = [
      ...new Set(
        (params.deletedAbsolutePaths ?? [])
          .map((item) => item.trim())
          .filter(Boolean)
      ),
    ]
    for (const absolutePath of deletedAbsolutePaths) {
      deletedProjectionAbsolutePathSetRef.current.add(absolutePath)
    }
    const nextState = pruneProjectionTabsAfterDeletedFiles({
      projectionTabs,
      projectionSelectedPathsById,
      duplicateSelectionRuleByProjectionId,
      projectionFocusedPathById,
      activeProjectionTabId,
      activeSurface,
      lastProjectionTabId: lastProjectionTabIdRef.current,
      deletedAbsolutePaths,
      deletedProjectionPaths: params.deletedProjectionPaths,
      projectionTabId: params.projectionTabId,
    })
    if (!nextState) return

    setProjectionTabs(nextState.projectionTabs)
    setProjectionSelectedPathsById(nextState.projectionSelectedPathsById)
    setDuplicateSelectionRuleByProjectionId(nextState.duplicateSelectionRuleByProjectionId)
    setProjectionFocusedPathById(nextState.projectionFocusedPathById)
    setActiveProjectionTabId(nextState.activeProjectionTabId)
    setActiveSurface(nextState.activeSurface)
    lastProjectionTabIdRef.current = nextState.lastProjectionTabId
    if (nextState.shouldCloseResultPanel) {
      setIsResultPanelOpen(false)
    }
  }, [
    activeProjectionTabId,
    activeSurface,
    deletedProjectionAbsolutePathSetRef,
    duplicateSelectionRuleByProjectionId,
    lastProjectionTabIdRef,
    projectionFocusedPathById,
    projectionSelectedPathsById,
    projectionTabs,
    setActiveProjectionTabId,
    setActiveSurface,
    setDuplicateSelectionRuleByProjectionId,
    setIsResultPanelOpen,
    setProjectionFocusedPathById,
    setProjectionSelectedPathsById,
    setProjectionTabs,
  ])

  const forgetDeletedProjectionAbsolutePath = useCallback((absolutePath: string) => {
    deletedProjectionAbsolutePathSetRef.current.delete(absolutePath)
  }, [deletedProjectionAbsolutePathSetRef])

  return {
    handleCloseProjectionTab,
    handleDismissProjectionTool,
    pruneDeletedFilesFromProjectionTabs,
    forgetDeletedProjectionAbsolutePath,
  }
}
