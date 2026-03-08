import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { FILE_GRID_CARD_SIZE_BY_PRESET, TARGET_GRID_COLUMNS_AT_512_PRESET, requiredGridWidthForColumns } from '@/features/explorer/constants/gridLayout'
import { usePreviewTraversal } from '@/features/preview/hooks/usePreviewTraversal'
import { ExplorerWorkspaceLayout } from '@/layouts/ExplorerWorkspaceLayout'
import { keyboardShortcuts } from '@/config/shortcuts'
import { isImageFile, isVideoFile } from '@/lib/fileSystem'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import type { AddressPathHistoryEntry, FileItem, FilterState, ThumbnailSizePreset } from '@/types'
import type { GatewayCapabilitiesSnapshot, GatewayToolDescriptor } from '@/lib/gateway'

const MIN_PANE_WIDTH_RATIO = 0.15
const MAX_PANE_WIDTH_RATIO = 0.75
const DEFAULT_PANE_WIDTH_RATIO = 0.375
const ADDRESS_PATH_HISTORY_STORAGE_KEY = 'fauplay:address-path-history'
const MAX_ADDRESS_PATH_HISTORY_ITEMS = 20
const GATEWAY_CAPABILITY_REFRESH_INTERVAL_MS = 15000

let previewPanelModulesPreloaded = false

interface WorkspaceShellProps {
  rootHandle: FileSystemDirectoryHandle
  files: FileItem[]
  currentPath: string
  isFlattenView: boolean
  isLoading: boolean
  error: string | null
  selectDirectory: () => Promise<void>
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
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function dedupeAddressPathHistory(entries: AddressPathHistoryEntry[]): AddressPathHistoryEntry[] {
  const latestEntryByPath = new Map<string, AddressPathHistoryEntry>()

  for (const item of entries) {
    const normalizedPath = normalizeRelativePath(item.path)
    const visitedAt = Number.isFinite(item.visitedAt) ? item.visitedAt : 0
    const existing = latestEntryByPath.get(normalizedPath)
    if (!existing || visitedAt > existing.visitedAt) {
      latestEntryByPath.set(normalizedPath, { path: normalizedPath, visitedAt })
    }
  }

  return [...latestEntryByPath.values()]
    .sort((left, right) => right.visitedAt - left.visitedAt)
    .slice(0, MAX_ADDRESS_PATH_HISTORY_ITEMS)
}

function parseAddressPathHistory(raw: string | null): AddressPathHistoryEntry[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const validEntries = parsed
      .filter((item): item is AddressPathHistoryEntry => {
        return Boolean(
          item &&
          typeof item === 'object' &&
          typeof (item as AddressPathHistoryEntry).path === 'string' &&
          typeof (item as AddressPathHistoryEntry).visitedAt === 'number'
        )
      })

    return dedupeAddressPathHistory(validEntries)
  } catch {
    return []
  }
}

function loadAddressPathHistory(): AddressPathHistoryEntry[] {
  if (typeof window === 'undefined') return []
  return parseAddressPathHistory(window.localStorage.getItem(ADDRESS_PATH_HISTORY_STORAGE_KEY))
}

function saveAddressPathHistory(history: AddressPathHistoryEntry[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ADDRESS_PATH_HISTORY_STORAGE_KEY, JSON.stringify(history))
}

function upsertAddressPathHistory(
  previous: AddressPathHistoryEntry[],
  nextPath: string
): AddressPathHistoryEntry[] {
  const normalizedPath = normalizeRelativePath(nextPath)
  const now = Date.now()
  return dedupeAddressPathHistory([{ path: normalizedPath, visitedAt: now }, ...previous])
}

function preloadPreviewModules(): void {
  if (previewPanelModulesPreloaded) return
  previewPanelModulesPreloaded = true

  const preloaders = [
    () => import('@/features/preview/components/MediaPreviewPanel'),
    () => import('@/features/preview/components/MediaPreviewCanvas'),
    () => import('@/features/preview/components/PreviewHeaderBar'),
    () => import('@/features/preview/components/PreviewControlGroup'),
    () => import('@/features/preview/components/PreviewTitleRow'),
    () => import('@/features/preview/components/MediaPlaybackControls'),
    () => import('@/features/preview/components/PreviewMediaViewport'),
    () => import('@/features/preview/components/PreviewFeedbackOverlay'),
  ]

  for (const load of preloaders) {
    void load().catch(() => {})
  }
}

