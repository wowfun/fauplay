import type { MouseEvent as ReactMouseEvent } from 'react'
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useFileSystem } from '@/hooks/useFileSystem'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { isImageFile, isVideoFile } from '@/lib/fileSystem'
import type { FileItem, FilterState, ThumbnailSizePreset } from '@/types'
import { keyboardShortcuts } from '@/config/shortcuts'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import { useGatewayCapabilities } from '@/hooks/useGatewayCapabilities'
import { DirectorySelectionLayout } from '@/layouts/DirectorySelectionLayout'
import { ExplorerWorkspaceLayout } from '@/layouts/ExplorerWorkspaceLayout'
import { usePreviewTraversal } from '@/features/preview/hooks/usePreviewTraversal'
import {
  FILE_GRID_CARD_SIZE_BY_PRESET,
  TARGET_GRID_COLUMNS_AT_512_PRESET,
  requiredGridWidthForColumns,
} from '@/features/explorer/constants/gridLayout'

const MIN_PANE_WIDTH_RATIO = 0.15
const MAX_PANE_WIDTH_RATIO = 0.75
const DEFAULT_PANE_WIDTH_RATIO = 0.375

const defaultFilter: FilterState = {
  search: '',
  type: 'all',
  hideEmptyFolders: true,
  sortBy: 'name',
  sortOrder: 'asc',
}

function App() {
  const {
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
    setFlattenView,
    filterFiles,
  } = useFileSystem()

  const [filter, setFilter] = useState<FilterState>(defaultFilter)
  const [thumbnailSizePreset, setThumbnailSizePreset] = useState<ThumbnailSizePreset>('auto')
  const [paneWidthRatio, setPaneWidthRatio] = useState(DEFAULT_PANE_WIDTH_RATIO)
  const contentRef = useRef<HTMLDivElement>(null)
  const isPaneWidthManualRef = useRef(false)
  const fileGridRef = useRef<FileBrowserGridHandle>(null)
  const { tools: previewActionTools } = useGatewayCapabilities()

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
    navigateToDirectory(dirName)
  }, [navigateToDirectory])

  const handleFileClick = useCallback((file: FileItem) => {
    if (file.kind === 'directory') {
      navigateToDirectory(file.name)
    } else {
      showFileInPane(file)
    }
  }, [navigateToDirectory, showFileInPane])

  const handleFileDoubleClick = useCallback((file: FileItem) => {
    if (file.kind === 'file') {
      openFileInModal(file)
    }
  }, [openFileInModal])

  const handleNavigateToPath = useCallback((path: string) => {
    void navigateToPath(path, { resetFlattenView: true })
  }, [navigateToPath])

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

      // Ctrl/Cmd + O: open folder picker
      if (matchesAnyShortcut(event, keyboardShortcuts.app.openDirectory)) {
        event.preventDefault()
        void selectDirectory()
        return
      }

      // Ignore most global shortcuts while user is typing
      if (isTyping) return

      // P: toggle preview autoplay
      if (matchesAnyShortcut(event, keyboardShortcuts.preview.toggleAutoPlay)) {
        event.preventDefault()
        toggleAutoPlay()
        return
      }

      // Preview traversal hotkeys only work while preview is open.
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

      // Backspace: navigate up one level
      if (matchesAnyShortcut(event, keyboardShortcuts.app.navigateUp) && currentPath) {
        event.preventDefault()
        void navigateUp()
        return
      }

      // Escape: close modal first, then side preview pane
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
    selectDirectory,
    navigateUp,
    currentPath,
    hasOpenPreview,
    previewFile,
    showPreviewPane,
    navigateMediaFromModal,
    navigateMediaFromPane,
    togglePlaybackOrder,
    closePreviewModal,
    closePreviewPane,
    toggleAutoPlay,
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

  if (!rootHandle) {
    return <DirectorySelectionLayout isLoading={isLoading} error={error} onSelectDirectory={selectDirectory} />
  }

  return (
    <ExplorerWorkspaceLayout
      filter={filter}
      onFilterChange={setFilter}
      rootName={rootHandle.name}
      currentPath={currentPath}
      onNavigateToPath={handleNavigateToPath}
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
      showPreviewPane={showPreviewPane}
      contentRef={contentRef}
      paneWidthRatio={paneWidthRatio}
      onPreviewPaneResizeStart={handlePreviewPaneResizeStart}
      selectedFile={selectedFile}
      previewActionTools={previewActionTools}
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

export default App
