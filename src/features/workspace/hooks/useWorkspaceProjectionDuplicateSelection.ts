import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  type DuplicateSelectionRule,
  resolveDuplicateSelectionPlan,
  type DuplicateSelectionPlan,
  type DuplicateSelectionPlanAction,
} from '@/features/workspace/lib/duplicateSelection'
import type { WorkspaceActiveSurface } from '@/features/workspace/lib/projectionTabRecords'
import type { ResultProjection } from '@/types'

interface UseWorkspaceProjectionDuplicateSelectionParams {
  activeProjectionTab: ResultProjection | null
  activeDuplicateSelectionRule: DuplicateSelectionRule | null
  activeProjectionTabId: string | null
  activeSurface: WorkspaceActiveSurface
  isResultPanelOpen: boolean
  projectionSelectedPathsById: Record<string, string[]>
  setIsResultPanelOpen: (isOpen: boolean) => void
  setActiveProjectionTabId: Dispatch<SetStateAction<string | null>>
  setActiveSurface: Dispatch<SetStateAction<WorkspaceActiveSurface>>
  lastProjectionTabIdRef: MutableRefObject<string | null>
  setProjectionSelectedPathsForTab: (tabId: string, selectedPaths: string[]) => void
  setDuplicateSelectionRuleForTab: (tabId: string, rule: DuplicateSelectionRule | null) => void
}

export function useWorkspaceProjectionDuplicateSelection({
  activeProjectionTab,
  activeDuplicateSelectionRule,
  activeProjectionTabId,
  activeSurface,
  isResultPanelOpen,
  projectionSelectedPathsById,
  setIsResultPanelOpen,
  setActiveProjectionTabId,
  setActiveSurface,
  lastProjectionTabIdRef,
  setProjectionSelectedPathsForTab,
  setDuplicateSelectionRuleForTab,
}: UseWorkspaceProjectionDuplicateSelectionParams) {
  const applyDuplicateSelectionPlan = useCallback((plan: DuplicateSelectionPlan) => {
    if (plan.kind === 'none') {
      return
    }

    if (!isResultPanelOpen) {
      setIsResultPanelOpen(true)
    }
    if (activeProjectionTabId !== plan.activeProjectionTabId) {
      setActiveProjectionTabId(plan.activeProjectionTabId)
    }
    if (lastProjectionTabIdRef.current !== plan.lastProjectionTabId) {
      lastProjectionTabIdRef.current = plan.lastProjectionTabId
    }
    if (
      activeSurface.kind !== plan.activeSurface.kind
      || activeSurface.tabId !== plan.activeSurface.tabId
    ) {
      setActiveSurface(plan.activeSurface)
    }
    setProjectionSelectedPathsForTab(plan.activeProjectionTabId, plan.selectedPaths)
    if (plan.nextRule !== undefined) {
      setDuplicateSelectionRuleForTab(plan.activeProjectionTabId, plan.nextRule)
    }
  }, [
    activeProjectionTabId,
    activeSurface,
    isResultPanelOpen,
    lastProjectionTabIdRef,
    setActiveProjectionTabId,
    setActiveSurface,
    setIsResultPanelOpen,
    setDuplicateSelectionRuleForTab,
    setProjectionSelectedPathsForTab,
  ])

  const runDuplicateSelectionAction = useCallback((action: DuplicateSelectionPlanAction) => {
    applyDuplicateSelectionPlan(resolveDuplicateSelectionPlan({
      projection: activeProjectionTab,
      currentSelectedPaths: activeProjectionTab
        ? projectionSelectedPathsById[activeProjectionTab.id] ?? []
        : [],
      currentRule: activeDuplicateSelectionRule,
      action,
    }))
  }, [
    activeProjectionTab,
    activeDuplicateSelectionRule,
    applyDuplicateSelectionPlan,
    projectionSelectedPathsById,
  ])

  const handleApplyDuplicateSelectionRule = useCallback((rule: DuplicateSelectionRule) => {
    runDuplicateSelectionAction({ kind: 'apply-rule', rule })
  }, [runDuplicateSelectionAction])

  const handleClearDuplicateSelection = useCallback(() => {
    runDuplicateSelectionAction({ kind: 'clear-all' })
  }, [runDuplicateSelectionAction])

  const handleReapplyDuplicateGroup = useCallback((groupId: string) => {
    runDuplicateSelectionAction({ kind: 'reapply-group', groupId })
  }, [runDuplicateSelectionAction])

  const handleClearDuplicateGroup = useCallback((groupId: string) => {
    runDuplicateSelectionAction({ kind: 'clear-group', groupId })
  }, [runDuplicateSelectionAction])

  return {
    handleApplyDuplicateSelectionRule,
    handleClearDuplicateSelection,
    handleReapplyDuplicateGroup,
    handleClearDuplicateGroup,
  }
}
