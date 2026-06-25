import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import {
  type DuplicateSelectionRule,
  resolveDuplicateSelectionPlan,
  type DuplicateSelectionPlan,
  type DuplicateSelectionPlanAction,
} from '@/features/workspace/lib/duplicateSelection'
import {
  resolveProjectionActivationPlan,
  resolveProjectionFileInteractionPlan,
  resolveProjectionPanelDisplayTogglePlan,
  type ProjectionFileInteractionPlan,
  type ProjectionActivationPlan,
} from '@/features/workspace/lib/projectionTabActivation'
import {
  pruneProjectionTabsAfterDeletedFiles,
  resolveProjectionTabCloseState,
} from '@/features/workspace/lib/projectionTabClosure'
import {
  resolveProjectionFocusedPathByIdUpdate,
  resolveProjectionPreferredPath,
  resolveProjectionRuleByIdUpdate,
  resolveProjectionSelectedPathsByIdUpdate,
  type WorkspaceActiveSurface,
} from '@/features/workspace/lib/projectionTabRecords'
import { resolveWorkspaceProjectionViewModel } from '@/features/workspace/lib/workspaceProjectionViewModel'
import {
  resolveWorkspaceProjectionSurfaceRecoveryPlan,
  resolveWorkspaceProjectionTabConsistencyPlan,
} from '@/features/workspace/lib/workspaceProjectionConsistency'
import { toToolScopedProjectionId } from '@/lib/projection'
import type {
  FileItem,
  ResultPanelDisplayMode,
  ResultProjection,
} from '@/types'

interface UseWorkspaceProjectionStateParams {
  filteredFiles: FileItem[]
  directorySelectedPaths: string[]
  directoryFocusedPath: string | null
  isResultPanelOpen: boolean
  setIsResultPanelOpen: (isOpen: boolean) => void
  resultPanelDisplayMode: ResultPanelDisplayMode
  setResultPanelDisplayMode: Dispatch<SetStateAction<ResultPanelDisplayMode>>
  setResultPanelHeightPx: Dispatch<SetStateAction<number>>
  lastNormalResultPanelHeightRef: MutableRefObject<number>
  interactionRef: MutableRefObject<WorkspaceProjectionInteraction | null>
}

export interface WorkspaceProjectionInteraction {
  openFileInPrimaryTarget: (file: FileItem) => void
  openFileInSecondaryTarget: (file: FileItem) => void
  alignPreviewToPath: (path: string | null) => void
}

interface PruneDeletedProjectionTabsParams {
  deletedAbsolutePaths?: string[]
  deletedProjectionPaths?: string[]
  projectionTabId?: string | null
}

interface WorkspaceProjectionState {
  projectionTabs: ResultProjection[]
  setProjectionTabs: Dispatch<SetStateAction<ResultProjection[]>>
  activeProjectionTabId: string | null
  setActiveProjectionTabId: Dispatch<SetStateAction<string | null>>
  activeSurface: WorkspaceActiveSurface
  setActiveSurface: Dispatch<SetStateAction<WorkspaceActiveSurface>>
  projectionSelectedPathsById: Record<string, string[]>
  setProjectionSelectedPathsById: Dispatch<SetStateAction<Record<string, string[]>>>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  setDuplicateSelectionRuleByProjectionId: Dispatch<SetStateAction<Record<string, DuplicateSelectionRule | null>>>
  projectionFocusedPathById: Record<string, string | null>
  setProjectionFocusedPathById: Dispatch<SetStateAction<Record<string, string | null>>>
  activeProjectionTab: ResultProjection | null
  activeSurfaceProjection: ResultProjection | null
  activeSurfaceFiles: FileItem[]
  activeSurfaceFileItems: FileItem[]
  isDirectorySurfaceActive: boolean
  projectionGridSelectedPaths: string[]
  activeDuplicateSelectionRule: DuplicateSelectionRule | null
  activeSurfaceSelectedPaths: string[]
  alignPreviewToProjection: (projection: ResultProjection | null, preferredPath?: string | null) => void
  handleProjectionFileClick: (file: FileItem) => void
  handleProjectionFileDoubleClick: (file: FileItem) => void
  handleActivateProjection: (projection: ResultProjection) => void
  handleActivateProjectionTab: (tabId: string) => void
  handleOpenResultPanel: () => void
  handleCloseResultPanel: () => void
  handleToggleResultPanelMaximized: () => void
  handleCloseProjectionTab: (tabId: string) => void
  handleDismissProjectionTool: (toolName: string) => void
  handleProjectionGridSelectionChange: (selectedPaths: string[]) => void
  handleApplyDuplicateSelectionRule: (rule: DuplicateSelectionRule) => void
  handleClearDuplicateSelection: () => void
  handleReapplyDuplicateGroup: (groupId: string) => void
  handleClearDuplicateGroup: (groupId: string) => void
  pruneDeletedFilesFromProjectionTabs: (params: PruneDeletedProjectionTabsParams) => void
  forgetDeletedProjectionAbsolutePath: (absolutePath: string) => void
  resetProjectionState: () => void
  setLastProjectionTabId: (tabId: string | null) => void
}

