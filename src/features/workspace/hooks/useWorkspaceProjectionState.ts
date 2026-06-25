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
} from '@/features/workspace/lib/duplicateSelection'
import { useWorkspaceProjectionActivation } from '@/features/workspace/hooks/useWorkspaceProjectionActivation'
import { useWorkspaceProjectionDuplicateSelection } from '@/features/workspace/hooks/useWorkspaceProjectionDuplicateSelection'
import { useWorkspaceProjectionFileInteraction } from '@/features/workspace/hooks/useWorkspaceProjectionFileInteraction'
import { useWorkspaceProjectionTabLifecycle } from '@/features/workspace/hooks/useWorkspaceProjectionTabLifecycle'
import {
  resolveProjectionRuleByIdUpdate,
  resolveProjectionSelectedPathsByIdUpdate,
  type WorkspaceActiveSurface,
} from '@/features/workspace/lib/projectionTabRecords'
import { resolveWorkspaceProjectionViewModel } from '@/features/workspace/lib/workspaceProjectionViewModel'
import {
  resolveWorkspaceProjectionSurfaceRecoveryPlan,
  resolveWorkspaceProjectionTabConsistencyPlan,
} from '@/features/workspace/lib/workspaceProjectionConsistency'
import type { WorkspaceProjectionInteraction } from '@/features/workspace/types/projectionInteraction'
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

  const {
    alignPreviewToProjection,
    handleActivateProjection,
    handleActivateProjectionTab,
    handleOpenResultPanel,
    handleCloseResultPanel,
    handleToggleResultPanelMaximized,
    handleProjectionGridSelectionChange,
  } = useWorkspaceProjectionActivation({
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
  })

  const {
    handleApplyDuplicateSelectionRule,
    handleClearDuplicateSelection,
    handleReapplyDuplicateGroup,
    handleClearDuplicateGroup,
  } = useWorkspaceProjectionDuplicateSelection({
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
  })

  const {
    handleProjectionFileClick,
    handleProjectionFileDoubleClick,
  } = useWorkspaceProjectionFileInteraction({
    activeProjectionTabId: activeProjectionTab?.id,
    interactionRef,
    lastProjectionTabIdRef,
    setActiveProjectionTabId,
    setActiveSurface,
    setProjectionFocusedPathById,
  })

  const {
    handleCloseProjectionTab,
    handleDismissProjectionTool,
    pruneDeletedFilesFromProjectionTabs,
    forgetDeletedProjectionAbsolutePath,
  } = useWorkspaceProjectionTabLifecycle({
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
  })

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
