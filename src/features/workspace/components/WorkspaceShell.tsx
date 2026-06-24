import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { usePreviewTraversal } from '@/features/preview/hooks/usePreviewTraversal'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
import { useShortcutHelpEntries } from '@/features/explorer/hooks/useShortcutHelpEntries'
import { CompactWorkspaceShell } from '@/features/workspace/components/CompactWorkspaceShell'
import { WideWorkspaceShell } from '@/features/workspace/components/WideWorkspaceShell'
import {
  type PendingDeleteUndoRestoreState,
  usePendingDeleteUndoRestore,
} from '@/features/workspace/hooks/usePendingDeleteUndoRestore'
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
import {
  cloneFilterState,
  isAnnotationFilterAtDefault,
  useWorkspaceFilterState,
} from '@/features/workspace/hooks/useWorkspaceFilterState'
import { useWorkspaceFileSelectionSummary } from '@/features/workspace/hooks/useWorkspaceFileSelectionSummary'
import { useWorkspacePathHistory } from '@/features/workspace/hooks/useWorkspacePathHistory'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import { normalizeRootRelativePath as normalizeRelativePath } from '@/features/workspace/lib/projectionTabs'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import { getFilePreviewKind } from '@/lib/filePreview'
import {
  type DeleteUndoBatch,
  type DeleteUndoPreviewSnapshot,
  type DeleteUndoRestoreItem,
  type DeleteUndoSnapshot,
} from '@/features/workspace/lib/deleteUndo'
import {
  countDeleteUndoItems,
  createDeleteUndoId,
  restoreDeleteUndoItemsThroughRuntime,
} from '@/features/workspace/lib/deleteUndoRuntime'
import {
  cloneDuplicateSelectionRuleRecord,
  cloneFileItem,
  cloneNullableStringRecord,
  cloneResultProjection,
  cloneStringArrayRecord,
} from '@/features/workspace/lib/deleteUndoSnapshot'
import { resolveDeleteUndoRestoreResult } from '@/features/workspace/lib/deleteUndoRestorePlan'
import { resolveWorkspacePreviewMutationPlan } from '@/features/workspace/lib/previewMutationPlan'
import { filterWorkspaceFiles } from '@/features/workspace/lib/workspaceFileFiltering'
import { getBoundRootPath } from '@/lib/reveal'
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
const DELETE_UNDO_NOTICE_TIMEOUT_MS = 6000

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

type DeleteUndoNoticeTone = 'default' | 'error'