export function useWorkspaceProjectionState({
  filteredFiles,
  directorySelectedPaths,
  directoryFocusedPath,
  isResultPanelOpen,
  setIsResultPanelOpen,
  resultPanelDisplayMode,
  setResultPanelDisplayMode,
  setResultPanelHeightPx,
  lastNormalResultPanelHeightRef,
  interactionRef,
}: UseWorkspaceProjectionStateParams): WorkspaceProjectionState {
  const [projectionTabs, setProjectionTabs] = useState<ResultProjection[]>([])
  const [activeProjectionTabId, setActiveProjectionTabId] = useState<string | null>(null)
  const [activeSurface, setActiveSurface] = useState<WorkspaceActiveSurface>({ kind: 'directory' })
  const [projectionSelectedPathsById, setProjectionSelectedPathsById] = useState<Record<string, string[]>>({})
  const [duplicateSelectionRuleByProjectionId, setDuplicateSelectionRuleByProjectionId] = useState<Record<string, DuplicateSelectionRule | null>>({})
  const [projectionFocusedPathById, setProjectionFocusedPathById] = useState<Record<string, string | null>>({})
  const lastProjectionTabIdRef = useRef<string | null>(null)
  const deletedProjectionAbsolutePathSetRef = useRef<Set<string>>(new Set())

  const {
    activeProjectionTab,
    activeSurfaceProjection,
    activeSurfaceFiles,
    activeSurfaceFileItems,
    isDirectorySurfaceActive,
    projectionGridSelectedPaths,
    activeDuplicateSelectionRule,
    activeSurfaceSelectedPaths,
  } = useMemo(() => resolveWorkspaceProjectionViewModel({
    projectionTabs,
    activeProjectionTabId,
    activeSurface,
    filteredFiles,
    directorySelectedPaths,
    projectionSelectedPathsById,
    duplicateSelectionRuleByProjectionId,
  }), [
    activeProjectionTabId,
    activeSurface,
    directorySelectedPaths,
    duplicateSelectionRuleByProjectionId,
    filteredFiles,
    projectionSelectedPathsById,
    projectionTabs,
  ])

  const alignPreviewToProjection = useCallback((projection: ResultProjection | null, preferredPath?: string | null) => {
    interactionRef.current?.alignPreviewToPath(resolveProjectionPreferredPath(projection, preferredPath))
  }, [interactionRef])

  const setProjectionSelectedPathsForTab = useCallback((tabId: string, selectedPaths: string[]) => {
    setProjectionSelectedPathsById((previous) => (
      resolveProjectionSelectedPathsByIdUpdate(previous, tabId, selectedPaths)
    ))
  }, [])

  const setDuplicateSelectionRuleForTab = useCallback((tabId: string, rule: DuplicateSelectionRule | null) => {
    setDuplicateSelectionRuleByProjectionId((previous) => (
      resolveProjectionRuleByIdUpdate(previous, tabId, rule)
    ))
  }, [])

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
  }, [interactionRef, setIsResultPanelOpen])

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
  }, [activeProjectionTabId, activeSurface, isResultPanelOpen, setIsResultPanelOpen])

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
  }, [applyProjectionActivationPlan, projectionFocusedPathById, projectionTabs])

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
  }, [activeProjectionTab?.id, applyProjectionActivationPlan, projectionFocusedPathById, projectionTabs])

  const handleCloseResultPanel = useCallback(() => {
    setIsResultPanelOpen(false)
    setActiveSurface({ kind: 'directory' })
    interactionRef.current?.alignPreviewToPath(directoryFocusedPath)
  }, [directoryFocusedPath, interactionRef, setIsResultPanelOpen])

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
    projectionFocusedPathById,
    projectionTabs,
    resultPanelDisplayMode,
    setResultPanelDisplayMode,
    setResultPanelHeightPx,
  ])

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
    projectionFocusedPathById,
    projectionSelectedPathsById,
    projectionTabs,
    setIsResultPanelOpen,
  ])

  const handleDismissProjectionTool = useCallback((toolName: string) => {
    handleCloseProjectionTab(toToolScopedProjectionId(toolName))
  }, [handleCloseProjectionTab])

  const handleProjectionGridSelectionChange = useCallback((selectedPaths: string[]) => {
    if (!activeProjectionTabId) return
    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTabId)
    setProjectionSelectedPathsForTab(activeProjectionTabId, selectedPaths)
  }, [activeProjectionTabId, activateProjectionSurfaceWithoutPreviewAlignment, setProjectionSelectedPathsForTab])

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
  }, [interactionRef])

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
    duplicateSelectionRuleByProjectionId,
    projectionFocusedPathById,
    projectionSelectedPathsById,
    projectionTabs,
    setIsResultPanelOpen,
  ])

  const handleProjectionFileClick = useCallback((file: FileItem) => {
    applyProjectionFileInteractionPlan(resolveProjectionFileInteractionPlan({
      activeProjectionTabId: activeProjectionTab?.id,
      item: file,
      trigger: 'click',
    }))
  }, [activeProjectionTab?.id, applyProjectionFileInteractionPlan])

  const handleProjectionFileDoubleClick = useCallback((file: FileItem) => {
    applyProjectionFileInteractionPlan(resolveProjectionFileInteractionPlan({
      activeProjectionTabId: activeProjectionTab?.id,
      item: file,
      trigger: 'double-click',
    }))
  }, [activeProjectionTab?.id, applyProjectionFileInteractionPlan])

  const forgetDeletedProjectionAbsolutePath = useCallback((absolutePath: string) => {
    deletedProjectionAbsolutePathSetRef.current.delete(absolutePath)
  }, [])

  const resetProjectionState = useCallback(() => {
    setProjectionTabs([])
    setActiveProjectionTabId(null)
    setActiveSurface({ kind: 'directory' })
    setProjectionSelectedPathsById({})
    setDuplicateSelectionRuleByProjectionId({})
    setProjectionFocusedPathById({})
    setIsResultPanelOpen(false)
  }, [setIsResultPanelOpen])

  const setLastProjectionTabId = useCallback((tabId: string | null) => {
    lastProjectionTabIdRef.current = tabId
  }, [])

  useEffect(() => {
    const plan = resolveWorkspaceProjectionTabConsistencyPlan({
      projectionTabs,
      activeProjectionTabId,
    })
    if (plan.kind === 'set-active-tab') {
      setActiveProjectionTabId(plan.activeProjectionTabId)
      if (plan.lastProjectionTabId !== undefined) {
        lastProjectionTabIdRef.current = plan.lastProjectionTabId
      }
    }
  }, [activeProjectionTabId, projectionTabs])

  useEffect(() => {
    const plan = resolveWorkspaceProjectionSurfaceRecoveryPlan({
      projectionTabs,
      activeSurface,
      directoryFocusedPath,
    })
    if (plan.kind === 'return-to-directory') {
      setActiveSurface({ kind: 'directory' })
      interactionRef.current?.alignPreviewToPath(plan.previewAlignmentPath)
    }
  }, [activeSurface, directoryFocusedPath, interactionRef, projectionTabs])

  return {
    projectionTabs,
    setProjectionTabs,
    activeProjectionTabId,
    setActiveProjectionTabId,
    activeSurface,
    setActiveSurface,
    projectionSelectedPathsById,
    setProjectionSelectedPathsById,
    duplicateSelectionRuleByProjectionId,
    setDuplicateSelectionRuleByProjectionId,
    projectionFocusedPathById,
    setProjectionFocusedPathById,
    activeProjectionTab,
    activeSurfaceProjection,
    activeSurfaceFiles,
    activeSurfaceFileItems,
    isDirectorySurfaceActive,
    projectionGridSelectedPaths,
    activeDuplicateSelectionRule,
    activeSurfaceSelectedPaths,
    alignPreviewToProjection,
    handleProjectionFileClick,
    handleProjectionFileDoubleClick,
    handleActivateProjection,
    handleActivateProjectionTab,
    handleOpenResultPanel,
    handleCloseResultPanel,
    handleToggleResultPanelMaximized,
    handleCloseProjectionTab,
    handleDismissProjectionTool,
    handleProjectionGridSelectionChange,
    handleApplyDuplicateSelectionRule,
    handleClearDuplicateSelection,
    handleReapplyDuplicateGroup,
    handleClearDuplicateGroup,
    pruneDeletedFilesFromProjectionTabs,
    forgetDeletedProjectionAbsolutePath,
    resetProjectionState,
    setLastProjectionTabId,
  }
}
