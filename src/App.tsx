import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { useFileSystem } from '@/hooks/useFileSystem'
import { FileGrid } from '@/components/FileGrid'
import type { FileGridHandle } from '@/components/FileGrid'
import { Toolbar } from '@/components/Toolbar'
import { PreviewModal } from '@/components/PreviewModal'
import { PreviewPane } from '@/components/PreviewPane'
import { createObjectUrlForFile, isImageFile, isVideoFile } from '@/lib/fileSystem'
import type { FileItem, FilterState } from '@/types'
import { StatusBar } from '@/components/StatusBar'

const MIN_PANE_WIDTH_RATIO = 0.15
const MAX_PANE_WIDTH_RATIO = 0.75
const DEFAULT_PANE_WIDTH_RATIO = 0.4
const DEFAULT_AUTOPLAY_INTERVAL_SEC = 3
const MIN_AUTOPLAY_INTERVAL_SEC = 1
const MAX_AUTOPLAY_INTERVAL_SEC = 10
type TraversalOrder = 'sequential' | 'shuffle'

const defaultFilter: FilterState = {
  search: '',
  type: 'all',
  hideEmptyFolders: true,
  sortBy: 'name',
  sortOrder: 'asc',
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function shufflePaths(paths: string[]): string[] {
  const result = [...paths]
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = current
  }
  return result
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
    navigateToDirectory,
    navigateUp,
    setFlattenView,
    filterFiles,
  } = useFileSystem()

  const [filter, setFilter] = useState<FilterState>(defaultFilter)
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [previewAutoPlayOnOpen, setPreviewAutoPlayOnOpen] = useState(false)
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false)
  const [autoPlayIntervalSec, setAutoPlayIntervalSec] = useState(DEFAULT_AUTOPLAY_INTERVAL_SEC)
  const [autoPlayPausedByVisibility, setAutoPlayPausedByVisibility] = useState(false)
  const [traversalOrder, setTraversalOrder] = useState<TraversalOrder>('sequential')
  const [shuffleQueue, setShuffleQueue] = useState<string[]>([])
  const [shuffleHistory, setShuffleHistory] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [paneWidthRatio, setPaneWidthRatio] = useState(DEFAULT_PANE_WIDTH_RATIO)
  const [showPreviewPane, setShowPreviewPane] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const fileGridRef = useRef<FileGridHandle>(null)
  const previewUrlRef = useRef<string | null>(null)
  const autoPlayTimerRef = useRef<number | null>(null)

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
  const mediaFiles = useMemo(
    () =>
      filteredFiles.filter(
        (file): file is FileItem => file.kind === 'file' && (isImageFile(file.name) || isVideoFile(file.name))
      ),
    [filteredFiles]
  )
  const mediaIndexByPath = useMemo(() => {
    const indexMap = new Map<string, number>()
    mediaFiles.forEach((file, index) => {
      indexMap.set(file.path, index)
    })
    return indexMap
  }, [mediaFiles])
  const mediaFileByPath = useMemo(() => {
    const fileMap = new Map<string, FileItem>()
    mediaFiles.forEach((file) => {
      fileMap.set(file.path, file)
    })
    return fileMap
  }, [mediaFiles])

  const getMediaIndex = useCallback(
    (file: FileItem | null) => {
      if (!file || file.kind !== 'file') return -1
      return mediaIndexByPath.get(file.path) ?? -1
    },
    [mediaIndexByPath]
  )

  const initializeShuffleState = useCallback((currentPath: string) => {
    const nextQueue = shufflePaths(
      mediaFiles
        .map((file) => file.path)
        .filter((path) => path !== currentPath)
    )
    setShuffleHistory([currentPath])
    setShuffleQueue(nextQueue)
  }, [mediaFiles])

  const applyMediaSelection = useCallback((
    nextFile: FileItem,
    source: 'pane' | 'modal' | 'autoplay'
  ) => {
    if (source === 'modal' || (source === 'autoplay' && previewFile)) {
      if (source === 'modal') {
        setPreviewAutoPlayOnOpen(false)
      }
      setPreviewFile(nextFile)
      setSelectedFile(nextFile)
      setShowPreviewPane(true)
      return
    }

    setSelectedFile(nextFile)
    setShowPreviewPane(true)
  }, [previewFile])

  const navigateMedia = useCallback((
    currentFile: FileItem | null,
    direction: 'prev' | 'next',
    options: { source: 'pane' | 'modal' | 'autoplay'; wrap: boolean }
  ) => {
    const currentIndex = getMediaIndex(currentFile)
    if (currentIndex < 0 || !currentFile || currentFile.kind !== 'file') return
    const currentPath = currentFile.path

    if (traversalOrder === 'shuffle') {
      if (direction === 'prev') {
        const historyTail = shuffleHistory[shuffleHistory.length - 1]
        if (historyTail !== currentPath || shuffleHistory.length <= 1) return

        const previousPath = shuffleHistory[shuffleHistory.length - 2]
        const previousFile = mediaFileByPath.get(previousPath)
        if (!previousFile) return

        setShuffleHistory((previous) => previous.slice(0, -1))
        setShuffleQueue((previous) => [currentPath, ...previous.filter((path) => path !== currentPath)])
        applyMediaSelection(previousFile, options.source)
        return
      }

      let nextQueue = shuffleQueue.filter((path) => path !== currentPath)
      if (nextQueue.length === 0) {
        nextQueue = shufflePaths(
          mediaFiles
            .map((file) => file.path)
            .filter((path) => path !== currentPath)
        )
      }

      const nextPath = nextQueue[0]
      if (!nextPath) return

      const nextFile = mediaFileByPath.get(nextPath)
      if (!nextFile) return

      setShuffleQueue(nextQueue.slice(1))
      setShuffleHistory((previous) => {
        if (previous.length > 0 && previous[previous.length - 1] === currentPath) {
          return [...previous, nextPath]
        }
        return [currentPath, nextPath]
      })
      applyMediaSelection(nextFile, options.source)
      return
    }

    let targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1
    if (options.wrap) {
      if (targetIndex < 0) {
        targetIndex = mediaFiles.length - 1
      } else if (targetIndex >= mediaFiles.length) {
        targetIndex = 0
      }
    } else if (targetIndex < 0 || targetIndex >= mediaFiles.length) {
      return
    }

    const nextFile = mediaFiles[targetIndex]
    if (!nextFile || nextFile.path === currentPath) return
    applyMediaSelection(nextFile, options.source)
  }, [
    getMediaIndex,
    traversalOrder,
    shuffleHistory,
    mediaFileByPath,
    shuffleQueue,
    mediaFiles,
    applyMediaSelection,
  ])

  const navigateMediaFromPane = useCallback((direction: 'prev' | 'next') => {
    navigateMedia(selectedFile, direction, { source: 'pane', wrap: false })
  }, [navigateMedia, selectedFile])

  const navigateMediaFromModal = useCallback((direction: 'prev' | 'next') => {
    navigateMedia(previewFile, direction, { source: 'modal', wrap: false })
  }, [navigateMedia, previewFile])
  const hasOpenPreview = !!previewFile || showPreviewPane

  const activeMediaFile = previewFile ?? (showPreviewPane ? selectedFile : null)

  const selectedMediaIndex = getMediaIndex(selectedFile)
  const previewMediaIndex = getMediaIndex(previewFile)
  const selectedShuffleCanPrev =
    !!selectedFile &&
    selectedFile.kind === 'file' &&
    shuffleHistory.length > 1 &&
    shuffleHistory[shuffleHistory.length - 1] === selectedFile.path
  const previewShuffleCanPrev =
    !!previewFile &&
    previewFile.kind === 'file' &&
    shuffleHistory.length > 1 &&
    shuffleHistory[shuffleHistory.length - 1] === previewFile.path
  const selectedShuffleCanNext = selectedMediaIndex >= 0 && mediaFiles.length > 1
  const previewShuffleCanNext = previewMediaIndex >= 0 && mediaFiles.length > 1
  const canPrevFromPane =
    traversalOrder === 'shuffle' ? selectedShuffleCanPrev : selectedMediaIndex > 0
  const canNextFromPane =
    traversalOrder === 'shuffle'
      ? selectedShuffleCanNext
      : selectedMediaIndex >= 0 && selectedMediaIndex < mediaFiles.length - 1
  const canPrevFromModal =
    traversalOrder === 'shuffle' ? previewShuffleCanPrev : previewMediaIndex > 0
  const canNextFromModal =
    traversalOrder === 'shuffle'
      ? previewShuffleCanNext
      : previewMediaIndex >= 0 && previewMediaIndex < mediaFiles.length - 1
  const activeMediaIndex = getMediaIndex(activeMediaFile)
  const isAutoPlayEligible =
    autoPlayEnabled &&
    !autoPlayPausedByVisibility &&
    activeMediaIndex >= 0 &&
    mediaFiles.length > 1

  useEffect(() => {
    if (previewFile && rootHandle) {
      const loadUrl = async () => {
        try {
          const pathParts = previewFile.path.split('/')
          let current: FileSystemHandle = rootHandle

          for (let i = 0; i < pathParts.length - 1; i++) {
            current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(pathParts[i])
          }

          const fileName = pathParts[pathParts.length - 1]
          const fileHandle = await (current as FileSystemDirectoryHandle).getFileHandle(fileName)
          const file = await fileHandle.getFile()
          const url = createObjectUrlForFile(file, fileName)
          previewUrlRef.current = url
          setPreviewUrl(url)
        } catch (err) {
          console.error('Failed to load file:', err)
          setPreviewUrl(null)
        }
      }
      loadUrl()

      return () => {
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current)
          previewUrlRef.current = null
        }
      }
    } else {
      setPreviewUrl(null)
    }
  }, [previewFile, rootHandle])

  const handleDirectoryClick = useCallback((dirName: string) => {
    navigateToDirectory(dirName)
  }, [navigateToDirectory])

  const handleFileClick = useCallback((file: FileItem) => {
    if (file.kind === 'directory') {
      navigateToDirectory(file.name)
    } else {
      setSelectedFile(file)
      setShowPreviewPane(true)
      setPreviewFile((current) => (current ? file : current))
    }
  }, [navigateToDirectory])

  const handleFileDoubleClick = useCallback((file: FileItem) => {
    if (file.kind === 'file') {
      setPreviewAutoPlayOnOpen(isVideoFile(file.name))
      setPreviewFile(file)
    }
  }, [])

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null)
    setPreviewAutoPlayOnOpen(false)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }, [previewUrl])

  const handleClosePane = useCallback(() => {
    setShowPreviewPane(false)
  }, [])

  const handleOpenFullscreenFromPane = useCallback(() => {
    if (selectedFile?.kind === 'file') {
      setPreviewAutoPlayOnOpen(isVideoFile(selectedFile.name))
      setPreviewFile(selectedFile)
    }
  }, [selectedFile])

  const clearAutoPlayTimer = useCallback(() => {
    if (autoPlayTimerRef.current !== null) {
      window.clearTimeout(autoPlayTimerRef.current)
      autoPlayTimerRef.current = null
    }
  }, [])

  const handleToggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled((previous) => !previous)
  }, [])

  const handleToggleTraversalOrder = useCallback(() => {
    const next = traversalOrder === 'sequential' ? 'shuffle' : 'sequential'
    setTraversalOrder(next)

    if (next === 'sequential') {
      setShuffleQueue([])
      setShuffleHistory([])
      return
    }

    const anchor =
      activeMediaFile?.kind === 'file' && mediaIndexByPath.has(activeMediaFile.path)
        ? activeMediaFile.path
        : null

    if (anchor) {
      initializeShuffleState(anchor)
      return
    }

    if (mediaFiles.length > 0) {
      const fallback = mediaFiles[0]
      setSelectedFile(fallback)
      if (previewFile) {
        setPreviewFile(fallback)
      }
      setShowPreviewPane(true)
      initializeShuffleState(fallback.path)
      return
    }

    setShuffleQueue([])
    setShuffleHistory([])
  }, [
    traversalOrder,
    activeMediaFile,
    mediaIndexByPath,
    mediaFiles,
    previewFile,
    initializeShuffleState,
  ])

  const handleAutoPlayIntervalChange = useCallback((value: number) => {
    const nextValue = Math.min(
      MAX_AUTOPLAY_INTERVAL_SEC,
      Math.max(MIN_AUTOPLAY_INTERVAL_SEC, value)
    )
    setAutoPlayIntervalSec(nextValue)
  }, [])

  const handleAutoPlayVideoEnded = useCallback(() => {
    if (!isAutoPlayEligible || !activeMediaFile || activeMediaFile.kind !== 'file') return
    if (!isVideoFile(activeMediaFile.name)) return
    navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: true })
  }, [isAutoPlayEligible, activeMediaFile, navigateMedia])

  const handleAutoPlayVideoPlaybackError = useCallback(() => {
    if (!isAutoPlayEligible || !activeMediaFile || activeMediaFile.kind !== 'file') return
    if (!isVideoFile(activeMediaFile.name)) return
    navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: true })
  }, [isAutoPlayEligible, activeMediaFile, navigateMedia])

  useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedFile(null)
      return
    }
    if (!selectedFile) return
    const stillExists = filteredFiles.some((item) => item.path === selectedFile.path)
    if (!stillExists) {
      setSelectedFile(filteredFiles[0])
      setShowPreviewPane(filteredFiles[0].kind === 'file')
    }
  }, [filteredFiles, selectedFile])

  useEffect(() => {
    if (traversalOrder !== 'shuffle') return
    if (mediaFiles.length === 0) {
      setShuffleQueue([])
      setShuffleHistory([])
      return
    }

    const activePath =
      activeMediaFile?.kind === 'file' && mediaIndexByPath.has(activeMediaFile.path)
        ? activeMediaFile.path
        : null

    if (!activePath) {
      const fallback = mediaFiles[0]
      setSelectedFile(fallback)
      if (previewFile) {
        setPreviewFile(fallback)
      }
      setShowPreviewPane(true)
      initializeShuffleState(fallback.path)
      return
    }

    const hasInvalidQueueEntry = shuffleQueue.some((path) => !mediaIndexByPath.has(path))
    const hasInvalidHistoryEntry = shuffleHistory.some((path) => !mediaIndexByPath.has(path))
    const tailPath = shuffleHistory[shuffleHistory.length - 1]

    if (hasInvalidQueueEntry || hasInvalidHistoryEntry || tailPath !== activePath) {
      initializeShuffleState(activePath)
    }
  }, [
    traversalOrder,
    mediaFiles,
    activeMediaFile,
    mediaIndexByPath,
    shuffleQueue,
    shuffleHistory,
    previewFile,
    initializeShuffleState,
  ])

  useEffect(() => {
    fileGridRef.current?.syncSelectedPath(selectedFile?.path ?? null, {
      scroll: true,
      focus: false,
    })
  }, [selectedFile])

  useEffect(() => {
    if (!previewFile && !showPreviewPane) {
      setAutoPlayEnabled(false)
    }
  }, [previewFile, showPreviewPane])

  useEffect(() => {
    const syncVisibilityState = () => {
      setAutoPlayPausedByVisibility(document.visibilityState !== 'visible')
    }

    const handleBlur = () => {
      setAutoPlayPausedByVisibility(true)
    }

    const handleFocus = () => {
      syncVisibilityState()
    }

    syncVisibilityState()
    document.addEventListener('visibilitychange', syncVisibilityState)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', syncVisibilityState)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  useEffect(() => {
    clearAutoPlayTimer()

    if (!isAutoPlayEligible || !activeMediaFile || activeMediaFile.kind !== 'file') {
      return
    }
    if (isVideoFile(activeMediaFile.name)) {
      return
    }

    autoPlayTimerRef.current = window.setTimeout(() => {
      navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: true })
    }, autoPlayIntervalSec * 1000)

    return clearAutoPlayTimer
  }, [
    clearAutoPlayTimer,
    isAutoPlayEligible,
    activeMediaFile,
    autoPlayIntervalSec,
    navigateMedia,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const isTyping = isTypingTarget(event.target)
      const key = event.key.toLowerCase()

      // Ctrl/Cmd + O: open folder picker
      if ((event.ctrlKey || event.metaKey) && key === 'o') {
        event.preventDefault()
        void selectDirectory()
        return
      }

      // Ignore most global shortcuts while user is typing
      if (isTyping) return

      // P: toggle preview autoplay
      if (!event.ctrlKey && !event.metaKey && !event.altKey && key === 'p') {
        event.preventDefault()
        setAutoPlayEnabled((previous) => !previous)
        return
      }

      // Preview traversal hotkeys only work while preview is open.
      if (hasOpenPreview && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (key === 'r') {
          event.preventDefault()
          handleToggleTraversalOrder()
          return
        }
        if (event.key === '[' || event.key === '{') {
          event.preventDefault()
          if (previewFile) {
            navigateMediaFromModal('prev')
          } else {
            navigateMediaFromPane('prev')
          }
          return
        }
        if (event.key === ']' || event.key === '}') {
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
      if (event.key === 'Backspace' && currentPath) {
        event.preventDefault()
        void navigateUp()
        return
      }

      // Escape: close modal first, then side preview pane
      if (event.key === 'Escape') {
        if (previewFile) {
          event.preventDefault()
          handleClosePreview()
          return
        }
        if (showPreviewPane) {
          event.preventDefault()
          handleClosePane()
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
    handleToggleTraversalOrder,
    handleClosePreview,
    handleClosePane,
  ])

  if (!rootHandle) {
    return (
      <div className="h-screen bg-background flex flex-col items-center justify-center p-8 overflow-hidden">
        <div className="text-center max-w-md">
          <h1 className="text-4xl font-bold mb-4">Fauplay</h1>
          <p className="text-muted-foreground mb-8">
            选择一个本地文件夹开始浏览图片和视频
          </p>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}

          <button
            onClick={selectDirectory}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <FolderOpen className="w-5 h-5" />
            )}
            选择文件夹
          </button>

          <p className="text-xs text-muted-foreground mt-8">
            支持 Chrome 94+、Edge 94+、Firefox 111+
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        currentPath={currentPath}
        onNavigateUp={navigateUp}
        isFlattenView={isFlattenView}
        onToggleFlattenView={() => {
          void setFlattenView(!isFlattenView)
        }}
        totalCount={totalCount}
        imageCount={imageCount}
        videoCount={videoCount}
      />

      {error && (
        <div className="mx-4 mt-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <FileGrid
            ref={fileGridRef}
            files={filteredFiles}
            rootHandle={rootHandle}
            onFileClick={handleFileClick}
            onFileDoubleClick={handleFileDoubleClick}
            onDirectoryClick={handleDirectoryClick}
          />
        )}

        {showPreviewPane && (
          <div 
            ref={contentRef}
            className="flex-shrink-0 h-full relative overflow-hidden" 
            style={{ width: `${paneWidthRatio * 100}%` }}
          >
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 bg-transparent transition-colors z-10"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
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
              }}
            />
            <PreviewPane
              file={selectedFile}
              rootHandle={rootHandle}
              onClose={handleClosePane}
              onOpenFullscreen={handleOpenFullscreenFromPane}
              canPrev={canPrevFromPane}
              canNext={canNextFromPane}
              onPrev={() => navigateMediaFromPane('prev')}
              onNext={() => navigateMediaFromPane('next')}
              autoPlayEnabled={autoPlayEnabled}
              autoPlayIntervalSec={autoPlayIntervalSec}
              onToggleAutoPlay={handleToggleAutoPlay}
              traversalOrder={traversalOrder}
              onToggleTraversalOrder={handleToggleTraversalOrder}
              onAutoPlayIntervalChange={handleAutoPlayIntervalChange}
              onVideoEnded={handleAutoPlayVideoEnded}
              onVideoPlaybackError={handleAutoPlayVideoPlaybackError}
            />
          </div>
        )}
      </div>

      <StatusBar
        visibleFiles={filteredFiles}
        selectedFile={selectedFile}
      />

      {previewFile && previewUrl && (
        <PreviewModal
          file={previewFile}
          rootHandle={rootHandle}
          fileUrl={previewUrl}
          onClose={handleClosePreview}
          autoPlayOnOpen={previewAutoPlayOnOpen}
          canPrev={canPrevFromModal}
          canNext={canNextFromModal}
          onPrev={() => navigateMediaFromModal('prev')}
          onNext={() => navigateMediaFromModal('next')}
          autoPlayEnabled={autoPlayEnabled}
          autoPlayIntervalSec={autoPlayIntervalSec}
          onToggleAutoPlay={handleToggleAutoPlay}
          traversalOrder={traversalOrder}
          onToggleTraversalOrder={handleToggleTraversalOrder}
          onAutoPlayIntervalChange={handleAutoPlayIntervalChange}
          onVideoEnded={handleAutoPlayVideoEnded}
          onVideoPlaybackError={handleAutoPlayVideoPlaybackError}
        />
      )}
    </div>
  )
}

export default App