interface DeleteUndoNoticeState {
  id: string
  message: string
  tone: DeleteUndoNoticeTone
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
  const [deleteUndoBatches, setDeleteUndoBatches] = useState<DeleteUndoBatch[]>([])
  const [isUndoingDelete, setIsUndoingDelete] = useState(false)
  const [deleteUndoNotice, setDeleteUndoNotice] = useState<DeleteUndoNoticeState | null>(null)
  const [pendingDeleteUndoRestore, setPendingDeleteUndoRestore] = useState<PendingDeleteUndoRestoreState | null>(null)
  const hasTrashEntries = useWorkspaceTrashAvailability({
    accessProvider,
    rootId,
    refreshKey: files,
  })
  const directoryFileGridRef = useRef<FileBrowserGridHandle>(null)
  const projectionFileGridRef = useRef<FileBrowserGridHandle>(null)
  const projectionInteractionRef = useRef<WorkspaceProjectionInteraction | null>(null)
  const previousShellKindRef = useRef(presentationProfile.shellKind)

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
  const hasActiveVideoPreview = useMemo(() => {
    const activePreviewFile = previewFile ?? (showPreviewPane ? selectedFile : null)
    if (!activePreviewFile || activePreviewFile.kind !== 'file') {
      return false
    }
    return getFilePreviewKind(activePreviewFile.name) === 'video'
  }, [previewFile, selectedFile, showPreviewPane])
  const activePreviewFileForTagShortcuts = useMemo(
    () => previewFile ?? (showPreviewPane ? selectedFile : null),
    [previewFile, selectedFile, showPreviewPane]
  )
  const canRunPreviewTagShortcuts = useMemo(() => (
    activePreviewFileForTagShortcuts?.kind === 'file'
    && !activePreviewFileForTagShortcuts.path.startsWith('/')
    && activePreviewFileForTagShortcuts.sourceType !== 'root_trash'
    && activePreviewFileForTagShortcuts.sourceType !== 'global_recycle'
    && pluginTools.some((tool) => tool.name === 'local.data' && tool.scopes.includes('file'))
  ), [activePreviewFileForTagShortcuts, pluginTools])
  const canSoftDeleteActivePreview = useMemo(() => (
    activePreviewFileForTagShortcuts?.kind === 'file'
    && activePreviewFileForTagShortcuts.sourceType !== 'root_trash'
    && activePreviewFileForTagShortcuts.sourceType !== 'global_recycle'
    && pluginTools.some((tool) => tool.name === 'fs.softDelete' && tool.scopes.includes('file'))
  ), [activePreviewFileForTagShortcuts, pluginTools])
  const canNavigatePreviewBackward = previewFile ? canNavigateMediaFromModal : canNavigateMediaFromPane
  const canNavigatePreviewForward = previewFile ? canNavigateMediaFromModal : canNavigateMediaFromPane
  const handleNavigatePreviewBackward = useCallback(() => {
    if (previewFile) {
      navigateMediaFromModal('prev')
      return
    }
    navigateMediaFromPane('prev')
  }, [navigateMediaFromModal, navigateMediaFromPane, previewFile])
  const handleNavigatePreviewForward = useCallback(() => {
    if (previewFile) {
      navigateMediaFromModal('next')
      return
    }
    navigateMediaFromPane('next')
  }, [navigateMediaFromModal, navigateMediaFromPane, previewFile])
  const { getMatchingPreviewTagShortcut } = useResolvedPreviewTagShortcuts({
    rootId,
    relativePath: activePreviewFileForTagShortcuts?.kind === 'file' ? activePreviewFileForTagShortcuts.path : null,
    enabled: canRunPreviewTagShortcuts,
  })
  const shortcutHelpEntries = useShortcutHelpEntries({
    rootId,
    currentPath,
    canUndoDelete: deleteUndoBatches.length > 0,
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
  const {
    toggleActivePreviewVideoPlayback,
    seekActivePreviewVideo,
  } = useActivePreviewVideoControls({
    preferredSurface: previewFile ? 'lightbox' : 'panel',
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

  useEffect(() => {
    const previousShellKind = previousShellKindRef.current
    previousShellKindRef.current = presentationProfile.shellKind

    if (previousShellKind === presentationProfile.shellKind) return
    if (presentationProfile.supportsPersistentPreviewPane) return
    if (!showPreviewPane || selectedFile?.kind !== 'file') return

    closePreviewPane()
    if (!previewFile) {
      openFileInModal(selectedFile)
    }
  }, [
    closePreviewPane,
    openFileInModal,
    presentationProfile.shellKind,
    presentationProfile.supportsPersistentPreviewPane,
    previewFile,
    selectedFile,
    showPreviewPane,
  ])

  const handleDirectoryClick = useCallback((dirName: string) => {
    setActiveSurface({ kind: 'directory' })
    void navigateToDirectory(dirName)
  }, [navigateToDirectory, setActiveSurface])

  const handleDirectoryFileClick = useCallback((file: FileItem) => {
    setActiveSurface({ kind: 'directory' })
    if (file.kind === 'directory') {
      void navigateToDirectory(file.name)
    } else {
      setDirectoryFocusedPath(file.path)
      openFileInPrimaryTarget(file)
    }
  }, [navigateToDirectory, openFileInPrimaryTarget, setActiveSurface])

  const handleDirectoryFileDoubleClick = useCallback((file: FileItem) => {
    if (file.kind === 'file') {
      setActiveSurface({ kind: 'directory' })
      setDirectoryFocusedPath(file.path)
      openFileInSecondaryTarget(file)
    }
  }, [openFileInSecondaryTarget, setActiveSurface])

  const handleNavigateToPath = useCallback((path: string) => {
    return navigateToPath(path, { resetFlattenView: true })
  }, [navigateToPath])
  const handleNavigateHistoryEntry = useCallback((entry: AddressPathHistoryEntry) => {
    return openHistoryEntry(entry)
  }, [openHistoryEntry])

  const showDeleteUndoNoticeMessage = useCallback((message: string, tone: DeleteUndoNoticeTone = 'default') => {
    setDeleteUndoNotice({
      id: createDeleteUndoId('delete-undo-notice'),
      message,
      tone,
    })
  }, [])

  const captureDeleteUndoPreviewSnapshot = useCallback((): DeleteUndoPreviewSnapshot => ({
    showPreviewPane,
    selectedFile: cloneFileItem(selectedFile),
    previewFile: cloneFileItem(previewFile),
  }), [previewFile, selectedFile, showPreviewPane])

  const captureDeleteUndoSnapshot = useCallback((): DeleteUndoSnapshot | null => {
    if (!rootId) {
      return null
    }

    return {
      historyEntry: {
        rootId,
        rootName: rootName || '根目录',
        path: currentPath,
        visitedAt: Date.now(),
      },
      rootPath: getBoundRootPath(rootId),
      currentPath,
      filter: cloneFilterState(filter),
      isFlattenView,
      activeSurface: activeSurface.kind === 'projection'
        ? { kind: 'projection', tabId: activeSurface.tabId }
        : { kind: 'directory' },
      directorySelectedPaths: [...directorySelectedPaths],
      directoryFocusedPath,
      isResultPanelOpen,
      resultPanelDisplayMode,
      resultPanelHeightPx,
      lastNormalResultPanelHeightPx: lastNormalResultPanelHeightRef.current,
      projectionTabs: projectionTabs.map((projection) => cloneResultProjection(projection)),
      activeProjectionTabId,
      projectionSelectedPathsById: cloneStringArrayRecord(projectionSelectedPathsById),
      projectionFocusedPathById: cloneNullableStringRecord(projectionFocusedPathById),
      duplicateSelectionRuleByProjectionId: cloneDuplicateSelectionRuleRecord(duplicateSelectionRuleByProjectionId),
      preview: captureDeleteUndoPreviewSnapshot(),
    }
  }, [
    activeProjectionTabId,
    activeSurface,
    captureDeleteUndoPreviewSnapshot,
    currentPath,
    directoryFocusedPath,
    directorySelectedPaths,
    duplicateSelectionRuleByProjectionId,
	    filter,
	    isFlattenView,
	    isResultPanelOpen,
	    lastNormalResultPanelHeightRef,
	    projectionFocusedPathById,
    projectionSelectedPathsById,
    projectionTabs,
    resultPanelDisplayMode,
    resultPanelHeightPx,
    rootName,
    rootId,
  ])

  const buildDeleteUndoBatch = useCallback((
    restoreItems: DeleteUndoRestoreItem[] | undefined,
    snapshot: DeleteUndoSnapshot | null
  ): DeleteUndoBatch | null => {
    if (!snapshot || !Array.isArray(restoreItems) || restoreItems.length === 0) {
      return null
    }

    return {
      id: createDeleteUndoId('delete-undo-batch'),
      createdAt: Date.now(),
      deletedCount: countDeleteUndoItems(restoreItems),
      restoreItems,
      snapshot,
    }
  }, [])

  const pushDeleteUndoBatch = useCallback((batch: DeleteUndoBatch | null) => {
    if (!batch) {
      return
    }

    setDeleteUndoBatches((previous) => [batch, ...previous])
    showDeleteUndoNoticeMessage(`已删除 ${batch.deletedCount} 项`, 'default')
  }, [showDeleteUndoNoticeMessage])

  const restoreDeleteUndoPreviewSnapshot = useCallback((previewSnapshot: DeleteUndoPreviewSnapshot) => {
    if (previewSnapshot.showPreviewPane && previewSnapshot.selectedFile?.kind === 'file') {
      openFileInPaneOrFullscreenFallback(previewSnapshot.selectedFile)
    } else {
      closePreviewPane()
    }

    if (previewSnapshot.previewFile?.kind === 'file') {
      openFileInModal(previewSnapshot.previewFile)
    } else {
      closePreviewModal()
    }
  }, [
    closePreviewModal,
    closePreviewPane,
    openFileInModal,
    openFileInPaneOrFullscreenFallback,
  ])

  const applyDeleteUndoSnapshot = useCallback(async (snapshot: DeleteUndoSnapshot) => {
    setFilter(cloneFilterState(snapshot.filter))

    if (isFlattenView !== snapshot.isFlattenView) {
      await setFlattenView(snapshot.isFlattenView)
    }

    lastNormalResultPanelHeightRef.current = snapshot.lastNormalResultPanelHeightPx
    setResultPanelHeightPx(snapshot.resultPanelHeightPx)
    setResultPanelDisplayMode(snapshot.resultPanelDisplayMode)
    setProjectionTabs(snapshot.projectionTabs.map((projection) => cloneResultProjection(projection)))
    setActiveProjectionTabId(snapshot.activeProjectionTabId)
    setLastProjectionTabId(snapshot.activeProjectionTabId)
    setProjectionSelectedPathsById(cloneStringArrayRecord(snapshot.projectionSelectedPathsById))
    setDuplicateSelectionRuleByProjectionId(cloneDuplicateSelectionRuleRecord(snapshot.duplicateSelectionRuleByProjectionId))
    setProjectionFocusedPathById(cloneNullableStringRecord(snapshot.projectionFocusedPathById))
    setDirectorySelectedPaths([...snapshot.directorySelectedPaths])
    setDirectoryFocusedPath(snapshot.directoryFocusedPath)
    setIsResultPanelOpen(snapshot.isResultPanelOpen)
    setActiveSurface(
      snapshot.activeSurface.kind === 'projection' && snapshot.activeProjectionTabId
        ? { kind: 'projection', tabId: snapshot.activeProjectionTabId }
        : { kind: 'directory' }
    )

    restoreDeleteUndoPreviewSnapshot(snapshot.preview)
    await refreshFilterTagSnapshots()
	  }, [
	    isFlattenView,
	    lastNormalResultPanelHeightRef,
	    refreshFilterTagSnapshots,
	    restoreDeleteUndoPreviewSnapshot,
		    setFilter,
		    setFlattenView,
		    setActiveProjectionTabId,
		    setActiveSurface,
		    setDuplicateSelectionRuleByProjectionId,
		    setIsResultPanelOpen,
		    setLastProjectionTabId,
		    setProjectionFocusedPathById,
		    setProjectionSelectedPathsById,
		    setProjectionTabs,
		    setResultPanelDisplayMode,
		    setResultPanelHeightPx,
		  ])

  const createDeleteUndoBatchFromParams = useCallback((
    params: WorkspaceMutationCommitParams | PreviewMutationCommitParams | undefined
  ): DeleteUndoBatch | null => {
    if (params?.mutationToolName !== 'fs.softDelete') {
      return null
    }
    return buildDeleteUndoBatch(params.undoRestoreItems, captureDeleteUndoSnapshot())
  }, [buildDeleteUndoBatch, captureDeleteUndoSnapshot])

  const handleWorkspaceMutationCommitted = useCallback(async (params?: WorkspaceMutationCommitParams) => {
    const deleteUndoBatch = createDeleteUndoBatchFromParams(params)
    if (
      params?.mutationToolName === 'fs.softDelete'
      && (
        (Array.isArray(params.deletedAbsolutePaths) && params.deletedAbsolutePaths.length > 0)
        || (Array.isArray(params.deletedProjectionPaths) && params.deletedProjectionPaths.length > 0)
      )
    ) {
      pruneDeletedFilesFromProjectionTabs({
        deletedAbsolutePaths: params.deletedAbsolutePaths,
        deletedProjectionPaths: params.deletedProjectionPaths,
        projectionTabId: params.projectionTabId,
      })
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

  const handleUndoDelete = useCallback(async () => {
    const batch = deleteUndoBatches[0]
    if (!batch || isUndoingDelete) {
      return
    }

    setIsUndoingDelete(true)

    try {
      const response = await restoreDeleteUndoItemsThroughRuntime(
        batch.restoreItems,
        batch.snapshot.rootPath,
      )
      const restoreResult = resolveDeleteUndoRestoreResult({
        batch,
        remainingUndoBatches: deleteUndoBatches.slice(1),
        response,
        retryBatchMetadata: {
          id: createDeleteUndoId('delete-undo-batch'),
          createdAt: Date.now(),
        },
      })
      setDeleteUndoBatches(restoreResult.undoBatches)

      if (restoreResult.restoredCount === 0) {
        showDeleteUndoNoticeMessage('撤销删除失败，请重试', 'error')
        setIsUndoingDelete(false)
        return
      }

      for (const restoredAbsolutePath of restoreResult.restoredAbsolutePaths) {
        forgetDeletedProjectionAbsolutePath(restoredAbsolutePath)
      }

      const shouldNavigateBack = (
        rootId !== restoreResult.restoredSnapshot.historyEntry.rootId
        || normalizeRelativePath(currentPath) !== normalizeRelativePath(restoreResult.restoredSnapshot.historyEntry.path)
      )
      if (shouldNavigateBack) {
        const reopened = await openHistoryEntry(restoreResult.restoredSnapshot.historyEntry)
        if (!reopened) {
          showDeleteUndoNoticeMessage(
            restoreResult.failedRetryBatch
              ? `已恢复 ${restoreResult.restoredCount} 项，但仍有 ${restoreResult.failedRetryBatch.deletedCount} 项待重试，且无法自动跳回原目录`
              : `已恢复 ${restoreResult.restoredCount} 项，但无法自动跳回原目录`,
            'error'
          )
          setIsUndoingDelete(false)
          return
        }
      }

      setPendingDeleteUndoRestore({ snapshot: restoreResult.restoredSnapshot })
      if (restoreResult.failedRetryBatch) {
        showDeleteUndoNoticeMessage(
          `已恢复 ${restoreResult.restoredCount} 项，仍有 ${restoreResult.failedRetryBatch.deletedCount} 项撤销失败`,
          'error'
        )
      } else {
        setDeleteUndoNotice(null)
      }
    } catch (error) {
      showDeleteUndoNoticeMessage(
        error instanceof Error ? error.message : '撤销删除失败',
        'error'
      )
      setIsUndoingDelete(false)
    }
  }, [
	    currentPath,
	    deleteUndoBatches,
	    forgetDeletedProjectionAbsolutePath,
	    isUndoingDelete,
    openHistoryEntry,
    rootId,
    showDeleteUndoNoticeMessage,
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
    if (!deleteUndoNotice) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setDeleteUndoNotice((previous) => (
        previous?.id === deleteUndoNotice.id
          ? null
          : previous
      ))
    }, DELETE_UNDO_NOTICE_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [deleteUndoNotice])

  usePendingDeleteUndoRestore({
    pendingDeleteUndoRestore,
    setPendingDeleteUndoRestore,
    rootId,
    currentPath,
    applyDeleteUndoSnapshot,
    showDeleteUndoNoticeMessage,
    setIsUndoingDelete,
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
      deleteUndoNoticeMessage: deleteUndoNotice?.message ?? null,
      deleteUndoNoticeTone: deleteUndoNotice?.tone ?? 'default',
      canUndoDelete: deleteUndoBatches.length > 0,
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
