import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { FILE_GRID_CARD_SIZE_BY_PRESET, TARGET_GRID_COLUMNS_AT_512_PRESET, requiredGridWidthForColumns } from '@/features/explorer/constants/gridLayout'
import { usePreviewTraversal } from '@/features/preview/hooks/usePreviewTraversal'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import { ExplorerWorkspaceLayout } from '@/layouts/ExplorerWorkspaceLayout'
import { keyboardShortcuts } from '@/config/shortcuts'
import { getFilePreviewKind, isMediaPreviewKind } from '@/lib/filePreview'
import { getDirectoryItemCount, isImageFile, isVideoFile } from '@/lib/fileSystem'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import {
  getAnnotationDisplayStoreVersion,
  getFileAnnotationUpdatedAt,
  getFileAnnotationTagKeys,
  getRootAnnotationFilterTagOptions,
  isAnnotationFilterUiVisible,
  preloadAnnotationDisplaySnapshot,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'
import {
  ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
  type AddressPathHistoryEntry,
  type AnnotationFilterTagOption,
  type FavoriteFolderEntry,
  type FileItem,
  type FilterState,
  type ThumbnailSizePreset,
} from '@/types'
import type { GatewayCapabilitiesSnapshot, GatewayToolDescriptor } from '@/lib/gateway'

const MIN_PANE_WIDTH_RATIO = 0.15
const MAX_PANE_WIDTH_RATIO = 0.75
const DEFAULT_PANE_WIDTH_RATIO = 0.375
const PREVIEW_PANE_WIDTH_RATIO_STORAGE_KEY = 'fauplay:preview-pane-width-ratio'
const ADDRESS_PATH_HISTORY_STORAGE_KEY = 'fauplay:address-path-history'
const MAX_ADDRESS_PATH_HISTORY_ITEMS = 20
const GATEWAY_CAPABILITY_REFRESH_INTERVAL_MS = 15000
const TRASH_RELATIVE_PATH = '.trash'

let previewPanelModulesPreloaded = false

interface WorkspaceShellProps {
  rootHandle: FileSystemDirectoryHandle
  rootId: string
  favoriteFolders: FavoriteFolderEntry[]
  isCurrentPathFavorited: boolean
  files: FileItem[]
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
  setFlattenView: (flattenView: boolean) => Promise<void>
  filterFiles: (files: FileItem[], filter: FilterState) => FileItem[]
}

const defaultFilter: FilterState = {
  search: '',
  type: 'all',
  hideEmptyFolders: true,
  sortBy: 'name',
  sortOrder: 'asc',
  annotationFilterMode: 'all',
  annotationIncludeMatchMode: 'or',
  annotationIncludeTagKeys: [],
  annotationExcludeTagKeys: [],
}

interface PersistedPreviewPaneWidthState {
  ratio: number
  isManual: boolean
}

function clampPaneWidthRatio(value: number): number {
  return Math.min(MAX_PANE_WIDTH_RATIO, Math.max(MIN_PANE_WIDTH_RATIO, value))
}

function loadPersistedPreviewPaneWidthState(): PersistedPreviewPaneWidthState {
  if (typeof window === 'undefined') {
    return {
      ratio: DEFAULT_PANE_WIDTH_RATIO,
      isManual: false,
    }
  }

  try {
    const raw = window.localStorage.getItem(PREVIEW_PANE_WIDTH_RATIO_STORAGE_KEY)
    if (raw === null) {
      return {
        ratio: DEFAULT_PANE_WIDTH_RATIO,
        isManual: false,
      }
    }

    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      return {
        ratio: DEFAULT_PANE_WIDTH_RATIO,
        isManual: false,
      }
    }

    return {
      ratio: clampPaneWidthRatio(parsed),
      isManual: true,
    }
  } catch {
    return {
      ratio: DEFAULT_PANE_WIDTH_RATIO,
      isManual: false,
    }
  }
}

