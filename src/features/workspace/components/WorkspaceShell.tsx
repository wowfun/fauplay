import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { usePreviewTraversal } from '@/features/preview/hooks/usePreviewTraversal'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
import { useShortcutHelpEntries } from '@/features/explorer/hooks/useShortcutHelpEntries'
import { CompactWorkspaceShell } from '@/features/workspace/components/CompactWorkspaceShell'
import { WideWorkspaceShell } from '@/features/workspace/components/WideWorkspaceShell'
import { useInputMode } from '@/features/workspace/hooks/useInputMode'
import { useActivePreviewVideoControls } from '@/features/workspace/hooks/useActivePreviewVideoControls'
import { useViewportMode } from '@/features/workspace/hooks/useViewportMode'
import {
  preloadWorkspaceAnnotationFilterSnapshots,
  useWorkspaceAnnotationFilterOptions,
} from '@/features/workspace/hooks/useWorkspaceAnnotationFilterOptions'
import { useWorkspaceBrowserHistory } from '@/features/workspace/hooks/useWorkspaceBrowserHistory'
import { useWorkspaceKeyboardShortcuts } from '@/features/workspace/hooks/useWorkspaceKeyboardShortcuts'
import { useWorkspacePreviewPaneWidth } from '@/features/workspace/hooks/useWorkspacePreviewPaneWidth'
import {
  type WorkspaceProjectionInteraction,
  useWorkspaceProjectionState,
} from '@/features/workspace/hooks/useWorkspaceProjectionState'
import { useWorkspaceResultPanelState } from '@/features/workspace/hooks/useWorkspaceResultPanelState'
import { useWorkspaceSelectionFocusSync } from '@/features/workspace/hooks/useWorkspaceSelectionFocusSync'
import {
  preloadWorkspacePreviewModulesSoon,
  useWorkspacePreviewOpenActions,
} from '@/features/workspace/hooks/useWorkspacePreviewOpenActions'
import { useWorkspacePeoplePanel } from '@/features/workspace/hooks/useWorkspacePeoplePanel'
import { useWorkspacePresentationProfile } from '@/features/workspace/hooks/useWorkspacePresentationProfile'
import { useWorkspacePluginTools } from '@/features/workspace/hooks/useWorkspacePluginTools'
import { useWorkspaceTrashAvailability } from '@/features/workspace/hooks/useWorkspaceTrashAvailability'
import { useWorkspaceDeleteUndoController } from '@/features/workspace/hooks/useWorkspaceDeleteUndoController'
import { useWorkspaceShellInteractionHandlers } from '@/features/workspace/hooks/useWorkspaceShellInteractionHandlers'
import {
  isAnnotationFilterAtDefault,
  useWorkspaceFilterState,
} from '@/features/workspace/hooks/useWorkspaceFilterState'
import { useWorkspaceFileSelectionSummary } from '@/features/workspace/hooks/useWorkspaceFileSelectionSummary'
import { useWorkspacePathHistory } from '@/features/workspace/hooks/useWorkspacePathHistory'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import { resolveWorkspacePreviewCapabilityModel } from '@/features/workspace/lib/workspacePreviewCapabilityModel'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import { resolveWorkspaceMutationDeleteUndoPlan } from '@/features/workspace/lib/deleteUndoMutationPlan'
import { resolveWorkspacePreviewMutationPlan } from '@/features/workspace/lib/previewMutationPlan'
import { filterWorkspaceFiles } from '@/features/workspace/lib/workspaceFileFiltering'
import {
  type AddressPathHistoryEntry,
  type FavoriteFolderEntry,
  type FileItem,
  type FilterState,
  type ListingPageState,
  type ListingQueryState,
  type ThumbnailSizePreset,
} from '@/types'
const TRASH_ROUTE_PATH = '@trash'

