import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import type { FaceRecord } from '@/features/faces/types'
import { usePreviewTraversal } from '@/features/preview/hooks/usePreviewTraversal'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
import { useShortcutHelpEntries } from '@/features/explorer/hooks/useShortcutHelpEntries'
import { CompactWorkspaceShell } from '@/features/workspace/components/CompactWorkspaceShell'
import { WideWorkspaceShell } from '@/features/workspace/components/WideWorkspaceShell'
import { useInputMode } from '@/features/workspace/hooks/useInputMode'
import { useViewportMode } from '@/features/workspace/hooks/useViewportMode'
import { useWorkspacePreviewPaneWidth } from '@/features/workspace/hooks/useWorkspacePreviewPaneWidth'
import { useWorkspacePresentationProfile } from '@/features/workspace/hooks/useWorkspacePresentationProfile'
import { useWorkspacePluginTools } from '@/features/workspace/hooks/useWorkspacePluginTools'
import { useWorkspaceTrashAvailability } from '@/features/workspace/hooks/useWorkspaceTrashAvailability'
import {
  cloneFilterState,
  isAnnotationFilterAtDefault,
  useWorkspaceFilterState,
} from '@/features/workspace/hooks/useWorkspaceFilterState'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import {
  buildDuplicateSelectionForGroup,
  buildDuplicateSelectionForProjection,
  type DuplicateSelectionRule,
  groupDuplicateProjectionFiles,
  isDuplicateProjection,
  replaceDuplicateGroupSelection,
} from '@/features/workspace/lib/duplicateSelection'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import { getFilePreviewKind, isMediaPreviewKind } from '@/lib/filePreview'
import { isImageFile, isVideoFile } from '@/lib/fileSystem'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import { toToolScopedProjectionId } from '@/lib/projection'
import {
  type DeleteUndoBatch,
  type DeleteUndoPreviewSnapshot,
  type DeleteUndoRestoreItem,
  type DeleteUndoSnapshot,
  normalizeAbsolutePath,
  remapFileItemAfterRestore,
  remapPathForRoot,
} from '@/features/workspace/lib/deleteUndo'
import {
  countDeleteUndoItems,
  createDeleteUndoId,
  pathRefersToDeletedAbsolutePath,
  restoreDeleteUndoItemsThroughRuntime,
} from '@/features/workspace/lib/deleteUndoRuntime'
import { filterWorkspaceFiles } from '@/features/workspace/lib/workspaceFileFiltering'
import {
  loadAddressPathHistory,
  saveAddressPathHistory,
  upsertAddressPathHistory,
} from '@/features/workspace/lib/addressPathHistory'
import {
  getAnnotationDisplayStoreVersion,
  getRootAnnotationFilterTagOptions,
  isAnnotationFilterUiGateResolved,
  isAnnotationFilterUiVisible,
  preloadAnnotationDisplaySnapshot,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'
import {
  getReviewFilterTagStoreVersion,
  getRootReviewFilterTagOptions,
  isReviewFilterTagSnapshotReady,
  preloadReviewFilterTagSnapshot,
  subscribeReviewFilterTagStore,
} from '@/features/faces/utils/reviewFilterTagStore'
import { fromRemoteUiRootId } from '@/lib/accessState'
import { getBoundRootPath } from '@/lib/reveal'
import {
  areWorkspaceBrowserHistorySnapshotsEqual,
  buildWorkspaceBrowserHistoryUrl,
  createWorkspaceBrowserHistoryState,
  normalizeWorkspaceBrowserHistorySnapshot,
  parseWorkspaceBrowserHistorySnapshotFromState,
  parseWorkspaceBrowserHistorySnapshotFromUrl,
  serializeWorkspaceBrowserHistorySnapshot,
  type WorkspaceBrowserHistorySnapshot,
} from '@/features/workspace/lib/browserHistory'
import {
  ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
  type AddressPathHistoryEntry,
  type AnnotationFilterTagOption,
  type FavoriteFolderEntry,
  type FileItem,
  type FilterState,
  type ListingPageState,
  type ListingQueryState,
  type ResultPanelDisplayMode,
  type ResultProjection,
  type ThumbnailSizePreset,
} from '@/types'
const TRASH_ROUTE_PATH = '@trash'
const DEFAULT_RESULT_PANEL_HEIGHT_PX = 280
const MIN_RESULT_PANEL_HEIGHT_PX = 180
const DELETE_UNDO_NOTICE_TIMEOUT_MS = 6000
const FACE_SOURCE_PROJECTION_ID = 'people:selected-face-sources'

let previewPanelModulesPreloaded = false

type WorkspaceActiveSurface =
  | { kind: 'directory' }
  | { kind: 'projection'; tabId: string }

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

interface PendingDeleteUndoRestoreState {
  snapshot: DeleteUndoSnapshot
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function cloneFileItem(file: FileItem | null): FileItem | null {
  if (!file) return null
  return {
    ...file,
    lastModified: file.lastModified ? new Date(file.lastModified) : undefined,
  }
}

function cloneResultProjection(projection: ResultProjection): ResultProjection {
  return {
    ...projection,
    files: projection.files.map((file) => cloneFileItem(file) ?? file),
  }
}

function cloneStringArrayRecord(record: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, [...value]])
  )
}

function cloneNullableStringRecord(record: Record<string, string | null>): Record<string, string | null> {
  return { ...record }
}

function cloneDuplicateSelectionRuleRecord(
  record: Record<string, DuplicateSelectionRule | null>
): Record<string, DuplicateSelectionRule | null> {
  return { ...record }
}

function getMaxResultPanelHeightPx(): number {
  if (typeof window === 'undefined') {
    return 640
  }
  return Math.max(MIN_RESULT_PANEL_HEIGHT_PX, window.innerHeight - 220)
}

function clampResultPanelHeightPx(value: number): number {
  return Math.min(getMaxResultPanelHeightPx(), Math.max(MIN_RESULT_PANEL_HEIGHT_PX, value))
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:[\\/]/.test(path)
}

function normalizeCurrentRootFaceSourcePath(assetPath: string | null | undefined): string | null {
  const rawPath = assetPath?.trim()
  if (!rawPath) return null

  const slashPath = rawPath.replace(/\\/g, '/')
  if (isAbsolutePathLike(slashPath)) {
    return null
  }

  const pathParts = slashPath.split('/').filter(Boolean)
  if (pathParts.length === 0 || pathParts.some((part) => part === '..')) {
    return null
  }
  return pathParts.join('/')
}

function normalizeAbsoluteFaceSourcePath(assetPath: string | null | undefined): string | null {
  const rawPath = assetPath?.trim()
  if (!rawPath) return null

  const slashPath = rawPath.replace(/\\/g, '/')
  if (!isAbsolutePathLike(slashPath)) return null
  return slashPath
}

function joinAbsolutePath(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizedRoot ? `${normalizedRoot}/${relativePath}` : relativePath
}

function getRelativeParentPath(relativePath: string): string {
  return relativePath.split('/').slice(0, -1).join('/')
}

function getRelativeFileName(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath
}

function resolveProjectionPreferredPath(projection: ResultProjection | null, preferredPath: string | null | undefined): string | null {
  if (!projection) return null
  const normalizedPreferredPath = normalizeRelativePath(preferredPath || '')
  if (
    normalizedPreferredPath
    && projection.files.some((file) => normalizeRelativePath(file.path) === normalizedPreferredPath)
  ) {
    return normalizedPreferredPath
  }
  return projection.files[0]?.path ?? null
}