function savePersistedPreviewPaneWidthRatio(value: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PREVIEW_PANE_WIDTH_RATIO_STORAGE_KEY, String(clampPaneWidthRatio(value)))
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function isAnnotationFilterAtDefault(filter: FilterState): boolean {
  return (
    filter.annotationFilterMode === 'all'
    && filter.annotationIncludeMatchMode === 'or'
    && filter.annotationIncludeTagKeys.length === 0
    && filter.annotationExcludeTagKeys.length === 0
  )
}

function isAnnotationBooleanFilterActive(filter: FilterState): boolean {
  return filter.annotationIncludeTagKeys.length > 0 || filter.annotationExcludeTagKeys.length > 0
}

function withSyncedAnnotationFilterMode(filter: FilterState): FilterState {
  const nextMode: FilterState['annotationFilterMode'] = isAnnotationBooleanFilterActive(filter) ? 'boolean' : 'all'
  if (filter.annotationFilterMode === nextMode) {
    return filter
  }
  return {
    ...filter,
    annotationFilterMode: nextMode,
  }
}

function fileMatchesAnnotationTag(tagSet: Set<string>, tagKey: string): boolean {
  if (tagKey === ANNOTATION_FILTER_UNANNOTATED_TAG_KEY) {
    return tagSet.size === 0
  }
  return tagSet.has(tagKey)
}

function matchesBooleanAnnotationFilter(filter: FilterState, fileTagKeys: string[]): boolean {
  const includeTagKeys = filter.annotationIncludeTagKeys
  const excludeTagKeys = filter.annotationExcludeTagKeys
  if (includeTagKeys.length === 0 && excludeTagKeys.length === 0) {
    return true
  }

  const tagSet = new Set(fileTagKeys)
  const includeMatched = includeTagKeys.length === 0
    ? true
    : filter.annotationIncludeMatchMode === 'and'
      ? includeTagKeys.every((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))
      : includeTagKeys.some((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))

  if (!includeMatched) return false

  return !excludeTagKeys.some((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))
}

function compareByNameWithSortOrder(left: FileItem, right: FileItem, sortOrder: FilterState['sortOrder']): number {
  const cmp = left.name.localeCompare(right.name)
  return sortOrder === 'asc' ? cmp : -cmp
}

function sortFilesByAnnotationTime(
  files: FileItem[],
  rootId: string,
  sortOrder: FilterState['sortOrder']
): FileItem[] {
  const next = [...files]
  next.sort((left, right) => {
    if (left.kind === 'directory' && right.kind === 'file') return -1
    if (left.kind === 'file' && right.kind === 'directory') return 1
    if (left.kind === 'directory' && right.kind === 'directory') {
      return compareByNameWithSortOrder(left, right, sortOrder)
    }

    const leftUpdatedAt = getFileAnnotationUpdatedAt(rootId, left.path)
    const rightUpdatedAt = getFileAnnotationUpdatedAt(rootId, right.path)
    const leftAnnotated = leftUpdatedAt !== null
    const rightAnnotated = rightUpdatedAt !== null

    // Unannotated items always stay at the bottom regardless of sort order.
    if (leftAnnotated !== rightAnnotated) {
      return leftAnnotated ? -1 : 1
    }
    if (!leftAnnotated && !rightAnnotated) {
      return compareByNameWithSortOrder(left, right, sortOrder)
    }

    if (leftUpdatedAt !== rightUpdatedAt) {
      const cmp = (leftUpdatedAt ?? 0) - (rightUpdatedAt ?? 0)
      return sortOrder === 'asc' ? cmp : -cmp
    }
    return compareByNameWithSortOrder(left, right, sortOrder)
  })
  return next
}

function dedupeAddressPathHistory(entries: AddressPathHistoryEntry[]): AddressPathHistoryEntry[] {
  const latestEntryByKey = new Map<string, AddressPathHistoryEntry>()

  for (const item of entries) {
    if (!item.rootId) continue
    const normalizedPath = normalizeRelativePath(item.path)
    const visitedAt = Number.isFinite(item.visitedAt) ? item.visitedAt : 0
    const key = `${item.rootId}:${normalizedPath}`
    const existing = latestEntryByKey.get(key)
    if (!existing || visitedAt > existing.visitedAt) {
      latestEntryByKey.set(key, {
        rootId: item.rootId,
        rootName: item.rootName || '根目录',
        path: normalizedPath,
        visitedAt,
      })
    }
  }

  return [...latestEntryByKey.values()]
    .sort((left, right) => right.visitedAt - left.visitedAt)
    .slice(0, MAX_ADDRESS_PATH_HISTORY_ITEMS)
}

