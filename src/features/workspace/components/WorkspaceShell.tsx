import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { useShortcutHelpEntries } from '@/features/explorer/hooks/useShortcutHelpEntries'
import { WorkspaceShellOutlet } from '@/features/workspace/components/WorkspaceShellOutlet'
import { useInputMode } from '@/features/workspace/hooks/useInputMode'
import { useViewportMode } from '@/features/workspace/hooks/useViewportMode'
import {
  preloadWorkspaceAnnotationFilterSnapshots,
  useWorkspaceAnnotationFilterOptions,
} from '@/features/workspace/hooks/useWorkspaceAnnotationFilterOptions'
import { useWorkspaceKeyboardShortcuts } from '@/features/workspace/hooks/useWorkspaceKeyboardShortcuts'
import { useWorkspaceProjectionState } from '@/features/workspace/hooks/useWorkspaceProjectionState'
import { useWorkspaceResultPanelState } from '@/features/workspace/hooks/useWorkspaceResultPanelState'
import { useWorkspaceSelectionFocusSync } from '@/features/workspace/hooks/useWorkspaceSelectionFocusSync'
import { useWorkspacePreviewController } from '@/features/workspace/hooks/useWorkspacePreviewController'
import type { WorkspaceProjectionInteraction } from '@/features/workspace/types/projectionInteraction'
import { useWorkspacePeoplePanel } from '@/features/workspace/hooks/useWorkspacePeoplePanel'
import { useWorkspacePresentationProfile } from '@/features/workspace/hooks/useWorkspacePresentationProfile'
import { useWorkspacePluginTools } from '@/features/workspace/hooks/useWorkspacePluginTools'
import { useWorkspaceTrashAvailability } from '@/features/workspace/hooks/useWorkspaceTrashAvailability'
import { useWorkspaceDeleteUndoController } from '@/features/workspace/hooks/useWorkspaceDeleteUndoController'
import { useWorkspaceMutationCommitController } from '@/features/workspace/hooks/useWorkspaceMutationCommitController'
import { useWorkspaceShellInteractionHandlers } from '@/features/workspace/hooks/useWorkspaceShellInteractionHandlers'
import { useWorkspaceShellLifecycleEffects } from '@/features/workspace/hooks/useWorkspaceShellLifecycleEffects'
import { useWorkspaceFilterState } from '@/features/workspace/hooks/useWorkspaceFilterState'
import { useWorkspaceFileSelectionSummary } from '@/features/workspace/hooks/useWorkspaceFileSelectionSummary'
import { useWorkspacePathHistory } from '@/features/workspace/hooks/useWorkspacePathHistory'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import { filterWorkspaceFiles } from '@/features/workspace/lib/workspaceFileFiltering'
import { resolveWorkspaceTrashNavigationIntent } from '@/features/workspace/lib/workspaceShellInteractionModel'
import {
  type AddressPathHistoryEntry,
  type FavoriteFolderEntry,
  type FileItem,
  type FilterState,
  type ListingPageState,
  type ListingQueryState,
  type ThumbnailSizePreset,
} from '@/types'

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
    resultPanelDisplayMode,
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
    handleAutoPlayVideoEnded,
    handleAutoPlayVideoPlaybackError,
    alignPreviewToPath,
    contentRef,
    paneWidthRatio,
    handlePreviewPaneResizeStart,
    activePreviewFileForTagShortcuts,
    hasActiveVideoPreview,
    canRunPreviewTagShortcuts,
    canSoftDeleteActivePreview,
    canNavigatePreviewBackward,
    canNavigatePreviewForward,
    handleNavigatePreviewBackward,
    handleNavigatePreviewForward,
    getMatchingPreviewTagShortcut,
    toggleActivePreviewVideoPlayback,
    seekActivePreviewVideo,
    openFileInPrimaryTarget,
    openFileInSecondaryTarget,
    openFileInPaneOrFullscreenFallback,
  } = useWorkspacePreviewController({
    accessProvider,
    rootId,
    currentPath,
    filteredFiles,
    activeSurfaceFiles,
    thumbnailSizePreset,
    pluginTools,
    presentationProfile,
    navigateToPath,
  })
  projectionInteractionRef.current = {
    openFileInPrimaryTarget,
    openFileInSecondaryTarget,
    alignPreviewToPath,
  }

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

  const {
    handleWorkspaceMutationCommitted,
    handlePreviewMutationCommitted,
  } = useWorkspaceMutationCommitController({
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
  })

  const handleOpenTrash = useCallback(() => {
    const intent = resolveWorkspaceTrashNavigationIntent({ hasTrashEntries })
    if (intent.kind === 'none') return
    void navigateToPath(intent.path, { resetFlattenView: intent.resetFlattenView })
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

  useWorkspaceShellLifecycleEffects({
    currentPath,
    rootId,
    resetProjectionState,
    setDirectorySelectedPaths,
    setDirectoryFocusedPath,
    isAnnotationFilterGateResolved,
    isReviewFilterGateResolved,
    showAnnotationFilterControls,
    setFilter,
  })

  useEffect(() => {
    void preloadWorkspaceAnnotationFilterSnapshots({
      rootId,
      rootHandle,
      rootName,
    })
  }, [rootHandle, rootId, rootName])

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

  return (
    <WorkspaceShellOutlet
      shellProps={commonShellProps}
      presentationProfile={presentationProfile}
      canNavigatePreviewBackward={canNavigatePreviewBackward}
      canNavigatePreviewForward={canNavigatePreviewForward}
      onNavigatePreviewBackward={handleNavigatePreviewBackward}
      onNavigatePreviewForward={handleNavigatePreviewForward}
    />
  )
}