export function WorkspaceShell({
  rootHandle,
  files,
  currentPath,
  isFlattenView,
  isLoading,
  error,
  selectDirectory,
  navigateToPath,
  navigateToDirectory,
  navigateUp,
  listChildDirectories,
  setFlattenView,
  filterFiles,
}: WorkspaceShellProps) {
  const [filter, setFilter] = useState<FilterState>(defaultFilter)
  const [thumbnailSizePreset, setThumbnailSizePreset] = useState<ThumbnailSizePreset>('auto')
  const [paneWidthRatio, setPaneWidthRatio] = useState(DEFAULT_PANE_WIDTH_RATIO)
  const [gridSelectedPaths, setGridSelectedPaths] = useState<string[]>([])
  const [recentPathHistory, setRecentPathHistory] = useState<AddressPathHistoryEntry[]>(() => loadAddressPathHistory())
  const [pluginTools, setPluginTools] = useState<GatewayToolDescriptor[]>([])
  const contentRef = useRef<HTMLDivElement>(null)
  const isPaneWidthManualRef = useRef(false)
  const fileGridRef = useRef<FileBrowserGridHandle>(null)

  const filteredFiles = useMemo(() => {
    return filterFiles(files, filter)
  }, [files, filter, filterFiles])

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

  const {
    selectedFile,
    previewFile,
    showPreviewPane,
    previewAutoPlayOnOpen,
    autoPlayEnabled,
    autoPlayIntervalSec,
    playbackOrder,
    hasOpenPreview,
    showFileInPane,
    openFileInModal,
    closePreviewModal,
    closePreviewPane,
    openFullscreenFromPane,
    toggleAutoPlay,
    togglePlaybackOrder,
    setAutoPlayInterval,
    navigateMediaFromPane,
    navigateMediaFromModal,
    handleAutoPlayVideoEnded,
    handleAutoPlayVideoPlaybackError,
  } = usePreviewTraversal({ filteredFiles })

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

  const handleWorkspaceMutationCommitted = useCallback(async () => {
    await navigateToPath(currentPath)
  }, [currentPath, navigateToPath])

  useEffect(() => {
    setRecentPathHistory((previous) => upsertAddressPathHistory(previous, currentPath))
  }, [currentPath])

  useEffect(() => {
    saveAddressPathHistory(recentPathHistory)
  }, [recentPathHistory])

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const isTyping = isTypingTarget(event.target)

      if (matchesAnyShortcut(event, keyboardShortcuts.app.openDirectory)) {
        event.preventDefault()
        void selectDirectory()
        return
      }

      if (isTyping) return

      if (matchesAnyShortcut(event, keyboardShortcuts.preview.toggleAutoPlay)) {
        event.preventDefault()
        toggleAutoPlay()
        return
      }

      if (hasOpenPreview) {
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
    currentPath,
    hasOpenPreview,
    navigateMediaFromModal,
    navigateMediaFromPane,
    navigateUp,
    previewFile,
    selectDirectory,
    showPreviewPane,
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

  const handlePreviewPaneResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    isPaneWidthManualRef.current = true
    const startX = event.clientX
    const startRatio = paneWidthRatio

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const containerWidth = contentRef.current?.parentElement?.offsetWidth || window.innerWidth
      const delta = (startX - moveEvent.clientX) / containerWidth
      const newRatio = startRatio + delta
      setPaneWidthRatio(Math.min(MAX_PANE_WIDTH_RATIO, Math.max(MIN_PANE_WIDTH_RATIO, newRatio)))
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
      onFilterChange={setFilter}
      rootName={rootHandle.name}
      currentPath={currentPath}
      onNavigateToPath={handleNavigateToPath}
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
      thumbnailSizePreset={thumbnailSizePreset}
      onThumbnailSizePresetChange={setThumbnailSizePreset}
      error={error}
      isLoading={isLoading}
      files={filteredFiles}
      rootHandle={rootHandle}
      fileGridRef={fileGridRef}
      onFileClick={handleFileClick}
      onFileDoubleClick={handleFileDoubleClick}
      onDirectoryClick={handleDirectoryClick}
      onGridSelectionChange={setGridSelectedPaths}
      gridSelectedPaths={gridSelectedPaths}
      onWorkspaceMutationCommitted={handleWorkspaceMutationCommitted}
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
      onToggleAutoPlay={toggleAutoPlay}
      playbackOrder={playbackOrder}
      onTogglePlaybackOrder={togglePlaybackOrder}
      onAutoPlayIntervalChange={setAutoPlayInterval}
      onVideoEnded={handleAutoPlayVideoEnded}
      onVideoPlaybackError={handleAutoPlayVideoPlaybackError}
      previewFile={previewFile}
      previewAutoPlayOnOpen={previewAutoPlayOnOpen}
      onClosePreview={closePreviewModal}
    />
  )
}