interface ParsedAddressPathHistory {
  entries: AddressPathHistoryEntry[]
  shouldRewrite: boolean
}

function parseAddressPathHistory(raw: string | null): ParsedAddressPathHistory {
  if (!raw) return { entries: [], shouldRewrite: false }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return { entries: [], shouldRewrite: true }

    let hasLegacyEntry = false
    let hasInvalidEntry = false

    const validEntries = parsed
      .filter((item): item is AddressPathHistoryEntry => {
        if (!item || typeof item !== 'object') {
          hasInvalidEntry = true
          return false
        }

        const candidate = item as Partial<AddressPathHistoryEntry>
        const hasPathShape = typeof candidate.path === 'string' && typeof candidate.visitedAt === 'number'
        if (!hasPathShape) {
          hasInvalidEntry = true
          return false
        }

        if (typeof candidate.rootId !== 'string' || typeof candidate.rootName !== 'string') {
          hasLegacyEntry = true
          return false
        }

        return true
      })

    const dedupedEntries = dedupeAddressPathHistory(validEntries)
    const shouldRewrite = hasLegacyEntry || hasInvalidEntry || dedupedEntries.length !== validEntries.length
    if (hasLegacyEntry) {
      return { entries: [], shouldRewrite: true }
    }

    return { entries: dedupedEntries, shouldRewrite }
  } catch {
    return { entries: [], shouldRewrite: true }
  }
}

function loadAddressPathHistory(): AddressPathHistoryEntry[] {
  if (typeof window === 'undefined') return []
  const parsed = parseAddressPathHistory(window.localStorage.getItem(ADDRESS_PATH_HISTORY_STORAGE_KEY))
  if (parsed.shouldRewrite) {
    saveAddressPathHistory(parsed.entries)
  }
  return parsed.entries
}

function saveAddressPathHistory(history: AddressPathHistoryEntry[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ADDRESS_PATH_HISTORY_STORAGE_KEY, JSON.stringify(history))
}