interface WorkspaceShellProps {
  accessProvider: 'local-browser' | 'remote-readonly'
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
  rootName: string
  storageNamespace: string
  favoriteFolders: FavoriteFolderEntry[]
  isCurrentPathFavorited: boolean
  files: FileItem[]
  listingPage?: ListingPageState
  currentPath: string
  isFlattenView: boolean
  isLoading: boolean
  error: string | null
  selectDirectory: () => Promise<void>
  openFavoriteFolder: (entry: FavoriteFolderEntry) => Promise<boolean>
  removeFavoriteFolder: (entry: FavoriteFolderEntry) => void
  toggleCurrentFolderFavorite: () => void
  openHistoryEntry: (entry: AddressPathHistoryEntry) => Promise<boolean>
  navigateToPath: (
    targetPath: string,
    options?: { resetFlattenView?: boolean }
  ) => Promise<boolean>
  navigateToDirectory: (dirName: string) => Promise<void>
  navigateUp: () => Promise<void>
  listChildDirectories: (targetPath: string) => Promise<string[]>
  loadNextListingPage?: () => Promise<void>
  setListingQuery?: (query: ListingQueryState) => Promise<void>
  setFlattenView: (flattenView: boolean) => Promise<void>
  filterFiles: (files: FileItem[], filter: FilterState) => FileItem[]
  onSwitchWorkspace?: () => void
  onForgetRemoteDevice?: () => void
}