function preloadPreviewModules(): void {
  if (previewPanelModulesPreloaded) return
  previewPanelModulesPreloaded = true

  const preloaders = [
    () => import('@/features/preview/components/FilePreviewPanel'),
    () => import('@/features/preview/components/FilePreviewCanvas'),
    () => import('@/features/preview/components/PreviewHeaderBar'),
    () => import('@/features/preview/components/PreviewControlGroup'),
    () => import('@/features/preview/components/PreviewTitleRow'),
    () => import('@/features/preview/components/MediaPlaybackControls'),
    () => import('@/features/preview/components/FilePreviewViewport'),
    () => import('@/features/preview/components/PreviewFeedbackOverlay'),
  ]

  for (const load of preloaders) {
    void load().catch(() => {})
  }
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
  const annotationDisplayStoreVersion = useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )
  const reviewFilterTagStoreVersion = useSyncExternalStore(
    subscribeReviewFilterTagStore,
    getReviewFilterTagStoreVersion,
    getReviewFilterTagStoreVersion
  )
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
  const [recentPathHistory, setRecentPathHistory] = useState<AddressPathHistoryEntry[]>(() => (
    loadAddressPathHistory(storageNamespace)
  ))
  const pluginTools = useWorkspacePluginTools({ accessProvider })
  const [projectionTabs, setProjectionTabs] = useState<ResultProjection[]>([])
  const [activeProjectionTabId, setActiveProjectionTabId] = useState<string | null>(null)
  const [activeSurface, setActiveSurface] = useState<WorkspaceActiveSurface>({ kind: 'directory' })
  const [projectionSelectedPathsById, setProjectionSelectedPathsById] = useState<Record<string, string[]>>({})
  const [duplicateSelectionRuleByProjectionId, setDuplicateSelectionRuleByProjectionId] = useState<Record<string, DuplicateSelectionRule | null>>({})
  const [directoryFocusedPath, setDirectoryFocusedPath] = useState<string | null>(null)
  const [projectionFocusedPathById, setProjectionFocusedPathById] = useState<Record<string, string | null>>({})
  const [isResultPanelOpen, setIsResultPanelOpen] = useState(false)
  const [resultPanelDisplayMode, setResultPanelDisplayMode] = useState<ResultPanelDisplayMode>('normal')
  const [resultPanelHeightPx, setResultPanelHeightPx] = useState(DEFAULT_RESULT_PANEL_HEIGHT_PX)
  const [deleteUndoBatches, setDeleteUndoBatches] = useState<DeleteUndoBatch[]>([])
  const [isUndoingDelete, setIsUndoingDelete] = useState(false)
  const [deleteUndoNotice, setDeleteUndoNotice] = useState<DeleteUndoNoticeState | null>(null)
  const [pendingDeleteUndoRestore, setPendingDeleteUndoRestore] = useState<PendingDeleteUndoRestoreState | null>(null)
  const [pendingBrowserHistoryRestore, setPendingBrowserHistoryRestore] = useState<WorkspaceBrowserHistorySnapshot | null>(null)
  const [pendingFaceSourcePath, setPendingFaceSourcePath] = useState<string | null>(null)
  const hasTrashEntries = useWorkspaceTrashAvailability({
    accessProvider,
    rootId,
    refreshKey: files,
  })
  const [showPeoplePanel, setShowPeoplePanel] = useState(false)
  const [peoplePanelPreferredPersonId, setPeoplePanelPreferredPersonId] = useState<string | null>(null)
  const directoryFileGridRef = useRef<FileBrowserGridHandle>(null)
  const projectionFileGridRef = useRef<FileBrowserGridHandle>(null)
  const lastNormalResultPanelHeightRef = useRef(DEFAULT_RESULT_PANEL_HEIGHT_PX)
  const lastProjectionTabIdRef = useRef<string | null>(null)
  const deletedProjectionAbsolutePathSetRef = useRef<Set<string>>(new Set())
  const previousShellKindRef = useRef(presentationProfile.shellKind)
  const hasInitializedBrowserHistoryRef = useRef(false)
  const lastBrowserHistoryKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!setListingQuery) return
    void setListingQuery(listingQuery)
  }, [listingQuery, setListingQuery])

  const isAnnotationFilterGateResolved = isAnnotationFilterUiGateResolved(rootId)
  const isReviewFilterGateResolved = isReviewFilterTagSnapshotReady(rootId)
  const annotationTagFilterVisible = isAnnotationFilterUiVisible(rootId)
  const reviewFilterTagOptions = useMemo<AnnotationFilterTagOption[]>(() => {
    void reviewFilterTagStoreVersion
    return getRootReviewFilterTagOptions(rootId)
  }, [reviewFilterTagStoreVersion, rootId])
  const showAnnotationFilterControls = annotationTagFilterVisible || reviewFilterTagOptions.length > 0
  const annotationFilterTagOptions = useMemo<AnnotationFilterTagOption[]>(() => {
    // Depend on external store version so tag options refresh with latest gateway tag snapshot.
    void annotationDisplayStoreVersion
    void reviewFilterTagStoreVersion
    if (!showAnnotationFilterControls) return []
    const rootTagOptions = getRootAnnotationFilterTagOptions(rootId)
    const specialOptions: AnnotationFilterTagOption[] = []
    if (annotationTagFilterVisible) {
      specialOptions.push({
        tagKey: ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
        key: '',
        value: '未标注',
        sources: [],
        hasMetaAnnotation: false,
        representativeSource: '',
      })
    }
    return [
      ...specialOptions,
      ...reviewFilterTagOptions,
      ...rootTagOptions,
    ]
  }, [
    annotationDisplayStoreVersion,
    annotationTagFilterVisible,
    reviewFilterTagOptions,
    reviewFilterTagStoreVersion,
    rootId,
    showAnnotationFilterControls,
  ])

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

  const totalCount = useMemo(() => filteredFiles.length, [filteredFiles])
  const imageCount = useMemo(
    () => filteredFiles.filter((file) => file.kind === 'file' && isImageFile(file.name)).length,
    [filteredFiles]
  )
  const videoCount = useMemo(
    () => filteredFiles.filter((file) => file.kind === 'file' && isVideoFile(file.name)).length,
    [filteredFiles]
  )
  const selectedGridItems = useMemo(() => {
    if (activeSurfaceSelectedPaths.length === 0) return []
    const selectedPathSet = new Set(activeSurfaceSelectedPaths)
    return activeSurfaceFiles.filter((file) => selectedPathSet.has(file.path))
  }, [activeSurfaceFiles, activeSurfaceSelectedPaths])
  const selectedGridMetaFile = useMemo(() => {
    if (selectedGridItems.length !== 1) return null
    return selectedGridItems[0]?.kind === 'file' ? selectedGridItems[0] : null
  }, [selectedGridItems])
  const activeSurfaceFileItems = useMemo(
    () => activeSurfaceFiles.filter((file): file is FileItem => file.kind === 'file'),
    [activeSurfaceFiles]
  )
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
  const browserHistorySnapshot = useMemo<WorkspaceBrowserHistorySnapshot>(() => (
    normalizeWorkspaceBrowserHistorySnapshot({
      accessProvider,
      rootId,
      path: currentPath,
      previewPath: previewFile?.kind === 'file'
        ? previewFile.path
        : (showPreviewPane && selectedFile?.kind === 'file' ? selectedFile.path : null),
      previewSurface: previewFile?.kind === 'file'
        ? 'lightbox'
        : (showPreviewPane && selectedFile?.kind === 'file' ? 'pane' : null),
    })!
  ), [accessProvider, currentPath, previewFile, rootId, selectedFile, showPreviewPane])
  const browserHistoryKey = useMemo(
    () => serializeWorkspaceBrowserHistorySnapshot(browserHistorySnapshot),
    [browserHistorySnapshot],
  )

  const getActivePreviewVideoElement = useCallback((): HTMLVideoElement | null => {
    const preferredSurface = previewFile ? 'lightbox' : 'panel'
    const preferredSelector = `video[data-preview-video="true"][data-preview-video-surface="${preferredSurface}"]`
    return (
      document.querySelector<HTMLVideoElement>(preferredSelector)
      ?? document.querySelector<HTMLVideoElement>('video[data-preview-video="true"]')
    )
  }, [previewFile])

  const applyVideoPlaybackRateToElement = useCallback((videoElement: HTMLVideoElement, rate: number): void => {
    videoElement.defaultPlaybackRate = rate
    videoElement.playbackRate = rate
  }, [])

  const applyVideoPlaybackRateToActivePreviewVideo = useCallback((rate: number): boolean => {
    const videoElement = getActivePreviewVideoElement()
    if (!videoElement) {
      return false
    }
    applyVideoPlaybackRateToElement(videoElement, rate)
    return true
  }, [applyVideoPlaybackRateToElement, getActivePreviewVideoElement])

  const toggleActivePreviewVideoPlayback = useCallback((): boolean => {
    const videoElement = getActivePreviewVideoElement()
    if (!videoElement) {
      return false
    }
    if (videoElement.paused || videoElement.ended) {
      const playPromise = videoElement.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        void playPromise.catch(() => {})
      }
      return true
    }

    videoElement.pause()
    return true
  }, [getActivePreviewVideoElement])

  const seekActivePreviewVideo = useCallback((direction: 'backward' | 'forward'): boolean => {
    const videoElement = getActivePreviewVideoElement()
    if (!videoElement) return false

    const baseCurrentTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0
    const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : Number.POSITIVE_INFINITY
    const delta = direction === 'backward' ? -videoSeekStepSec : videoSeekStepSec
    const nextTime = Math.min(duration, Math.max(0, baseCurrentTime + delta))
    videoElement.currentTime = nextTime
    return true
  }, [getActivePreviewVideoElement, videoSeekStepSec])

  const openFileInPrimaryTarget = useCallback((file: FileItem) => {
    if (file.kind !== 'file') return

    preloadPreviewModules()
    if (presentationProfile.primaryFileOpenTarget === 'fullscreen') {
      closePreviewPane()
      openFileInModal(file)
      return
    }

    showFileInPane(file)
  }, [
    closePreviewPane,
    openFileInModal,
    presentationProfile.primaryFileOpenTarget,
    showFileInPane,
  ])

  const openFileInSecondaryTarget = useCallback((file: FileItem) => {
    if (file.kind !== 'file') return

    preloadPreviewModules()
    if (presentationProfile.supportsPersistentPreviewPane && presentationProfile.primaryFileOpenTarget === 'pane') {
      openFileInModal(file)
      return
    }

    closePreviewPane()
    openFileInModal(file)
  }, [
    closePreviewPane,
    openFileInModal,
    presentationProfile.primaryFileOpenTarget,
    presentationProfile.supportsPersistentPreviewPane,
  ])

  const openFileInPaneOrFullscreenFallback = useCallback((file: FileItem) => {
    if (file.kind !== 'file') return

    preloadPreviewModules()
    if (presentationProfile.supportsPersistentPreviewPane) {
      showFileInPane(file)
      return
    }

    closePreviewPane()
    openFileInModal(file)
  }, [
    closePreviewPane,
    openFileInModal,
    presentationProfile.supportsPersistentPreviewPane,
    showFileInPane,
  ])

  const normalizeBrowserHistoryRestoreSnapshot = useCallback((snapshot: WorkspaceBrowserHistorySnapshot) => {
    if (
      snapshot.previewPath
      && snapshot.previewSurface === 'pane'
      && !presentationProfile.supportsPersistentPreviewPane
    ) {
      return {
        ...snapshot,
        previewSurface: 'lightbox' as const,
      }
    }
    return snapshot
  }, [presentationProfile.supportsPersistentPreviewPane])

  const commitBrowserHistorySnapshot = useCallback((snapshot: WorkspaceBrowserHistorySnapshot) => {
    if (typeof window === 'undefined') {
      return
    }
    window.history.replaceState(
      createWorkspaceBrowserHistoryState(snapshot),
      '',
      buildWorkspaceBrowserHistoryUrl(window.location.href, snapshot),
    )
    lastBrowserHistoryKeyRef.current = serializeWorkspaceBrowserHistorySnapshot(snapshot)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (hasInitializedBrowserHistoryRef.current) {
      return
    }

    hasInitializedBrowserHistoryRef.current = true
    const initialSnapshot = parseWorkspaceBrowserHistorySnapshotFromState(window.history.state)
      ?? parseWorkspaceBrowserHistorySnapshotFromUrl(window.location.search)

    if (
      initialSnapshot
      && initialSnapshot.accessProvider === accessProvider
      && initialSnapshot.rootId === rootId
    ) {
      const normalizedInitialSnapshot = normalizeBrowserHistoryRestoreSnapshot(initialSnapshot)
      if (!areWorkspaceBrowserHistorySnapshotsEqual(normalizedInitialSnapshot, browserHistorySnapshot)) {
        setPendingBrowserHistoryRestore(normalizedInitialSnapshot)
        return
      }
    }

    commitBrowserHistorySnapshot(browserHistorySnapshot)
  }, [
    accessProvider,
    browserHistorySnapshot,
    commitBrowserHistorySnapshot,
    normalizeBrowserHistoryRestoreSnapshot,
    rootId,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handlePopState = (event: PopStateEvent) => {
      const requestedSnapshot = parseWorkspaceBrowserHistorySnapshotFromState(event.state)
        ?? parseWorkspaceBrowserHistorySnapshotFromUrl(window.location.search)
      if (
        !requestedSnapshot
        || requestedSnapshot.accessProvider !== accessProvider
        || requestedSnapshot.rootId !== rootId
      ) {
        return
      }

      setPendingBrowserHistoryRestore(normalizeBrowserHistoryRestoreSnapshot(requestedSnapshot))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [accessProvider, normalizeBrowserHistoryRestoreSnapshot, rootId])

  useEffect(() => {
    if (!pendingBrowserHistoryRestore) {
      return
    }
    if (areWorkspaceBrowserHistorySnapshotsEqual(browserHistorySnapshot, pendingBrowserHistoryRestore)) {
      commitBrowserHistorySnapshot(browserHistorySnapshot)
      setPendingBrowserHistoryRestore(null)
      return
    }

    let cancelled = false
    const applyRestore = async () => {
      if (normalizeRelativePath(currentPath) !== pendingBrowserHistoryRestore.path) {
        const navigated = await navigateToPath(pendingBrowserHistoryRestore.path)
        if (!cancelled && !navigated) {
          commitBrowserHistorySnapshot(browserHistorySnapshot)
          setPendingBrowserHistoryRestore(null)
        }
        return
      }

      if (!pendingBrowserHistoryRestore.previewPath) {
        closePreviewModal()
        closePreviewPane()
        return
      }

      const targetPreviewFile = filteredFiles.find(
        (item): item is FileItem => item.kind === 'file' && item.path === pendingBrowserHistoryRestore.previewPath,
      ) ?? null

      if (!targetPreviewFile) {
        closePreviewModal()
        closePreviewPane()
        if (!cancelled) {
          commitBrowserHistorySnapshot(browserHistorySnapshot)
          setPendingBrowserHistoryRestore(null)
        }
        return
      }

      if (pendingBrowserHistoryRestore.previewSurface === 'lightbox') {
        closePreviewPane()
        openFileInModal(targetPreviewFile)
        return
      }

      closePreviewModal()
      openFileInPaneOrFullscreenFallback(targetPreviewFile)
    }

    void applyRestore()
    return () => {
      cancelled = true
    }
  }, [
    browserHistorySnapshot,
    closePreviewModal,
    closePreviewPane,
    commitBrowserHistorySnapshot,
    currentPath,
    filteredFiles,
    navigateToPath,
    openFileInModal,
    openFileInPaneOrFullscreenFallback,
    pendingBrowserHistoryRestore,
  ])

  useEffect(() => {
    if (!hasInitializedBrowserHistoryRef.current || pendingBrowserHistoryRestore) {
      return
    }
    if (browserHistoryKey === lastBrowserHistoryKeyRef.current) {
      return
    }
    if (typeof window === 'undefined') {
      return
    }

    window.history.pushState(
      createWorkspaceBrowserHistoryState(browserHistorySnapshot),
      '',
      buildWorkspaceBrowserHistoryUrl(window.location.href, browserHistorySnapshot),
    )
    lastBrowserHistoryKeyRef.current = browserHistoryKey
  }, [browserHistoryKey, browserHistorySnapshot, pendingBrowserHistoryRestore])

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
  }, [navigateToDirectory])

  const handleDirectoryFileClick = useCallback((file: FileItem) => {
    setActiveSurface({ kind: 'directory' })
    if (file.kind === 'directory') {
      void navigateToDirectory(file.name)
    } else {
      setDirectoryFocusedPath(file.path)
      openFileInPrimaryTarget(file)
    }
  }, [navigateToDirectory, openFileInPrimaryTarget])

  const handleDirectoryFileDoubleClick = useCallback((file: FileItem) => {
    if (file.kind === 'file') {
      setActiveSurface({ kind: 'directory' })
      setDirectoryFocusedPath(file.path)
      openFileInSecondaryTarget(file)
    }
  }, [openFileInSecondaryTarget])

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
    openFileInPrimaryTarget(file)
  }, [activeProjectionTab?.id, openFileInPrimaryTarget])

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
    openFileInSecondaryTarget(file)
  }, [activeProjectionTab?.id, openFileInSecondaryTarget])

  const handleNavigateToPath = useCallback((path: string) => {
    return navigateToPath(path, { resetFlattenView: true })
  }, [navigateToPath])
  const handleNavigateHistoryEntry = useCallback((entry: AddressPathHistoryEntry) => {
    return openHistoryEntry(entry)
  }, [openHistoryEntry])

  const refreshFilterTagSnapshots = useCallback(async () => {
    if (!rootId) return
    await Promise.all([
      preloadAnnotationDisplaySnapshot({
        rootId,
        rootHandle,
        rootLabel: rootName,
        force: true,
      }),
      preloadReviewFilterTagSnapshot({
        rootId,
        rootHandle,
        force: true,
      }),
    ])
  }, [rootHandle, rootId, rootName])

  const handleOpenAnnotationFilterPanel = useCallback(() => {
    void refreshFilterTagSnapshots()
  }, [refreshFilterTagSnapshots])

  const alignPreviewToProjection = useCallback((projection: ResultProjection | null, preferredPath?: string | null) => {
    alignPreviewToPath(resolveProjectionPreferredPath(projection, preferredPath))
  }, [alignPreviewToPath])

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

  const buildRestoredSnapshot = useCallback((
    snapshot: DeleteUndoSnapshot,
    restoredAbsolutePathByOriginalAbsolutePath: Map<string, string>,
    failedOriginalAbsolutePathSet: Set<string>
  ): DeleteUndoSnapshot => {
    const projectionPathRemapById = new Map<string, Map<string, string>>()
    const remappedProjectionTabs = snapshot.projectionTabs
      .map((projection) => {
        const pathMap = new Map<string, string>()
        const remappedFiles = projection.files
          .map((file) => {
            const remappedFile = remapFileItemAfterRestore(
              file,
              file.sourceRootPath ?? snapshot.rootPath,
              restoredAbsolutePathByOriginalAbsolutePath
            )
            pathMap.set(file.path, remappedFile.path)
            return remappedFile
          })
          .filter((file) => {
            const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
            return !absolutePath || !failedOriginalAbsolutePathSet.has(normalizeAbsolutePath(absolutePath))
          })

        projectionPathRemapById.set(projection.id, pathMap)

        return {
          ...projection,
          files: remappedFiles,
        }
      })
      .filter((projection) => projection.files.length > 0)

    const remapProjectionPath = (tabId: string, path: string | null | undefined): string | null => {
      const normalizedPath = typeof path === 'string' ? path.trim() : ''
      if (!normalizedPath) {
        return null
      }
      const nextPath = projectionPathRemapById.get(tabId)?.get(normalizedPath)
      return nextPath ?? normalizedPath
    }

    const nextProjectionSelectedPathsById: Record<string, string[]> = {}
    const nextProjectionFocusedPathById: Record<string, string | null> = {}
    for (const projection of remappedProjectionTabs) {
      const visiblePathSet = new Set(projection.files.map((file) => file.path))
      const nextSelectedPaths = (snapshot.projectionSelectedPathsById[projection.id] ?? [])
        .map((path) => remapProjectionPath(projection.id, path))
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
        .filter((path) => visiblePathSet.has(path))
      if (nextSelectedPaths.length > 0) {
        nextProjectionSelectedPathsById[projection.id] = nextSelectedPaths
      }
      const nextFocusedPath = remapProjectionPath(
        projection.id,
        snapshot.projectionFocusedPathById[projection.id] ?? null
      )
      if (nextFocusedPath && visiblePathSet.has(nextFocusedPath)) {
        nextProjectionFocusedPathById[projection.id] = nextFocusedPath
      }
    }

    const nextDirectorySelectedPaths = snapshot.directorySelectedPaths
      .map((path) => remapPathForRoot(path, snapshot.rootPath, restoredAbsolutePathByOriginalAbsolutePath))
      .filter((path): path is string => Boolean(path))
      .filter((path) => !pathRefersToDeletedAbsolutePath(path, snapshot.rootPath, failedOriginalAbsolutePathSet))

    const nextDirectoryFocusedPath = (() => {
      const remappedPath = remapPathForRoot(
        snapshot.directoryFocusedPath,
        snapshot.rootPath,
        restoredAbsolutePathByOriginalAbsolutePath
      )
      if (pathRefersToDeletedAbsolutePath(remappedPath, snapshot.rootPath, failedOriginalAbsolutePathSet)) {
        return null
      }
      return remappedPath
    })()

    const remappedSelectedPreviewFile = snapshot.preview.selectedFile
      ? remapFileItemAfterRestore(
        snapshot.preview.selectedFile,
        snapshot.preview.selectedFile.sourceRootPath ?? snapshot.rootPath,
        restoredAbsolutePathByOriginalAbsolutePath
      )
      : null
    const remappedPreviewFile = snapshot.preview.previewFile
      ? remapFileItemAfterRestore(
        snapshot.preview.previewFile,
        snapshot.preview.previewFile.sourceRootPath ?? snapshot.rootPath,
        restoredAbsolutePathByOriginalAbsolutePath
      )
      : null

    const nextSelectedPreviewFile = (
      remappedSelectedPreviewFile
      && !pathRefersToDeletedAbsolutePath(
        remappedSelectedPreviewFile.absolutePath ?? remappedSelectedPreviewFile.path,
        remappedSelectedPreviewFile.sourceRootPath ?? snapshot.rootPath,
        failedOriginalAbsolutePathSet
      )
    )
      ? remappedSelectedPreviewFile
      : null
    const nextPreviewFile = (
      remappedPreviewFile
      && !pathRefersToDeletedAbsolutePath(
        remappedPreviewFile.absolutePath ?? remappedPreviewFile.path,
        remappedPreviewFile.sourceRootPath ?? snapshot.rootPath,
        failedOriginalAbsolutePathSet
      )
    )
      ? remappedPreviewFile
      : null

    const visibleTabIdSet = new Set(remappedProjectionTabs.map((projection) => projection.id))
    const nextActiveProjectionTabId = (
      snapshot.activeProjectionTabId
      && visibleTabIdSet.has(snapshot.activeProjectionTabId)
    )
      ? snapshot.activeProjectionTabId
      : (remappedProjectionTabs[0]?.id ?? null)
    const nextActiveSurface = (
      snapshot.activeSurface.kind === 'projection'
      && nextActiveProjectionTabId
    )
      ? { kind: 'projection' as const, tabId: nextActiveProjectionTabId }
      : { kind: 'directory' as const }

    return {
      ...snapshot,
      directorySelectedPaths: nextDirectorySelectedPaths,
      directoryFocusedPath: nextDirectoryFocusedPath,
      isResultPanelOpen: snapshot.isResultPanelOpen && remappedProjectionTabs.length > 0,
      projectionTabs: remappedProjectionTabs,
      activeProjectionTabId: nextActiveProjectionTabId,
      projectionSelectedPathsById: nextProjectionSelectedPathsById,
      projectionFocusedPathById: nextProjectionFocusedPathById,
      activeSurface: nextActiveSurface,
      preview: {
        showPreviewPane: snapshot.preview.showPreviewPane && nextSelectedPreviewFile?.kind === 'file',
        selectedFile: nextSelectedPreviewFile,
        previewFile: nextPreviewFile,
      },
    }
  }, [])

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
    lastProjectionTabIdRef.current = snapshot.activeProjectionTabId
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
	    refreshFilterTagSnapshots,
	    restoreDeleteUndoPreviewSnapshot,
	    setFilter,
	    setFlattenView,
	  ])

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
  }, [alignPreviewToProjection, projectionFocusedPathById])

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
  }, [activeProjectionTabId, activeSurface, isResultPanelOpen])

  const sanitizeProjectionAgainstDeletedFiles = useCallback((projection: ResultProjection): ResultProjection | null => {
    const deletedAbsolutePathSet = deletedProjectionAbsolutePathSetRef.current
    if (deletedAbsolutePathSet.size === 0) {
      return projection
    }

    const nextFiles = projection.files.filter((file) => {
      const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
      return !absolutePath || !deletedAbsolutePathSet.has(absolutePath)
    })
    if (nextFiles.length === 0) {
      return null
    }
    if (nextFiles.length === projection.files.length) {
      return projection
    }
    return {
      ...projection,
      files: nextFiles,
    }
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
    alignPreviewToPath(directoryFocusedPath)
  }, [alignPreviewToPath, directoryFocusedPath])

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
  }, [activeProjectionTab?.id, alignPreviewToProjection, projectionFocusedPathById, projectionTabs])

  const handleResultPanelResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (resultPanelDisplayMode !== 'normal') return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = resultPanelHeightPx

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = clampResultPanelHeightPx(startHeight + (startY - moveEvent.clientY))
      lastNormalResultPanelHeightRef.current = nextHeight
      setResultPanelHeightPx(nextHeight)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [resultPanelDisplayMode, resultPanelHeightPx])

  const handleCloseProjectionTab = useCallback((tabId: string) => {
    const closingIndex = projectionTabs.findIndex((projection) => projection.id === tabId)
    const remainingTabs = projectionTabs.filter((projection) => projection.id !== tabId)
    const nextActiveTabId = (() => {
      if (remainingTabs.length === 0) return null
      if (closingIndex < 0) return remainingTabs[0]?.id ?? null
      return remainingTabs[closingIndex]?.id ?? remainingTabs[closingIndex - 1]?.id ?? remainingTabs[0]?.id ?? null
    })()

    setProjectionTabs(remainingTabs)
    setProjectionSelectedPathsById((previous) => {
      if (!(tabId in previous)) return previous
      const next = { ...previous }
      delete next[tabId]
      return next
    })
    setDuplicateSelectionRuleByProjectionId((previous) => {
      if (!(tabId in previous)) return previous
      const next = { ...previous }
      delete next[tabId]
      return next
    })
    setProjectionFocusedPathById((previous) => {
      if (!(tabId in previous)) return previous
      const next = { ...previous }
      delete next[tabId]
      return next
    })

    if (lastProjectionTabIdRef.current === tabId) {
      lastProjectionTabIdRef.current = nextActiveTabId
    }

    setActiveProjectionTabId(nextActiveTabId)
    if (!nextActiveTabId) {
      setIsResultPanelOpen(false)
      setActiveSurface({ kind: 'directory' })
      alignPreviewToPath(directoryFocusedPath)
      return
    }

    if (activeSurface.kind === 'projection' && activeSurface.tabId === tabId) {
      const nextProjection = remainingTabs.find((projection) => projection.id === nextActiveTabId) ?? null
      setActiveSurface({ kind: 'projection', tabId: nextActiveTabId })
      alignPreviewToProjection(nextProjection, projectionFocusedPathById[nextActiveTabId])
    }
  }, [activeSurface, alignPreviewToPath, alignPreviewToProjection, directoryFocusedPath, projectionFocusedPathById, projectionTabs])

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

  const pruneDeletedFilesFromProjectionTabs = useCallback((params: {
    deletedAbsolutePaths?: string[]
    deletedProjectionPaths?: string[]
    projectionTabId?: string | null
  }) => {
    if (projectionTabs.length === 0) {
      return
    }

    const deletedAbsolutePathSet = new Set(
      (params.deletedAbsolutePaths ?? [])
        .map((item) => item.trim())
        .filter(Boolean)
    )
    for (const absolutePath of deletedAbsolutePathSet) {
      deletedProjectionAbsolutePathSetRef.current.add(absolutePath)
    }
    const deletedProjectionPathSet = new Set(
      (params.deletedProjectionPaths ?? [])
        .map((item) => normalizeRelativePath(item))
        .filter(Boolean)
    )
    if (deletedAbsolutePathSet.size === 0 && deletedProjectionPathSet.size === 0) {
      return
    }

    let didChange = false
    const nextTabs = projectionTabs
      .map((projection) => {
        const isTargetProjection = projection.id === params.projectionTabId
        const nextFiles = projection.files.filter((file) => {
          const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
          const filePath = normalizeRelativePath(file.path)
          if (absolutePath && deletedAbsolutePathSet.has(absolutePath)) {
            return false
          }
          if (isTargetProjection && filePath && deletedProjectionPathSet.has(filePath)) {
            return false
          }
          return true
        })
        if (nextFiles.length !== projection.files.length) {
          didChange = true
        }
        return nextFiles.length === projection.files.length
          ? projection
          : {
            ...projection,
            files: nextFiles,
          }
      })
      .filter((projection) => projection.files.length > 0)

    if (!didChange && nextTabs.length === projectionTabs.length) {
      return
    }

    const nextTabIdSet = new Set(nextTabs.map((projection) => projection.id))
    setProjectionTabs(nextTabs)
    setProjectionSelectedPathsById((previous) => {
      const next: Record<string, string[]> = {}
      for (const projection of nextTabs) {
        const visiblePathSet = new Set(projection.files.map((file) => file.path))
        const nextSelectedPaths = (previous[projection.id] ?? []).filter((path) => visiblePathSet.has(path))
        if (nextSelectedPaths.length > 0) {
          next[projection.id] = nextSelectedPaths
        }
      }
      return next
    })
    setDuplicateSelectionRuleByProjectionId((previous) => {
      const next: Record<string, DuplicateSelectionRule | null> = {}
      for (const [tabId, rule] of Object.entries(previous)) {
        if (nextTabIdSet.has(tabId)) {
          next[tabId] = rule
        }
      }
      return next
    })
    setProjectionFocusedPathById((previous) => {
      const next: Record<string, string | null> = {}
      for (const projection of nextTabs) {
        const currentFocusedPath = previous[projection.id] ?? null
        const visiblePathSet = new Set(projection.files.map((file) => file.path))
        if (currentFocusedPath && visiblePathSet.has(currentFocusedPath)) {
          next[projection.id] = currentFocusedPath
        }
      }
      return next
    })

    const nextActiveTabId = (() => {
      if (nextTabs.length === 0) return null
      if (activeProjectionTabId && nextTabIdSet.has(activeProjectionTabId)) {
        return activeProjectionTabId
      }
      return nextTabs[0]?.id ?? null
    })()

    setActiveProjectionTabId(nextActiveTabId)
    if (!nextActiveTabId) {
      lastProjectionTabIdRef.current = null
      setIsResultPanelOpen(false)
      setActiveSurface({ kind: 'directory' })
      return
    }

    if (activeSurface.kind === 'projection' && !nextTabIdSet.has(activeSurface.tabId)) {
      setActiveSurface({ kind: 'projection', tabId: nextActiveTabId })
    }
    if (lastProjectionTabIdRef.current && !nextTabIdSet.has(lastProjectionTabIdRef.current)) {
      lastProjectionTabIdRef.current = nextActiveTabId
    }
  }, [activeProjectionTabId, activeSurface, projectionTabs])

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

  const resolveNextFileAfterDelete = useCallback((deletedRelativePath: string): FileItem | null => {
    const normalizedDeletedPath = normalizeRelativePath(deletedRelativePath)
    if (!normalizedDeletedPath || activeSurfaceFileItems.length <= 1) return null

    const deletedIndex = activeSurfaceFileItems.findIndex((file) => (
      normalizeRelativePath(file.path) === normalizedDeletedPath
    ))
    if (deletedIndex < 0) return null

    const nextIndex = (deletedIndex + 1) % activeSurfaceFileItems.length
    const nextFile = activeSurfaceFileItems[nextIndex]
    if (!nextFile) return null
    if (normalizeRelativePath(nextFile.path) === normalizedDeletedPath) return null
    return nextFile
  }, [activeSurfaceFileItems])

  const handlePreviewMutationCommitted = useCallback(async (params?: PreviewMutationCommitParams) => {
    const deleteUndoBatch = createDeleteUndoBatchFromParams(params)
    const preferredPreviewPath = normalizeRelativePath(params?.preferredPreviewPath || '')
    if (preferredPreviewPath) {
      alignPreviewToPath(preferredPreviewPath)
      await navigateToPath(currentPath)
      await refreshFilterTagSnapshots()
      pushDeleteUndoBatch(deleteUndoBatch)
      return
    }

    if (params?.mutationToolName === 'fs.softDelete') {
      const activePreviewFile = previewFile ?? selectedFile
      const fallbackProjectionTabId = params.projectionTabId
        ?? (activeSurface.kind === 'projection' ? activeSurface.tabId : null)
      const fallbackDeletedProjectionPaths = (
        Array.isArray(params.deletedProjectionPaths) && params.deletedProjectionPaths.length > 0
      )
        ? params.deletedProjectionPaths
        : (
          fallbackProjectionTabId && activePreviewFile?.kind === 'file'
            ? [activePreviewFile.path]
            : []
        )
      const fallbackDeletedAbsolutePaths = (
        Array.isArray(params.deletedAbsolutePaths) && params.deletedAbsolutePaths.length > 0
      )
        ? params.deletedAbsolutePaths
        : (
          activePreviewFile?.kind === 'file' && typeof activePreviewFile.absolutePath === 'string' && activePreviewFile.absolutePath.trim()
            ? [activePreviewFile.absolutePath.trim()]
            : []
        )
      if (fallbackDeletedAbsolutePaths.length > 0 || fallbackDeletedProjectionPaths.length > 0) {
        pruneDeletedFilesFromProjectionTabs({
          deletedAbsolutePaths: fallbackDeletedAbsolutePaths,
          deletedProjectionPaths: fallbackDeletedProjectionPaths,
          projectionTabId: fallbackProjectionTabId,
        })
      }

      const deletedRelativePath = normalizeRelativePath(params.deletedRelativePath || '')
      const activePreviewPath = activePreviewFile?.kind === 'file'
        ? normalizeRelativePath(activePreviewFile.path)
        : ''

      if (
        deletedRelativePath
        && activePreviewFile?.kind === 'file'
        && activePreviewPath === deletedRelativePath
      ) {
        const previewKind = getFilePreviewKind(activePreviewFile.name)
        if (isMediaPreviewKind(previewKind)) {
          if (previewFile) {
            navigateMediaFromModal('next')
          } else {
            navigateMediaFromPane('next')
          }
        } else {
          const nextFile = resolveNextFileAfterDelete(deletedRelativePath)
          if (nextFile) {
            if (previewFile) {
              openFileInModal(nextFile)
            } else {
              openFileInPrimaryTarget(nextFile)
            }
          }
        }
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
    resolveNextFileAfterDelete,
    selectedFile,
    openFileInPrimaryTarget,
    openFileInModal,
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
      const responseItems = Array.isArray(response.items) ? response.items : []
      const restoredAbsolutePathByOriginalAbsolutePath = new Map<string, string>()
      const failedRestoreItems: DeleteUndoRestoreItem[] = []

      batch.restoreItems.forEach((restoreItem, index) => {
        const responseItem = responseItems[index]
        const nextAbsolutePath = typeof responseItem?.nextAbsolutePath === 'string'
          ? responseItem.nextAbsolutePath.trim()
          : ''
        if (responseItem?.ok === true && nextAbsolutePath) {
          const normalizedNextAbsolutePath = normalizeAbsolutePath(nextAbsolutePath)
          restoredAbsolutePathByOriginalAbsolutePath.set(
            normalizeAbsolutePath(restoreItem.originalAbsolutePath),
            normalizedNextAbsolutePath
          )
          return
        }
        failedRestoreItems.push(restoreItem)
      })

      const failedOriginalAbsolutePathSet = new Set(
        failedRestoreItems.map((item) => normalizeAbsolutePath(item.originalAbsolutePath))
      )
      const restoredCount = restoredAbsolutePathByOriginalAbsolutePath.size
      const remainingUndoBatches = deleteUndoBatches.slice(1)
      const retrySnapshot = buildRestoredSnapshot(
        batch.snapshot,
        restoredAbsolutePathByOriginalAbsolutePath,
        new Set()
      )
      const restoredSnapshot = buildRestoredSnapshot(
        batch.snapshot,
        restoredAbsolutePathByOriginalAbsolutePath,
        failedOriginalAbsolutePathSet
      )
      const failedRetryBatch = failedRestoreItems.length > 0
        ? {
          id: createDeleteUndoId('delete-undo-batch'),
          createdAt: Date.now(),
          deletedCount: failedRestoreItems.length,
          restoreItems: failedRestoreItems,
          snapshot: retrySnapshot,
        }
        : null

      if (failedRetryBatch) {
        setDeleteUndoBatches([failedRetryBatch, ...remainingUndoBatches])
      } else {
        setDeleteUndoBatches(remainingUndoBatches)
      }

      if (restoredCount === 0) {
        showDeleteUndoNoticeMessage('撤销删除失败，请重试', 'error')
        setIsUndoingDelete(false)
        return
      }

      for (const restoredAbsolutePath of restoredAbsolutePathByOriginalAbsolutePath.values()) {
        deletedProjectionAbsolutePathSetRef.current.delete(normalizeAbsolutePath(restoredAbsolutePath))
      }

      const shouldNavigateBack = (
        rootId !== restoredSnapshot.historyEntry.rootId
        || normalizeRelativePath(currentPath) !== normalizeRelativePath(restoredSnapshot.historyEntry.path)
      )
      if (shouldNavigateBack) {
        const reopened = await openHistoryEntry(restoredSnapshot.historyEntry)
        if (!reopened) {
          showDeleteUndoNoticeMessage(
            failedRetryBatch
              ? `已恢复 ${restoredCount} 项，但仍有 ${failedRetryBatch.deletedCount} 项待重试，且无法自动跳回原目录`
              : `已恢复 ${restoredCount} 项，但无法自动跳回原目录`,
            'error'
          )
          setIsUndoingDelete(false)
          return
        }
      }

      setPendingDeleteUndoRestore({ snapshot: restoredSnapshot })
      if (failedRetryBatch) {
        showDeleteUndoNoticeMessage(
          `已恢复 ${restoredCount} 项，仍有 ${failedRetryBatch.deletedCount} 项撤销失败`,
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
    buildRestoredSnapshot,
    currentPath,
    deleteUndoBatches,
    isUndoingDelete,
    openHistoryEntry,
    rootId,
    showDeleteUndoNoticeMessage,
  ])

  const handleOpenTrash = useCallback(() => {
    if (!hasTrashEntries) return
    void navigateToPath(TRASH_ROUTE_PATH, { resetFlattenView: true })
  }, [hasTrashEntries, navigateToPath])

  const canOpenPeople = useMemo(() => (
    accessProvider === 'remote-readonly'
      ? true
      : pluginTools.some((tool) => tool.name === 'vision.face' && tool.scopes.includes('workspace'))
  ), [accessProvider, pluginTools])
  const remoteConfigRootId = useMemo(
    () => (accessProvider === 'remote-readonly' ? fromRemoteUiRootId(rootId) : null),
    [accessProvider, rootId],
  )

  const handleOpenPeople = useCallback(() => {
    if (!canOpenPeople) return
    setPeoplePanelPreferredPersonId(null)
    setShowPeoplePanel(true)
  }, [canOpenPeople])

  const handleOpenPeopleForPerson = useCallback((personId: string | null) => {
    if (!canOpenPeople) return
    setPeoplePanelPreferredPersonId(personId)
    setShowPeoplePanel(true)
  }, [canOpenPeople])

  const handleClosePeople = useCallback(() => {
    setShowPeoplePanel(false)
  }, [])

  const handleOpenFaceSource = useCallback(async (face: FaceRecord): Promise<boolean> => {
    const sourcePath = normalizeCurrentRootFaceSourcePath(face.assetPath)
    if (!sourcePath) return false

    setPendingFaceSourcePath(sourcePath)

    const parentPath = getRelativeParentPath(sourcePath)
    if (normalizeRelativePath(currentPath) === parentPath) {
      setActiveSurface({ kind: 'directory' })
      setDirectoryFocusedPath(sourcePath)
      return true
    }

    const navigated = await navigateToPath(parentPath, { resetFlattenView: true })
    if (!navigated) {
      setPendingFaceSourcePath((previous) => (previous === sourcePath ? null : previous))
      return false
    }
    setActiveSurface({ kind: 'directory' })
    setDirectoryFocusedPath(sourcePath)
    return true
  }, [
    currentPath,
    navigateToPath,
  ])

  useEffect(() => {
    if (activeSurface.kind !== 'directory') return
    if (!pendingFaceSourcePath) return

    const normalizedSourcePath = normalizeRelativePath(pendingFaceSourcePath)
    // Wait until the directory surface has the real source file item before opening it.
    const sourceFile = filteredFiles.find((file) => (
      file.kind === 'file' && normalizeRelativePath(file.path) === normalizedSourcePath
    )) ?? null

    if (!sourceFile) return

    openFileInPrimaryTarget(sourceFile)
    setPendingFaceSourcePath((previous) => (previous === normalizedSourcePath ? null : previous))
  }, [
    activeSurface,
    filteredFiles,
    openFileInPrimaryTarget,
    pendingFaceSourcePath,
  ])

  const handleProjectFaceSources = useCallback((selectedFaces: FaceRecord[]): boolean => {
    const boundRootPath = getBoundRootPath(rootId)
    const existingFileByPath = new Map(
      [...activeSurfaceFiles, ...filteredFiles]
        .filter((file) => file.kind === 'file')
        .map((file) => [normalizeRelativePath(file.path), file])
    )
    const fileByKey = new Map<string, FileItem>()

    for (const face of selectedFaces) {
      const relativePath = normalizeCurrentRootFaceSourcePath(face.assetPath)
      if (relativePath) {
        const existingFile = existingFileByPath.get(relativePath)
        const absolutePath = boundRootPath ? joinAbsolutePath(boundRootPath, relativePath) : undefined
        const nextFile: FileItem = existingFile
          ? {
            ...existingFile,
            remoteRootId: existingFile.remoteRootId ?? remoteConfigRootId ?? undefined,
            sourceRootPath: existingFile.sourceRootPath ?? boundRootPath ?? undefined,
            sourceRelativePath: existingFile.sourceRelativePath ?? relativePath,
            absolutePath: existingFile.absolutePath ?? absolutePath,
          }
          : {
            name: getRelativeFileName(relativePath),
            path: relativePath,
            kind: 'file',
            absolutePath,
            displayPath: relativePath,
            previewKind: getFilePreviewKind(relativePath),
            remoteRootId: remoteConfigRootId ?? undefined,
            sourceType: 'face_source',
            sourceRootPath: boundRootPath ?? undefined,
            sourceRelativePath: relativePath,
          }

        if (!fileByKey.has(`relative:${relativePath}`)) {
          fileByKey.set(`relative:${relativePath}`, nextFile)
        }
        continue
      }

      const absolutePath = normalizeAbsoluteFaceSourcePath(face.assetPath)
      if (!absolutePath) continue

      if (!fileByKey.has(`absolute:${absolutePath}`)) {
        fileByKey.set(`absolute:${absolutePath}`, {
          name: getRelativeFileName(absolutePath),
          path: absolutePath,
          kind: 'file',
          absolutePath,
          displayPath: absolutePath,
          previewKind: getFilePreviewKind(absolutePath),
          sourceType: 'face_source',
        })
      }
    }

    const projectionFiles = [...fileByKey.values()]
    if (projectionFiles.length === 0) {
      return false
    }

    const projection: ResultProjection = {
      id: FACE_SOURCE_PROJECTION_ID,
      title: `人脸来源 ${projectionFiles.length} 个文件`,
      entry: 'manual',
      ordering: {
        mode: 'listed',
      },
      files: projectionFiles,
    }

    handleActivateProjection(projection)
    setShowPeoplePanel(false)
    return true
  }, [activeSurfaceFiles, filteredFiles, handleActivateProjection, remoteConfigRootId, rootId])

  useEffect(() => {
    if (!rootId) return
    setRecentPathHistory((previous) => upsertAddressPathHistory(previous, {
      rootId,
      rootName: rootName || '根目录',
      path: currentPath,
    }))
  }, [currentPath, rootId, rootName])

  useEffect(() => {
    saveAddressPathHistory(storageNamespace, recentPathHistory)
  }, [recentPathHistory, storageNamespace])

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

  useEffect(() => {
    if (!pendingDeleteUndoRestore) {
      return
    }
    if (rootId !== pendingDeleteUndoRestore.snapshot.historyEntry.rootId) {
      return
    }
    if (
      normalizeRelativePath(currentPath)
      !== normalizeRelativePath(pendingDeleteUndoRestore.snapshot.historyEntry.path)
    ) {
      return
    }

    let cancelled = false
    const snapshot = pendingDeleteUndoRestore.snapshot
    setPendingDeleteUndoRestore(null)

    const applyPendingRestore = async () => {
      try {
        await applyDeleteUndoSnapshot(snapshot)
      } catch (error) {
        if (!cancelled) {
          showDeleteUndoNoticeMessage(
            error instanceof Error ? error.message : '恢复删除前状态失败',
            'error'
          )
        }
      } finally {
        if (!cancelled) {
          setIsUndoingDelete(false)
        }
      }
    }

    void applyPendingRestore()
    return () => {
      cancelled = true
    }
  }, [
    applyDeleteUndoSnapshot,
    currentPath,
    pendingDeleteUndoRestore,
    rootId,
    showDeleteUndoNoticeMessage,
  ])

  useEffect(() => {
    setDirectorySelectedPaths([])
    setDirectoryFocusedPath(null)
  }, [currentPath])

  useEffect(() => {
    setProjectionTabs([])
    setActiveProjectionTabId(null)
    setActiveSurface({ kind: 'directory' })
    setProjectionSelectedPathsById({})
    setDuplicateSelectionRuleByProjectionId({})
    setProjectionFocusedPathById({})
    setDirectorySelectedPaths([])
    setDirectoryFocusedPath(null)
    setIsResultPanelOpen(false)
  }, [rootId])

  useEffect(() => {
    if (resultPanelDisplayMode === 'normal') {
      lastNormalResultPanelHeightRef.current = resultPanelHeightPx
    }
  }, [resultPanelDisplayMode, resultPanelHeightPx])

  useEffect(() => {
    if (resultPanelDisplayMode !== 'normal') return

    const handleResize = () => {
      setResultPanelHeightPx((previous) => clampResultPanelHeightPx(previous))
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [resultPanelDisplayMode])

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
    alignPreviewToPath(directoryFocusedPath)
  }, [activeSurface, alignPreviewToPath, directoryFocusedPath, projectionTabs])

  useEffect(() => {
    void Promise.all([
      preloadAnnotationDisplaySnapshot({
        rootId,
        rootHandle,
        rootLabel: rootName,
      }),
      preloadReviewFilterTagSnapshot({
        rootId,
        rootHandle,
      }),
    ])
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
    const timeoutId = window.setTimeout(() => {
      preloadPreviewModules()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (selectedFile?.kind !== 'file') return
    if (activeSurface.kind === 'projection') {
      const activeProjection = projectionTabs.find((projection) => projection.id === activeSurface.tabId) ?? null
      if (!activeProjection || !activeProjection.files.some((file) => file.path === selectedFile.path)) {
        return
      }
      setProjectionFocusedPathById((previous) => (
        previous[activeSurface.tabId] === selectedFile.path
          ? previous
          : {
            ...previous,
            [activeSurface.tabId]: selectedFile.path,
          }
      ))
      return
    }
    setDirectoryFocusedPath((previous) => (previous === selectedFile.path ? previous : selectedFile.path))
  }, [activeSurface, projectionTabs, selectedFile])

  useEffect(() => {
    const activeGridRef = activeSurface.kind === 'projection' ? projectionFileGridRef : directoryFileGridRef
    activeGridRef.current?.syncSelectedPath(selectedFile?.path ?? null, {
      scroll: true,
      focus: false,
    })
  }, [activeSurface, selectedFile])

  useEffect(() => {
    if (!hasActiveVideoPreview) return
    applyVideoPlaybackRateToActivePreviewVideo(videoPlaybackRate)
  }, [applyVideoPlaybackRateToActivePreviewVideo, hasActiveVideoPreview, videoPlaybackRate])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const isTyping = isTypingTarget(event.target)

      if (matchesAnyShortcut(event, keyboardShortcuts.app.openDirectory)) {
        event.preventDefault()
        void selectDirectory()
        return
      }

      if (isTyping) return
      if (matchesAnyShortcut(event, keyboardShortcuts.app.undoDelete)) {
        event.preventDefault()
        void handleUndoDelete()
        return
      }
      const matchedPreviewTagShortcut = getMatchingPreviewTagShortcut(event)

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.toggleVideoPlayPause)) {
        event.preventDefault()
        if (event.repeat) return
        toggleActivePreviewVideoPlayback()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.seekBackward)) {
        event.preventDefault()
        seekActivePreviewVideo('backward')
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.seekForward)) {
        event.preventDefault()
        seekActivePreviewVideo('forward')
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.cycleVideoPlaybackRate)) {
        event.preventDefault()
        if (event.repeat) return
        cycleVideoPlaybackRate()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveMediaPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.toggleAutoPlay)) {
        event.preventDefault()
        toggleAutoPlay()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveMediaPreview) {
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.togglePlaybackOrder)) {
          event.preventDefault()
          togglePlaybackOrder()
          return
        }
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.prev)) {
          event.preventDefault()
          if (previewFile) {
            navigateMediaFromModal('prev')
          } else {
            navigateMediaFromPane('prev')
          }
          return
        }
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.next)) {
          event.preventDefault()
          if (previewFile) {
            navigateMediaFromModal('next')
          } else {
            navigateMediaFromPane('next')
          }
          return
        }
      }

      if (matchesAnyShortcut(event, keyboardShortcuts.app.navigateUp) && currentPath) {
        event.preventDefault()
        void navigateUp()
        return
      }

      if (!matchedPreviewTagShortcut && matchesAnyShortcut(event, keyboardShortcuts.preview.close)) {
        if (previewFile) {
          event.preventDefault()
          closePreviewModal()
          return
        }
        if (showPreviewPane) {
          event.preventDefault()
          closePreviewPane()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    keyboardShortcuts,
    closePreviewModal,
    closePreviewPane,
    hasActiveMediaPreview,
    hasActiveVideoPreview,
    handleUndoDelete,
    currentPath,
    getMatchingPreviewTagShortcut,
    navigateMediaFromModal,
    navigateMediaFromPane,
    navigateUp,
    previewFile,
    seekActivePreviewVideo,
    selectDirectory,
    showPreviewPane,
    cycleVideoPlaybackRate,
    toggleActivePreviewVideoPlayback,
    toggleAutoPlay,
    togglePlaybackOrder,
  ])

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
