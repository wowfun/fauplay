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
  buildDuplicateSelectionForGroup,
  buildDuplicateSelectionForProjection,
  type DuplicateSelectionRule,
  groupDuplicateProjectionFiles,
  isDuplicateProjection,
  replaceDuplicateGroupSelection,
} from '@/features/workspace/lib/duplicateSelection'
import {
  areStringArraysEqual,
  pruneProjectionAfterDeletedAbsolutePaths,
  pruneProjectionTabsAfterDeletedFiles,
  resolveProjectionPreferredPath,
  resolveProjectionTabCloseState,
  type WorkspaceActiveSurface,
} from '@/features/workspace/lib/projectionTabs'
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

  const activeProjectionTab = useMemo(
    () => projectionTabs.find((projection) => projection.id === activeProjectionTabId) ?? projectionTabs[0] ?? null,
    [activeProjectionTabId, projectionTabs]
  )
  const activeSurfaceProjection = useMemo(() => {
    if (activeSurface.kind !== 'projection') return null
    return projectionTabs.find((projection) => projection.id === activeSurface.tabId) ?? null
  }, [activeSurface, projectionTabs])
  const activeSurfaceFiles = useMemo(
    () => activeSurfaceProjection?.files ?? filteredFiles,
    [activeSurfaceProjection, filteredFiles]
  )
  const activeSurfaceFileItems = useMemo(
    () => activeSurfaceFiles.filter((file): file is FileItem => file.kind === 'file'),
    [activeSurfaceFiles]
  )
  const isDirectorySurfaceActive = activeSurface.kind === 'directory'
  const projectionGridSelectedPaths = useMemo(
    () => (activeProjectionTab?.id ? projectionSelectedPathsById[activeProjectionTab.id] ?? [] : []),
    [activeProjectionTab?.id, projectionSelectedPathsById]
  )
  const activeDuplicateSelectionRule = useMemo(
    () => (activeProjectionTab?.id ? duplicateSelectionRuleByProjectionId[activeProjectionTab.id] ?? null : null),
    [activeProjectionTab?.id, duplicateSelectionRuleByProjectionId]
  )
  const activeSurfaceSelectedPaths = useMemo(
    () => (activeSurface.kind === 'projection'
      ? projectionSelectedPathsById[activeSurface.tabId] ?? []
      : directorySelectedPaths),
    [activeSurface, directorySelectedPaths, projectionSelectedPathsById]
  )

  const alignPreviewToProjection = useCallback((projection: ResultProjection | null, preferredPath?: string | null) => {
    interactionRef.current?.alignPreviewToPath(resolveProjectionPreferredPath(projection, preferredPath))
  }, [interactionRef])

  const setProjectionSelectedPathsForTab = useCallback((tabId: string, selectedPaths: string[]) => {
    setProjectionSelectedPathsById((previous) => {
      const currentSelectedPaths = previous[tabId] ?? []
      if (areStringArraysEqual(currentSelectedPaths, selectedPaths)) {
        return previous
      }
      if (selectedPaths.length === 0) {
        if (!(tabId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[tabId]
        return next
      }
      return {
        ...previous,
        [tabId]: selectedPaths,
      }
    })
  }, [])

  const setDuplicateSelectionRuleForTab = useCallback((tabId: string, rule: DuplicateSelectionRule | null) => {
    setDuplicateSelectionRuleByProjectionId((previous) => {
      const currentRule = previous[tabId] ?? null
      if (currentRule === rule) {
        return previous
      }
      if (rule === null) {
        if (!(tabId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[tabId]
        return next
      }
      return {
        ...previous,
        [tabId]: rule,
      }
    })
  }, [])

  const activateProjectionSurface = useCallback((tabId: string, projection: ResultProjection | null) => {
    if (!projection) {
      return
    }
    setIsResultPanelOpen(true)
    setActiveProjectionTabId(tabId)
    lastProjectionTabIdRef.current = tabId
    setActiveSurface({ kind: 'projection', tabId })
    alignPreviewToProjection(projection, projectionFocusedPathById[tabId])
  }, [alignPreviewToProjection, projectionFocusedPathById, setIsResultPanelOpen])

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

  const sanitizeProjectionAgainstDeletedFiles = useCallback((projection: ResultProjection): ResultProjection | null => {
    return pruneProjectionAfterDeletedAbsolutePaths(projection, deletedProjectionAbsolutePathSetRef.current)
  }, [])

  const handleActivateProjection = useCallback((projection: ResultProjection) => {
    const sanitizedProjection = sanitizeProjectionAgainstDeletedFiles(projection)
    if (!sanitizedProjection) {
      return
    }
    setProjectionTabs((previous) => {
      const existingIndex = previous.findIndex((item) => item.id === sanitizedProjection.id)
      if (existingIndex < 0) {
        return [...previous, sanitizedProjection]
      }
      const next = [...previous]
      next[existingIndex] = sanitizedProjection
      return next
    })
    activateProjectionSurface(sanitizedProjection.id, sanitizedProjection)
  }, [activateProjectionSurface, sanitizeProjectionAgainstDeletedFiles])

  const handleActivateProjectionTab = useCallback((tabId: string) => {
    const targetProjection = projectionTabs.find((projection) => projection.id === tabId)
    activateProjectionSurface(tabId, targetProjection ?? null)
  }, [activateProjectionSurface, projectionTabs])

  const handleOpenResultPanel = useCallback(() => {
    const fallbackTabId = activeProjectionTab?.id ?? lastProjectionTabIdRef.current ?? projectionTabs[0]?.id ?? null
    if (!fallbackTabId) return
    const targetProjection = projectionTabs.find((projection) => projection.id === fallbackTabId) ?? null
    activateProjectionSurface(fallbackTabId, targetProjection)
  }, [activeProjectionTab?.id, activateProjectionSurface, projectionTabs])

  const handleCloseResultPanel = useCallback(() => {
    setIsResultPanelOpen(false)
    setActiveSurface({ kind: 'directory' })
    interactionRef.current?.alignPreviewToPath(directoryFocusedPath)
  }, [directoryFocusedPath, interactionRef, setIsResultPanelOpen])

  const handleToggleResultPanelMaximized = useCallback(() => {
    const fallbackTabId = activeProjectionTab?.id ?? projectionTabs[0]?.id ?? null
    if (fallbackTabId) {
      const targetProjection = projectionTabs.find((projection) => projection.id === fallbackTabId) ?? null
      setActiveProjectionTabId(fallbackTabId)
      lastProjectionTabIdRef.current = fallbackTabId
      setActiveSurface({ kind: 'projection', tabId: fallbackTabId })
      alignPreviewToProjection(targetProjection, projectionFocusedPathById[fallbackTabId])
    }
    setResultPanelDisplayMode((previous) => {
      if (previous === 'maximized') {
        setResultPanelHeightPx(lastNormalResultPanelHeightRef.current)
        return 'normal'
      }
      return 'maximized'
    })
  }, [
    activeProjectionTab?.id,
    alignPreviewToProjection,
    lastNormalResultPanelHeightRef,
    projectionFocusedPathById,
    projectionTabs,
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

  const handleApplyDuplicateSelectionRule = useCallback((rule: DuplicateSelectionRule) => {
    if (!activeProjectionTab || !isDuplicateProjection(activeProjectionTab)) {
      return
    }
    const nextSelectedPaths = buildDuplicateSelectionForProjection(activeProjectionTab.files, rule)
    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTab.id)
    setProjectionSelectedPathsForTab(activeProjectionTab.id, nextSelectedPaths)
    setDuplicateSelectionRuleForTab(activeProjectionTab.id, rule)
  }, [
    activateProjectionSurfaceWithoutPreviewAlignment,
    activeProjectionTab,
    setDuplicateSelectionRuleForTab,
    setProjectionSelectedPathsForTab,
  ])

  const handleClearDuplicateSelection = useCallback(() => {
    if (!activeProjectionTab || !isDuplicateProjection(activeProjectionTab)) {
      return
    }
    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTab.id)
    setProjectionSelectedPathsForTab(activeProjectionTab.id, [])
    setDuplicateSelectionRuleForTab(activeProjectionTab.id, null)
  }, [
    activateProjectionSurfaceWithoutPreviewAlignment,
    activeProjectionTab,
    setDuplicateSelectionRuleForTab,
    setProjectionSelectedPathsForTab,
  ])

  const handleReapplyDuplicateGroup = useCallback((groupId: string) => {
    if (!activeProjectionTab || !isDuplicateProjection(activeProjectionTab) || !activeDuplicateSelectionRule) {
      return
    }

    const targetGroup = groupDuplicateProjectionFiles(activeProjectionTab.files).find((group) => group.groupId === groupId)
    if (!targetGroup) {
      return
    }

    const currentSelectedPaths = projectionSelectedPathsById[activeProjectionTab.id] ?? []
    const nextSelectedPaths = replaceDuplicateGroupSelection(
      activeProjectionTab.files,
      currentSelectedPaths,
      groupId,
      buildDuplicateSelectionForGroup(targetGroup.items, activeDuplicateSelectionRule)
    )

    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTab.id)
    setProjectionSelectedPathsForTab(activeProjectionTab.id, nextSelectedPaths)
  }, [
    activateProjectionSurfaceWithoutPreviewAlignment,
    activeDuplicateSelectionRule,
    activeProjectionTab,
    projectionSelectedPathsById,
    setProjectionSelectedPathsForTab,
  ])

  const handleClearDuplicateGroup = useCallback((groupId: string) => {
    if (!activeProjectionTab || !isDuplicateProjection(activeProjectionTab)) {
      return
    }

    const currentSelectedPaths = projectionSelectedPathsById[activeProjectionTab.id] ?? []
    const nextSelectedPaths = replaceDuplicateGroupSelection(
      activeProjectionTab.files,
      currentSelectedPaths,
      groupId,
      []
    )

    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTab.id)
    setProjectionSelectedPathsForTab(activeProjectionTab.id, nextSelectedPaths)
  }, [
    activateProjectionSurfaceWithoutPreviewAlignment,
    activeProjectionTab,
    projectionSelectedPathsById,
    setProjectionSelectedPathsForTab,
  ])

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
    const tabId = activeProjectionTab?.id
    if (!tabId) return
    setActiveProjectionTabId(tabId)
    lastProjectionTabIdRef.current = tabId
    setActiveSurface({ kind: 'projection', tabId })
    if (file.kind === 'directory') {
      return
    }
    setProjectionFocusedPathById((previous) => (
      previous[tabId] === file.path
        ? previous
        : {
          ...previous,
          [tabId]: file.path,
        }
    ))
    interactionRef.current?.openFileInPrimaryTarget(file)
  }, [activeProjectionTab?.id, interactionRef])

  const handleProjectionFileDoubleClick = useCallback((file: FileItem) => {
    const tabId = activeProjectionTab?.id
    if (!tabId || file.kind !== 'file') return
    setActiveProjectionTabId(tabId)
    lastProjectionTabIdRef.current = tabId
    setActiveSurface({ kind: 'projection', tabId })
    setProjectionFocusedPathById((previous) => (
      previous[tabId] === file.path
        ? previous
        : {
          ...previous,
          [tabId]: file.path,
        }
    ))
    interactionRef.current?.openFileInSecondaryTarget(file)
  }, [activeProjectionTab?.id, interactionRef])

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
    if (projectionTabs.length === 0) {
      if (activeProjectionTabId !== null) {
        setActiveProjectionTabId(null)
      }
      return
    }

    if (!activeProjectionTabId || !projectionTabs.some((projection) => projection.id === activeProjectionTabId)) {
      const fallbackTabId = projectionTabs[0]?.id ?? null
      setActiveProjectionTabId(fallbackTabId)
      lastProjectionTabIdRef.current = fallbackTabId
    }
  }, [activeProjectionTabId, projectionTabs])

  useEffect(() => {
    if (activeSurface.kind !== 'projection') return
    if (projectionTabs.some((projection) => projection.id === activeSurface.tabId)) return
    setActiveSurface({ kind: 'directory' })
    interactionRef.current?.alignPreviewToPath(directoryFocusedPath)
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