export function WorkspaceShell({
  accessProvider,
  rootHandle,
  rootId,
  rootName,
  storageNamespace,
  favoriteFolders,
  isCurrentPathFavorited,
  files,
  listingPage,
  currentPath,
  isFlattenView,
  isLoading,
  error,
  selectDirectory,
  openFavoriteFolder,
  removeFavoriteFolder,
  toggleCurrentFolderFavorite,
  openHistoryEntry,
  navigateToPath,
  navigateToDirectory,
  navigateUp,
  listChildDirectories,
  loadNextListingPage,
  setListingQuery,
  setFlattenView,
  filterFiles,
  onSwitchWorkspace,
  onForgetRemoteDevice,
}: WorkspaceShellProps) {
  const keyboardShortcuts = useKeyboardShortcuts()
  const viewportMode = useViewportMode()
  const inputMode = useInputMode()
  const presentationProfile = useWorkspacePresentationProfile({
    accessProvider,
    viewportMode,
    inputMode,
  })
  const {
    annotationDisplayStoreVersion,
    reviewFilterTagStoreVersion,
    isAnnotationFilterGateResolved,
    isReviewFilterGateResolved,
    showAnnotationFilterControls,
    annotationFilterTagOptions,
    refreshFilterTagSnapshots,
    handleOpenAnnotationFilterPanel,
  } = useWorkspaceAnnotationFilterOptions({
    rootId,
    rootHandle,
    rootName,
  })
  const [thumbnailSizePreset, setThumbnailSizePreset] = useState<ThumbnailSizePreset>('auto')
  const [directorySelectedPaths, setDirectorySelectedPaths] = useState<string[]>([])
  const clearDirectorySelectionForFilterChange = useCallback(() => {
    setDirectorySelectedPaths([])
  }, [])
  const {
    filter,
    setFilter,
    handleFilterChange,
    listingQuery,
  } = useWorkspaceFilterState({
    rootId,
    storageNamespace,
    onUserFilterChange: clearDirectorySelectionForFilterChange,
  })
  const recentPathHistory = useWorkspacePathHistory({
    storageNamespace,
    rootId,
    rootName,
    currentPath,
  })
  const pluginTools = useWorkspacePluginTools({ accessProvider })
  const [directoryFocusedPath, setDirectoryFocusedPath] = useState<string | null>(null)
  const {
    isResultPanelOpen,
    setIsResultPanelOpen,
    resultPanelDisplayMode,
    setResultPanelDisplayMode,
    resultPanelHeightPx,
    setResultPanelHeightPx,
    lastNormalResultPanelHeightRef,
    handleResultPanelResizeStart,
  } = useWorkspaceResultPanelState()
  const hasTrashEntries = useWorkspaceTrashAvailability({
    accessProvider,
    rootId,
    refreshKey: files,
  })
  const directoryFileGridRef = useRef<FileBrowserGridHandle>(null)
  const projectionFileGridRef = useRef<FileBrowserGridHandle>(null)
  const projectionInteractionRef = useRef<WorkspaceProjectionInteraction | null>(null)

  useEffect(() => {
    if (!setListingQuery) return
    void setListingQuery(listingQuery)
  }, [listingQuery, setListingQuery])

  const filteredFiles = useMemo(() => {
    return filterWorkspaceFiles({
      files,
      filter,
      rootId,
      filterFiles,
      annotationDisplayStoreVersion,
      reviewFilterTagStoreVersion,
    })
  }, [annotationDisplayStoreVersion, files, filter, filterFiles, reviewFilterTagStoreVersion, rootId])
  const {
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
  } = useWorkspaceProjectionState({
    filteredFiles,
    directorySelectedPaths,
    directoryFocusedPath,
    isResultPanelOpen,
    setIsResultPanelOpen,
    setResultPanelDisplayMode,
    setResultPanelHeightPx,
    lastNormalResultPanelHeightRef,
    interactionRef: projectionInteractionRef,
  })

  const {
    totalCount,
    imageCount,
    videoCount,
    selectedGridItems,
    selectedGridMetaFile,
  } = useWorkspaceFileSelectionSummary({
    filteredFiles,
    activeSurfaceFiles,
    activeSurfaceSelectedPaths,
  })
  const {
    selectedFile,
    previewFile,
    showPreviewPane,
    previewAutoPlayOnOpen,
    autoPlayEnabled,
    autoPlayIntervalSec,
    videoSeekStepSec,
    videoPlaybackRate,
    faceBboxVisible,
    playbackOrder,
    hasOpenPreview,
    hasActiveMediaPreview,
    showFileInPane,
    openFileInModal,
    closePreviewModal,
    closePreviewPane,
    openFullscreenFromPane,
    toggleAutoPlay,
    togglePlaybackOrder,
    setAutoPlayInterval,
    setVideoSeekStep,
    setVideoPlaybackRate,
    cycleVideoPlaybackRate,
    toggleFaceBboxVisible,
    navigateMediaFromPane,
    navigateMediaFromModal,
    canNavigateMediaFromPane,
    canNavigateMediaFromModal,
    handleAutoPlayVideoEnded,
    handleAutoPlayVideoPlaybackError,
    alignPreviewToPath,
  } = usePreviewTraversal({ filteredFiles: activeSurfaceFiles })
  const {
    contentRef,
    paneWidthRatio,
    handlePreviewPaneResizeStart,
  } = useWorkspacePreviewPaneWidth({
    showPreviewPane,
    thumbnailSizePreset,
  })
  const {
    activePreviewFile: activePreviewFileForTagShortcuts,
    previewNavigationSurface,
    hasActiveVideoPreview,
    canRunTagShortcuts: canRunPreviewTagShortcuts,
    canSoftDelete: canSoftDeleteActivePreview,
  } = useMemo(() => resolveWorkspacePreviewCapabilityModel({
    previewFile,
    selectedFile,
    showPreviewPane,
    pluginTools,
  }), [pluginTools, previewFile, selectedFile, showPreviewPane])
  const canNavigatePreviewBackward = previewNavigationSurface === 'lightbox'
    ? canNavigateMediaFromModal
    : canNavigateMediaFromPane
  const canNavigatePreviewForward = previewNavigationSurface === 'lightbox'
    ? canNavigateMediaFromModal
    : canNavigateMediaFromPane
  const handleNavigatePreviewBackward = useCallback(() => {
    if (previewNavigationSurface === 'lightbox') {
      navigateMediaFromModal('prev')
      return
    }
    navigateMediaFromPane('prev')
  }, [navigateMediaFromModal, navigateMediaFromPane, previewNavigationSurface])
  const handleNavigatePreviewForward = useCallback(() => {
    if (previewNavigationSurface === 'lightbox') {
      navigateMediaFromModal('next')
      return
    }
    navigateMediaFromPane('next')
  }, [navigateMediaFromModal, navigateMediaFromPane, previewNavigationSurface])
  const { getMatchingPreviewTagShortcut } = useResolvedPreviewTagShortcuts({
    rootId,
    relativePath: activePreviewFileForTagShortcuts?.kind === 'file' ? activePreviewFileForTagShortcuts.path : null,
    enabled: canRunPreviewTagShortcuts,
  })
  const {
    toggleActivePreviewVideoPlayback,
    seekActivePreviewVideo,
  } = useActivePreviewVideoControls({
    preferredSurface: previewNavigationSurface === 'lightbox' ? 'lightbox' : 'panel',
    seekStepSec: videoSeekStepSec,
    playbackRate: videoPlaybackRate,
    enabled: hasActiveVideoPreview,
  })

  const {
    openFileInPrimaryTarget,
    openFileInSecondaryTarget,
    openFileInPaneOrFullscreenFallback,
  } = useWorkspacePreviewOpenActions({
    presentationProfile,
    closePreviewPane,
    openFileInModal,
    showFileInPane,
  })
  projectionInteractionRef.current = {
    openFileInPrimaryTarget,
    openFileInSecondaryTarget,
    alignPreviewToPath,
  }

  useWorkspaceBrowserHistory({
    accessProvider,
    rootId,
    currentPath,
    supportsPersistentPreviewPane: presentationProfile.supportsPersistentPreviewPane,
    filteredFiles,
    selectedFile,
    previewFile,
    showPreviewPane,
    navigateToPath,
    closePreviewModal,
    closePreviewPane,
    openFileInModal,
    openFileInPaneOrFullscreenFallback,
  })

  const {
    handleDirectoryClick,
    handleDirectoryFileClick,
    handleDirectoryFileDoubleClick,
  } = useWorkspaceShellInteractionHandlers({
    shellKind: presentationProfile.shellKind,
    supportsPersistentPreviewPane: presentationProfile.supportsPersistentPreviewPane,
    showPreviewPane,
    selectedFile,
    previewFile,
    closePreviewPane,
    openFileInModal,
    setActiveSurface,
    navigateToDirectory,
    setDirectoryFocusedPath,
    openFileInPrimaryTarget,
    openFileInSecondaryTarget,
  })

  const handleNavigateToPath = useCallback((path: string) => {
    return navigateToPath(path, { resetFlattenView: true })
  }, [navigateToPath])
  const handleNavigateHistoryEntry = useCallback((entry: AddressPathHistoryEntry) => {
    return openHistoryEntry(entry)
  }, [openHistoryEntry])

  const {
    deleteUndoNoticeMessage,
    deleteUndoNoticeTone,
    canUndoDelete,
    isUndoingDelete,
    createDeleteUndoBatchFromParams,
    pushDeleteUndoBatch,
    handleUndoDelete,
  } = useWorkspaceDeleteUndoController({
    rootId,
    rootName,
    currentPath,
    filter,
    setFilter,
    isFlattenView,
    setFlattenView,
    activeSurface,
    setActiveSurface,
    directorySelectedPaths,
    setDirectorySelectedPaths,
    directoryFocusedPath,
    setDirectoryFocusedPath,
    isResultPanelOpen,
    setIsResultPanelOpen,
    resultPanelDisplayMode,
    setResultPanelDisplayMode,
    resultPanelHeightPx,
    setResultPanelHeightPx,
    lastNormalResultPanelHeightRef,
    projectionTabs,
    setProjectionTabs,
    activeProjectionTabId,
    setActiveProjectionTabId,
    setLastProjectionTabId,
    projectionSelectedPathsById,
    setProjectionSelectedPathsById,
    projectionFocusedPathById,
    setProjectionFocusedPathById,
    duplicateSelectionRuleByProjectionId,
    setDuplicateSelectionRuleByProjectionId,
    showPreviewPane,
    selectedFile,
    previewFile,
    openFileInPaneOrFullscreenFallback,
    closePreviewPane,
    openFileInModal,
    closePreviewModal,
    refreshFilterTagSnapshots,
    openHistoryEntry,
    forgetDeletedProjectionAbsolutePath,
  })

  const handleWorkspaceMutationCommitted = useCallback(async (params?: WorkspaceMutationCommitParams) => {
    const deleteUndoBatch = createDeleteUndoBatchFromParams(params)
    const deleteUndoPlan = resolveWorkspaceMutationDeleteUndoPlan(params)
    if (deleteUndoPlan.shouldPruneDeletedProjectionTabs && deleteUndoPlan.pruneDeletedProjectionTabsParams) {
      pruneDeletedFilesFromProjectionTabs(deleteUndoPlan.pruneDeletedProjectionTabsParams)
    }
    await navigateToPath(currentPath)
    await refreshFilterTagSnapshots()
    pushDeleteUndoBatch(deleteUndoBatch)
  }, [
    createDeleteUndoBatchFromParams,
    currentPath,
    navigateToPath,
    pruneDeletedFilesFromProjectionTabs,
    pushDeleteUndoBatch,
    refreshFilterTagSnapshots,
  ])

  const handlePreviewMutationCommitted = useCallback(async (params?: PreviewMutationCommitParams) => {
    const deleteUndoBatch = createDeleteUndoBatchFromParams(params)
    const activePreviewFile = previewFile ?? selectedFile
    const mutationPlan = resolveWorkspacePreviewMutationPlan({
      params,
      activeSurface,
      activeSurfaceFileItems,
      activePreviewFile,
      isPreviewModalOpen: Boolean(previewFile),
    })

    if (mutationPlan.preferredPreviewPath) {
      alignPreviewToPath(mutationPlan.preferredPreviewPath)
      await navigateToPath(currentPath)
      await refreshFilterTagSnapshots()
      pushDeleteUndoBatch(deleteUndoBatch)
      return
    }

    if (mutationPlan.shouldPruneDeletedProjectionTabs) {
      pruneDeletedFilesFromProjectionTabs(mutationPlan.pruneDeletedProjectionTabsParams)
    }

    if (mutationPlan.previewContinuation.kind === 'navigate-media-next') {
      if (mutationPlan.previewContinuation.target === 'modal') {
        navigateMediaFromModal('next')
      } else {
        navigateMediaFromPane('next')
      }
    }

    if (mutationPlan.previewContinuation.kind === 'open-file') {
      if (mutationPlan.previewContinuation.target === 'modal') {
        openFileInModal(mutationPlan.previewContinuation.file)
      } else {
        openFileInPrimaryTarget(mutationPlan.previewContinuation.file)
      }
    }

    await navigateToPath(currentPath)
    await refreshFilterTagSnapshots()
    pushDeleteUndoBatch(deleteUndoBatch)
  }, [
    activeSurface,
    alignPreviewToPath,
    createDeleteUndoBatchFromParams,
    currentPath,
    navigateMediaFromModal,
    navigateMediaFromPane,
    navigateToPath,
    previewFile,
    pushDeleteUndoBatch,
    pruneDeletedFilesFromProjectionTabs,
    refreshFilterTagSnapshots,
    selectedFile,
    openFileInPrimaryTarget,
    openFileInModal,
    activeSurfaceFileItems,
  ])

  const handleOpenTrash = useCallback(() => {
    if (!hasTrashEntries) return
    void navigateToPath(TRASH_ROUTE_PATH, { resetFlattenView: true })
  }, [hasTrashEntries, navigateToPath])

  const {
    canOpenPeople,
    showPeoplePanel,
    peoplePanelPreferredPersonId,
    openPeople: handleOpenPeople,
    openPeopleForPerson: handleOpenPeopleForPerson,
    closePeople: handleClosePeople,
    openFaceSource: handleOpenFaceSource,
    projectFaceSources: handleProjectFaceSources,
  } = useWorkspacePeoplePanel({
    accessProvider,
    rootId,
    currentPath,
    pluginTools,
    activeSurface,
    activeSurfaceFiles,
    filteredFiles,
    navigateToPath,
    setActiveSurface,
    setDirectoryFocusedPath,
    openFileInPrimaryTarget,
    activateProjection: handleActivateProjection,
  })

  useEffect(() => {
    setDirectorySelectedPaths([])
    setDirectoryFocusedPath(null)
  }, [currentPath])

  useEffect(() => {
    resetProjectionState()
    setDirectorySelectedPaths([])
    setDirectoryFocusedPath(null)
  }, [resetProjectionState, rootId])

  useEffect(() => {
    void preloadWorkspaceAnnotationFilterSnapshots({
      rootId,
      rootHandle,
      rootName,
    })
  }, [rootHandle, rootId, rootName])

  useEffect(() => {
    if (!isAnnotationFilterGateResolved || !isReviewFilterGateResolved || showAnnotationFilterControls) return
    setFilter((previous) => {
      if (isAnnotationFilterAtDefault(previous)) return previous
      return {
        ...previous,
        annotationFilterMode: 'all',
        annotationIncludeMatchMode: 'or',
        annotationIncludeTagKeys: [],
        annotationExcludeTagKeys: [],
      }
    })
  }, [isAnnotationFilterGateResolved, isReviewFilterGateResolved, setFilter, showAnnotationFilterControls])

  useEffect(() => {
    return preloadWorkspacePreviewModulesSoon()
  }, [])

  useWorkspaceSelectionFocusSync({
    selectedFile,
    activeSurface,
    projectionTabs,
    setProjectionFocusedPathById,
    setDirectoryFocusedPath,
    directoryFileGridRef,
    projectionFileGridRef,
  })

  const shortcutHelpEntries = useShortcutHelpEntries({
    rootId,
    currentPath,
    canUndoDelete,
    visibleItemCount: activeSurfaceFiles.length,
    selectedGridCount: selectedGridItems.length,
    hasOpenPreview,
    hasActivePreviewFile: Boolean(
      activePreviewFileForTagShortcuts && activePreviewFileForTagShortcuts.kind === 'file'
    ),
    hasActiveMediaPreview,
    hasActiveVideoPreview,
    canManagePreviewTags: canRunPreviewTagShortcuts,
    canSoftDeletePreview: canSoftDeleteActivePreview,
  })

  useWorkspaceKeyboardShortcuts({
    keyboardShortcuts,
    selectDirectory,
    undoDelete: handleUndoDelete,
    getMatchingPreviewTagShortcut,
    hasActiveVideoPreview,
    hasActiveMediaPreview,
    toggleActivePreviewVideoPlayback,
    seekActivePreviewVideo,
    cycleVideoPlaybackRate,
    toggleAutoPlay,
    togglePlaybackOrder,
    previewFile,
    navigateMediaFromModal,
    navigateMediaFromPane,
    currentPath,
    navigateUp,
    closePreviewModal,
    closePreviewPane,
    showPreviewPane,
  })

  const commonShellProps = {
      filter,
      onFilterChange: handleFilterChange,
      accessProvider,
      rootName,
      currentPath,
      rootId,
      onSwitchWorkspace,
      onForgetRemoteDevice,
      onNavigateToPath: handleNavigateToPath,
      onNavigateHistoryEntry: handleNavigateHistoryEntry,
      onListChildDirectories: listChildDirectories,
      recentPathHistory,
      onNavigateUp: navigateUp,
      isFlattenView,
      onToggleFlattenView: () => {
        void setFlattenView(!isFlattenView)
      },
      totalCount,
      imageCount,
      videoCount,
      showAnnotationFilterControls,
      annotationFilterTagOptions,
      onOpenAnnotationFilterPanel: handleOpenAnnotationFilterPanel,
      thumbnailSizePreset,
      onThumbnailSizePresetChange: setThumbnailSizePreset,
      canOpenTrash: hasTrashEntries,
      onOpenTrash: handleOpenTrash,
      canOpenPeople,
      onOpenPeople: handleOpenPeople,
      shortcutHelpEntries,
      onOpenPeopleForPerson: handleOpenPeopleForPerson,
      showPeoplePanel,
      peoplePanelPreferredPersonId,
      onClosePeoplePanel: handleClosePeople,
      onOpenFaceSource: handleOpenFaceSource,
      onProjectFaceSources: handleProjectFaceSources,
      error,
      isLoading,
      favoriteFolders,
      isCurrentPathFavorited,
      onOpenFavoriteFolder: openFavoriteFolder,
      onRemoveFavoriteFolder: removeFavoriteFolder,
      onToggleCurrentPathFavorite: toggleCurrentFolderFavorite,
      directoryFiles: filteredFiles,
      listingPage,
      onLoadNextListingPage: loadNextListingPage,
      activeSurfaceFiles,
      rootHandle,
      directoryFileGridRef,
      projectionFileGridRef,
      onDirectoryFileClick: handleDirectoryFileClick,
      onDirectoryFileDoubleClick: handleDirectoryFileDoubleClick,
      onProjectionFileClick: handleProjectionFileClick,
      onProjectionFileDoubleClick: handleProjectionFileDoubleClick,
      onDirectoryClick: handleDirectoryClick,
      onDirectoryGridSelectionChange: setDirectorySelectedPaths,
      directoryGridSelectedPaths: directorySelectedPaths,
      projectionTabs,
      activeProjectionTabId: activeProjectionTab?.id ?? null,
      onProjectionGridSelectionChange: handleProjectionGridSelectionChange,
      projectionGridSelectedPaths,
      activeDuplicateSelectionRule,
      onApplyDuplicateSelectionRule: handleApplyDuplicateSelectionRule,
      onClearDuplicateSelection: handleClearDuplicateSelection,
      onReapplyDuplicateGroup: handleReapplyDuplicateGroup,
      onClearDuplicateGroup: handleClearDuplicateGroup,
      isDirectorySurfaceActive,
      isResultPanelOpen,
      resultPanelDisplayMode,
      resultPanelHeightPx,
      onOpenResultPanel: handleOpenResultPanel,
      onCloseResultPanel: handleCloseResultPanel,
      onToggleResultPanelMaximized: handleToggleResultPanelMaximized,
      onResultPanelResizeStart: handleResultPanelResizeStart,
      onActivateProjectionTab: handleActivateProjectionTab,
      onCloseProjectionTab: handleCloseProjectionTab,
      onWorkspaceMutationCommitted: handleWorkspaceMutationCommitted,
      onPreviewMutationCommitted: handlePreviewMutationCommitted,
      showPreviewPane,
      hasOpenPreview,
      contentRef,
      paneWidthRatio,
      onPreviewPaneResizeStart: handlePreviewPaneResizeStart,
      selectedFile,
      gridSelectedCount: selectedGridItems.length,
      selectedGridMetaFile,
      pluginTools,
      onClosePane: closePreviewPane,
      onOpenFullscreenFromPane: openFullscreenFromPane,
      autoPlayEnabled,
      autoPlayIntervalSec,
      videoSeekStepSec,
      videoPlaybackRate,
      faceBboxVisible,
      onToggleAutoPlay: toggleAutoPlay,
      playbackOrder,
      onTogglePlaybackOrder: togglePlaybackOrder,
      onToggleFaceBboxVisible: toggleFaceBboxVisible,
      onAutoPlayIntervalChange: setAutoPlayInterval,
      onVideoSeekStepChange: setVideoSeekStep,
      onVideoPlaybackRateChange: setVideoPlaybackRate,
      onVideoEnded: handleAutoPlayVideoEnded,
      onVideoPlaybackError: handleAutoPlayVideoPlaybackError,
      previewFile,
      previewAutoPlayOnOpen,
      onClosePreview: closePreviewModal,
      activeProjection: activeSurfaceProjection,
      onActivateProjection: handleActivateProjection,
      onDismissProjectionTool: handleDismissProjectionTool,
      deleteUndoNoticeMessage,
      deleteUndoNoticeTone,
      canUndoDelete,
      isUndoingDelete,
      onUndoDelete: () => {
        void handleUndoDelete()
      },
  }

  if (presentationProfile.shellKind === 'compact') {
    return (
      <CompactWorkspaceShell
        {...commonShellProps}
        presentationProfile={presentationProfile}
        canNavigatePreviewBackward={canNavigatePreviewBackward}
        canNavigatePreviewForward={canNavigatePreviewForward}
        onNavigatePreviewBackward={handleNavigatePreviewBackward}
        onNavigatePreviewForward={handleNavigatePreviewForward}
      />
    )
  }

  return (
    <WideWorkspaceShell
      {...commonShellProps}
      presentationProfile={presentationProfile}
    />
  )
}