function upsertAddressPathHistory(
  previous: AddressPathHistoryEntry[],
  nextEntry: Pick<AddressPathHistoryEntry, 'rootId' | 'rootName' | 'path'>
): AddressPathHistoryEntry[] {
  const normalizedPath = normalizeRelativePath(nextEntry.path)
  const now = Date.now()
  return dedupeAddressPathHistory([{
    rootId: nextEntry.rootId,
    rootName: nextEntry.rootName,
    path: normalizedPath,
    visitedAt: now,
  }, ...previous])
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
  rootHandle,
  rootId,
  favoriteFolders,
  isCurrentPathFavorited,
  files,
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
  setFlattenView,
  filterFiles,
}: WorkspaceShellProps) {
  const annotationDisplayStoreVersion = useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )
  const initialPreviewPaneWidthStateRef = useRef<PersistedPreviewPaneWidthState>(loadPersistedPreviewPaneWidthState())
  const [filter, setFilter] = useState<FilterState>(defaultFilter)
  const [thumbnailSizePreset, setThumbnailSizePreset] = useState<ThumbnailSizePreset>('auto')
  const [paneWidthRatio, setPaneWidthRatio] = useState(initialPreviewPaneWidthStateRef.current.ratio)
  const [gridSelectedPaths, setGridSelectedPaths] = useState<string[]>([])
  const [recentPathHistory, setRecentPathHistory] = useState<AddressPathHistoryEntry[]>(() => loadAddressPathHistory())
  const [pluginTools, setPluginTools] = useState<GatewayToolDescriptor[]>([])
  const [hasTrashEntries, setHasTrashEntries] = useState(false)
  const [showPeoplePanel, setShowPeoplePanel] = useState(false)
  const [peoplePanelPreferredPersonId, setPeoplePanelPreferredPersonId] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const isPaneWidthManualRef = useRef(initialPreviewPaneWidthStateRef.current.isManual)
  const fileGridRef = useRef<FileBrowserGridHandle>(null)
  const handleFilterChange = useCallback((nextFilter: FilterState) => {
    setFilter(withSyncedAnnotationFilterMode(nextFilter))
  }, [])
  const showAnnotationFilterControls = isAnnotationFilterUiVisible(rootId)
  const annotationFilterTagOptions = useMemo<AnnotationFilterTagOption[]>(() => {
    // Depend on external store version so tag options refresh with latest gateway tag snapshot.
    void annotationDisplayStoreVersion
    if (!showAnnotationFilterControls) return []
    const rootTagOptions = getRootAnnotationFilterTagOptions(rootId)
    return [
      {
        tagKey: ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
        key: '',
        value: '未标注',
        sources: [],
        hasMetaAnnotation: false,
        representativeSource: '',
      },
      ...rootTagOptions,
    ]
  }, [annotationDisplayStoreVersion, rootId, showAnnotationFilterControls])

  const filteredFiles = useMemo(() => {
    // Depend on external store version so file filtering reflects latest gateway tag snapshot.
    void annotationDisplayStoreVersion
    let nextFilteredFiles = filterFiles(files, filter)
    if (isAnnotationBooleanFilterActive(filter)) {
      nextFilteredFiles = nextFilteredFiles.filter((file) => {
        if (file.kind !== 'file') return true
        const fileTagKeys = getFileAnnotationTagKeys(rootId, file.path)
        return matchesBooleanAnnotationFilter(filter, fileTagKeys)
      })
    }

    if (filter.sortBy === 'annotationTime') {
      return sortFilesByAnnotationTime(nextFilteredFiles, rootId, filter.sortOrder)
    }

    return nextFilteredFiles
  }, [annotationDisplayStoreVersion, files, filter, filterFiles, rootId])

  const totalCount = useMemo(() => files.length, [files])
  const imageCount = useMemo(
    () => files.filter((file) => file.kind === 'file' && isImageFile(file.name)).length,
    [files]
  )
  const videoCount = useMemo(
    () => files.filter((file) => file.kind === 'file' && isVideoFile(file.name)).length,
    [files]
  )
  const selectedGridItems = useMemo(() => {
    if (gridSelectedPaths.length === 0) return []
    const selectedPathSet = new Set(gridSelectedPaths)
    return filteredFiles.filter((file) => selectedPathSet.has(file.path))
  }, [filteredFiles, gridSelectedPaths])
  const selectedGridMetaFile = useMemo(() => {
    if (selectedGridItems.length !== 1) return null
    return selectedGridItems[0]?.kind === 'file' ? selectedGridItems[0] : null
  }, [selectedGridItems])
  const filteredFileItems = useMemo(
    () => filteredFiles.filter((file): file is FileItem => file.kind === 'file'),
    [filteredFiles]
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
    handleAutoPlayVideoEnded,
    handleAutoPlayVideoPlaybackError,
    alignPreviewToPath,
  } = usePreviewTraversal({ filteredFiles })
  const hasActiveVideoPreview = useMemo(() => {
    const activePreviewFile = previewFile ?? (showPreviewPane ? selectedFile : null)
    if (!activePreviewFile || activePreviewFile.kind !== 'file') {
      return false
    }
    return getFilePreviewKind(activePreviewFile.name) === 'video'
  }, [previewFile, selectedFile, showPreviewPane])

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

  const handleDirectoryClick = useCallback((dirName: string) => {
    void navigateToDirectory(dirName)
  }, [navigateToDirectory])

  const handleFileClick = useCallback((file: FileItem) => {
    if (file.kind === 'directory') {
      void navigateToDirectory(file.name)
    } else {
      preloadPreviewModules()
      showFileInPane(file)
    }
  }, [navigateToDirectory, showFileInPane])

  const handleFileDoubleClick = useCallback((file: FileItem) => {
    if (file.kind === 'file') {
      openFileInModal(file)
    }
  }, [openFileInModal])

  const handleNavigateToPath = useCallback((path: string) => {
    return navigateToPath(path, { resetFlattenView: true })
  }, [navigateToPath])
  const handleNavigateHistoryEntry = useCallback((entry: AddressPathHistoryEntry) => {
    return openHistoryEntry(entry)
  }, [openHistoryEntry])

  const refreshAnnotationSnapshot = useCallback(async () => {
    if (!rootId) return
    await preloadAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      force: true,
    })
  }, [rootHandle, rootId])

  const handleWorkspaceMutationCommitted = useCallback(async () => {
    await navigateToPath(currentPath)
    await refreshAnnotationSnapshot()
  }, [currentPath, navigateToPath, refreshAnnotationSnapshot])

  const resolveNextFileAfterDelete = useCallback((deletedRelativePath: string): FileItem | null => {
    const normalizedDeletedPath = normalizeRelativePath(deletedRelativePath)
    if (!normalizedDeletedPath || filteredFileItems.length <= 1) return null

    const deletedIndex = filteredFileItems.findIndex((file) => (
      normalizeRelativePath(file.path) === normalizedDeletedPath
    ))
    if (deletedIndex < 0) return null

    const nextIndex = (deletedIndex + 1) % filteredFileItems.length
    const nextFile = filteredFileItems[nextIndex]
    if (!nextFile) return null
    if (normalizeRelativePath(nextFile.path) === normalizedDeletedPath) return null
    return nextFile
  }, [filteredFileItems])

  const handlePreviewMutationCommitted = useCallback(async (params?: PreviewMutationCommitParams) => {
    const preferredPreviewPath = normalizeRelativePath(params?.preferredPreviewPath || '')
    if (preferredPreviewPath) {
      alignPreviewToPath(preferredPreviewPath)
      await navigateToPath(currentPath)
      await refreshAnnotationSnapshot()
      return
    }

    if (params?.mutationToolName === 'fs.softDelete') {
      const deletedRelativePath = normalizeRelativePath(params.deletedRelativePath || '')
      const activePreviewFile = previewFile ?? selectedFile
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
            showFileInPane(nextFile)
          }
        }
      }
    }

    await navigateToPath(currentPath)
    await refreshAnnotationSnapshot()
  }, [
    alignPreviewToPath,
    currentPath,
    navigateMediaFromModal,
    navigateMediaFromPane,
    navigateToPath,
    previewFile,
    refreshAnnotationSnapshot,
    resolveNextFileAfterDelete,
    selectedFile,
    showFileInPane,
  ])

  const handleOpenTrash = useCallback(() => {
    if (!hasTrashEntries) return
    void navigateToPath(TRASH_RELATIVE_PATH, { resetFlattenView: true })
  }, [hasTrashEntries, navigateToPath])

  const canOpenPeople = useMemo(() => (
    pluginTools.some((tool) => tool.name === 'vision.face' && tool.scopes.includes('workspace'))
  ), [pluginTools])

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

  useEffect(() => {
    if (!rootId) return
    setRecentPathHistory((previous) => upsertAddressPathHistory(previous, {
      rootId,
      rootName: rootHandle.name || '根目录',
      path: currentPath,
    }))
  }, [currentPath, rootId, rootHandle.name])

  useEffect(() => {
    saveAddressPathHistory(recentPathHistory)
  }, [recentPathHistory])

  useEffect(() => {
    let disposed = false

    const refreshTrashAvailability = async () => {
      try {
        const itemCount = await getDirectoryItemCount(rootHandle, TRASH_RELATIVE_PATH, 1)
        if (!disposed) {
          setHasTrashEntries(itemCount > 0)
        }
      } catch {
        if (!disposed) {
          setHasTrashEntries(false)
        }
      }
    }

    void refreshTrashAvailability()
    return () => {
      disposed = true
    }
  }, [files, rootHandle])

  useEffect(() => {
    void preloadAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
    })
  }, [rootHandle, rootId])

  useEffect(() => {
    if (showAnnotationFilterControls) return
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
  }, [showAnnotationFilterControls])

  useEffect(() => {
    let disposed = false
    let refreshTimerId: number | null = null
    let loadSnapshot: (() => Promise<GatewayCapabilitiesSnapshot>) | null = null

    const refreshCapabilities = async () => {
      try {
        if (!loadSnapshot) {
          const module = await import('@/lib/gateway')
          loadSnapshot = module.loadGatewayCapabilities
        }
        const snapshot = await loadSnapshot()
        if (disposed) return
        setPluginTools(snapshot.online ? snapshot.tools : [])
      } catch {
        if (!disposed) {
          setPluginTools([])
        }
      }
    }

    void refreshCapabilities()
    refreshTimerId = window.setInterval(() => {
      void refreshCapabilities()
    }, GATEWAY_CAPABILITY_REFRESH_INTERVAL_MS)

    return () => {
      disposed = true
      if (refreshTimerId !== null) {
        window.clearInterval(refreshTimerId)
      }
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      preloadPreviewModules()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    fileGridRef.current?.syncSelectedPath(selectedFile?.path ?? null, {
      scroll: true,
      focus: false,
    })
  }, [selectedFile])

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

      if (hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.toggleVideoPlayPause)) {
        event.preventDefault()
        if (event.repeat) return
        toggleActivePreviewVideoPlayback()
        return
      }

      if (hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.seekBackward)) {
        event.preventDefault()
        seekActivePreviewVideo('backward')
        return
      }

      if (hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.seekForward)) {
        event.preventDefault()
        seekActivePreviewVideo('forward')
        return
      }

      if (hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.cycleVideoPlaybackRate)) {
        event.preventDefault()
        if (event.repeat) return
        cycleVideoPlaybackRate()
        return
      }

      if (hasActiveMediaPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.toggleAutoPlay)) {
        event.preventDefault()
        toggleAutoPlay()
        return
      }

      if (hasActiveMediaPreview) {
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

      if (matchesAnyShortcut(event, keyboardShortcuts.preview.close)) {
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
    closePreviewModal,
    closePreviewPane,
    hasActiveMediaPreview,
    hasActiveVideoPreview,
    currentPath,
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

  const getAdaptiveDefaultPaneWidthRatio = useCallback((containerWidth: number) => {
    if (containerWidth <= 0 || thumbnailSizePreset !== '512') {
      return DEFAULT_PANE_WIDTH_RATIO
    }

    const requiredGridWidth = requiredGridWidthForColumns(
      TARGET_GRID_COLUMNS_AT_512_PRESET,
      FILE_GRID_CARD_SIZE_BY_PRESET['512'].width
    )
    const maxPaneRatioForThreeColumns = 1 - requiredGridWidth / containerWidth
    const adaptiveRatio = Math.min(DEFAULT_PANE_WIDTH_RATIO, maxPaneRatioForThreeColumns)

    return Math.min(MAX_PANE_WIDTH_RATIO, Math.max(MIN_PANE_WIDTH_RATIO, adaptiveRatio))
  }, [thumbnailSizePreset])

  useEffect(() => {
    if (!showPreviewPane || isPaneWidthManualRef.current) return

    const applyAdaptiveDefault = () => {
      const containerWidth = contentRef.current?.parentElement?.offsetWidth ?? window.innerWidth
      const nextRatio = getAdaptiveDefaultPaneWidthRatio(containerWidth)
      setPaneWidthRatio((currentRatio) => {
        if (Math.abs(currentRatio - nextRatio) < 0.001) {
          return currentRatio
        }
        return nextRatio
      })
    }

    applyAdaptiveDefault()
    window.addEventListener('resize', applyAdaptiveDefault)
    return () => window.removeEventListener('resize', applyAdaptiveDefault)
  }, [showPreviewPane, getAdaptiveDefaultPaneWidthRatio])

  useEffect(() => {
    if (!isPaneWidthManualRef.current) return
    savePersistedPreviewPaneWidthRatio(paneWidthRatio)
  }, [paneWidthRatio])

  const handlePreviewPaneResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    isPaneWidthManualRef.current = true
    const startX = event.clientX
    const startRatio = paneWidthRatio

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const containerWidth = contentRef.current?.parentElement?.offsetWidth || window.innerWidth
      const delta = (startX - moveEvent.clientX) / containerWidth
      const newRatio = startRatio + delta
      setPaneWidthRatio(clampPaneWidthRatio(newRatio))
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [paneWidthRatio])

  return (
    <ExplorerWorkspaceLayout
      filter={filter}
      onFilterChange={handleFilterChange}
      rootName={rootHandle.name}
      currentPath={currentPath}
      rootId={rootId}
      onNavigateToPath={handleNavigateToPath}
      onNavigateHistoryEntry={handleNavigateHistoryEntry}
      onListChildDirectories={listChildDirectories}
      recentPathHistory={recentPathHistory}
      onNavigateUp={navigateUp}
      isFlattenView={isFlattenView}
      onToggleFlattenView={() => {
        void setFlattenView(!isFlattenView)
      }}
      totalCount={totalCount}
      imageCount={imageCount}
      videoCount={videoCount}
      showAnnotationFilterControls={showAnnotationFilterControls}
      annotationFilterTagOptions={annotationFilterTagOptions}
      thumbnailSizePreset={thumbnailSizePreset}
      onThumbnailSizePresetChange={setThumbnailSizePreset}
      canOpenTrash={hasTrashEntries}
      onOpenTrash={handleOpenTrash}
      canOpenPeople={canOpenPeople}
      onOpenPeople={handleOpenPeople}
      onOpenPeopleForPerson={handleOpenPeopleForPerson}
      showPeoplePanel={showPeoplePanel}
      peoplePanelPreferredPersonId={peoplePanelPreferredPersonId}
      onClosePeoplePanel={handleClosePeople}
      error={error}
      isLoading={isLoading}
      favoriteFolders={favoriteFolders}
      isCurrentPathFavorited={isCurrentPathFavorited}
      onOpenFavoriteFolder={openFavoriteFolder}
      onRemoveFavoriteFolder={removeFavoriteFolder}
      onToggleCurrentPathFavorite={toggleCurrentFolderFavorite}
      files={filteredFiles}
      rootHandle={rootHandle}
      fileGridRef={fileGridRef}
      onFileClick={handleFileClick}
      onFileDoubleClick={handleFileDoubleClick}
      onDirectoryClick={handleDirectoryClick}
      onGridSelectionChange={setGridSelectedPaths}
      gridSelectedPaths={gridSelectedPaths}
      onWorkspaceMutationCommitted={handleWorkspaceMutationCommitted}
      onPreviewMutationCommitted={handlePreviewMutationCommitted}
      showPreviewPane={showPreviewPane}
      hasOpenPreview={hasOpenPreview}
      contentRef={contentRef}
      paneWidthRatio={paneWidthRatio}
      onPreviewPaneResizeStart={handlePreviewPaneResizeStart}
      selectedFile={selectedFile}
      gridSelectedCount={selectedGridItems.length}
      selectedGridMetaFile={selectedGridMetaFile}
      pluginTools={pluginTools}
      onClosePane={closePreviewPane}
      onOpenFullscreenFromPane={openFullscreenFromPane}
      autoPlayEnabled={autoPlayEnabled}
      autoPlayIntervalSec={autoPlayIntervalSec}
      videoSeekStepSec={videoSeekStepSec}
      videoPlaybackRate={videoPlaybackRate}
      faceBboxVisible={faceBboxVisible}
      onToggleAutoPlay={toggleAutoPlay}
      playbackOrder={playbackOrder}
      onTogglePlaybackOrder={togglePlaybackOrder}
      onToggleFaceBboxVisible={toggleFaceBboxVisible}
      onAutoPlayIntervalChange={setAutoPlayInterval}
      onVideoSeekStepChange={setVideoSeekStep}
      onVideoPlaybackRateChange={setVideoPlaybackRate}
      onVideoEnded={handleAutoPlayVideoEnded}
      onVideoPlaybackError={handleAutoPlayVideoPlaybackError}
      previewFile={previewFile}
      previewAutoPlayOnOpen={previewAutoPlayOnOpen}
      onClosePreview={closePreviewModal}
    />
  )
}
