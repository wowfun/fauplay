import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  resolveProjectionActivationPlan,
  resolveProjectionPanelDisplayTogglePlan,
  type ProjectionActivationPlan,
} from '@/features/workspace/lib/projectionTabActivation'
import {
  resolveProjectionPreferredPath,
  type WorkspaceActiveSurface,
} from '@/features/workspace/lib/projectionTabRecords'
import type { WorkspaceProjectionInteraction } from '@/features/workspace/types/projectionInteraction'
import type { ResultPanelDisplayMode, ResultProjection } from '@/types'

interface UseWorkspaceProjectionActivationParams {
  projectionTabs: ResultProjection[]
  activeProjectionTab: ResultProjection | null
  activeProjectionTabId: string | null
  activeSurface: WorkspaceActiveSurface
  projectionFocusedPathById: Record<string, string | null>
  directoryFocusedPath: string | null
  isResultPanelOpen: boolean
  resultPanelDisplayMode: ResultPanelDisplayMode
  lastProjectionTabIdRef: MutableRefObject<string | null>
  deletedProjectionAbsolutePathSetRef: MutableRefObject<Set<string>>
  lastNormalResultPanelHeightRef: MutableRefObject<number>
  interactionRef: MutableRefObject<WorkspaceProjectionInteraction | null>
  setProjectionTabs: Dispatch<SetStateAction<ResultProjection[]>>
  setActiveProjectionTabId: Dispatch<SetStateAction<string | null>>
  setActiveSurface: Dispatch<SetStateAction<WorkspaceActiveSurface>>
  setIsResultPanelOpen: (isOpen: boolean) => void
  setResultPanelDisplayMode: Dispatch<SetStateAction<ResultPanelDisplayMode>>
  setResultPanelHeightPx: Dispatch<SetStateAction<number>>
  setProjectionSelectedPathsForTab: (tabId: string, selectedPaths: string[]) => void
}

export function useWorkspaceProjectionActivation({
  projectionTabs,
  activeProjectionTab,
  activeProjectionTabId,
  activeSurface,
  projectionFocusedPathById,
  directoryFocusedPath,
  isResultPanelOpen,
  resultPanelDisplayMode,
  lastProjectionTabIdRef,
  deletedProjectionAbsolutePathSetRef,
  lastNormalResultPanelHeightRef,
  interactionRef,
  setProjectionTabs,
  setActiveProjectionTabId,
  setActiveSurface,
  setIsResultPanelOpen,
  setResultPanelDisplayMode,
  setResultPanelHeightPx,
  setProjectionSelectedPathsForTab,
}: UseWorkspaceProjectionActivationParams) {
  const alignPreviewToProjection = useCallback((
    projection: ResultProjection | null,
    preferredPath?: string | null
  ) => {
    interactionRef.current?.alignPreviewToPath(resolveProjectionPreferredPath(projection, preferredPath))
  }, [interactionRef])

  const applyProjectionActivationPlan = useCallback((plan: ProjectionActivationPlan) => {
    if (plan.kind === 'none') {
      return
    }
    setProjectionTabs(plan.projectionTabs)
    if (plan.shouldOpenResultPanel) {
      setIsResultPanelOpen(true)
    }
    setActiveProjectionTabId(plan.activeProjectionTabId)
    lastProjectionTabIdRef.current = plan.lastProjectionTabId
    setActiveSurface(plan.activeSurface)
    interactionRef.current?.alignPreviewToPath(plan.previewAlignment.path)
  }, [
    interactionRef,
    lastProjectionTabIdRef,
    setActiveProjectionTabId,
    setActiveSurface,
    setIsResultPanelOpen,
    setProjectionTabs,
  ])

  const activateProjectionSurfaceWithoutPreviewAlignment = useCallback((tabId: string) => {
    if (!isResultPanelOpen) {
      setIsResultPanelOpen(true)
    }
    if (activeProjectionTabId !== tabId) {
      setActiveProjectionTabId(tabId)
    }
    if (lastProjectionTabIdRef.current !== tabId) {
      lastProjectionTabIdRef.current = tabId
    }
    if (activeSurface.kind !== 'projection' || activeSurface.tabId !== tabId) {
      setActiveSurface({ kind: 'projection', tabId })
    }
  }, [
    activeProjectionTabId,
    activeSurface,
    isResultPanelOpen,
    lastProjectionTabIdRef,
    setActiveProjectionTabId,
    setActiveSurface,
    setIsResultPanelOpen,
  ])

  const handleActivateProjection = useCallback((projection: ResultProjection) => {
    applyProjectionActivationPlan(resolveProjectionActivationPlan({
      projectionTabs,
      target: {
        kind: 'projection',
        projection,
      },
      projectionFocusedPathById,
      deletedAbsolutePaths: deletedProjectionAbsolutePathSetRef.current,
    }))
  }, [
    applyProjectionActivationPlan,
    deletedProjectionAbsolutePathSetRef,
    projectionFocusedPathById,
    projectionTabs,
  ])

  const handleActivateProjectionTab = useCallback((tabId: string) => {
    applyProjectionActivationPlan(resolveProjectionActivationPlan({
      projectionTabs,
      target: {
        kind: 'tab',
        tabId,
      },
      projectionFocusedPathById,
    }))
  }, [applyProjectionActivationPlan, projectionFocusedPathById, projectionTabs])

  const handleOpenResultPanel = useCallback(() => {
    applyProjectionActivationPlan(resolveProjectionActivationPlan({
      projectionTabs,
      target: {
        kind: 'fallback',
        activeProjectionTabId: activeProjectionTab?.id ?? null,
        lastProjectionTabId: lastProjectionTabIdRef.current,
      },
      projectionFocusedPathById,
    }))
  }, [
    activeProjectionTab?.id,
    applyProjectionActivationPlan,
    lastProjectionTabIdRef,
    projectionFocusedPathById,
    projectionTabs,
  ])

  const handleCloseResultPanel = useCallback(() => {
    setIsResultPanelOpen(false)
    setActiveSurface({ kind: 'directory' })
    interactionRef.current?.alignPreviewToPath(directoryFocusedPath)
  }, [directoryFocusedPath, interactionRef, setActiveSurface, setIsResultPanelOpen])

  const handleToggleResultPanelMaximized = useCallback(() => {
    const plan = resolveProjectionPanelDisplayTogglePlan({
      projectionTabs,
      activeProjectionTabId,
      projectionFocusedPathById,
      currentDisplayMode: resultPanelDisplayMode,
      lastNormalHeightPx: lastNormalResultPanelHeightRef.current,
    })

    if (plan.activation) {
      setActiveProjectionTabId(plan.activation.activeProjectionTabId)
      lastProjectionTabIdRef.current = plan.activation.lastProjectionTabId
      setActiveSurface(plan.activation.activeSurface)
      interactionRef.current?.alignPreviewToPath(plan.activation.previewAlignment.path)
    }
    if (plan.nextHeightPx !== null) {
      setResultPanelHeightPx(plan.nextHeightPx)
    }
    setResultPanelDisplayMode(plan.nextDisplayMode)
  }, [
    activeProjectionTabId,
    interactionRef,
    lastNormalResultPanelHeightRef,
    lastProjectionTabIdRef,
    projectionFocusedPathById,
    projectionTabs,
    resultPanelDisplayMode,
    setActiveProjectionTabId,
    setActiveSurface,
    setResultPanelDisplayMode,
    setResultPanelHeightPx,
  ])

  const handleProjectionGridSelectionChange = useCallback((selectedPaths: string[]) => {
    if (!activeProjectionTabId) return
    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTabId)
    setProjectionSelectedPathsForTab(activeProjectionTabId, selectedPaths)
  }, [
    activeProjectionTabId,
    activateProjectionSurfaceWithoutPreviewAlignment,
    setProjectionSelectedPathsForTab,
  ])

  return {
    alignPreviewToProjection,
    handleActivateProjection,
    handleActivateProjectionTab,
    handleOpenResultPanel,
    handleCloseResultPanel,
    handleToggleResultPanelMaximized,
    handleProjectionGridSelectionChange,
  }
}
