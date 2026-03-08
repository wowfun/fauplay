import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isImageFile, isVideoFile } from '@/lib/fileSystem'
import type { FileItem } from '@/types'
import type { PlaybackOrder } from '@/features/preview/types/playback'

const DEFAULT_AUTOPLAY_INTERVAL_SEC = 3
const MIN_AUTOPLAY_INTERVAL_SEC = 1
const MAX_AUTOPLAY_INTERVAL_SEC = 10
const WRAP_AT_BOUNDARY = true

type NavigateSource = 'pane' | 'modal' | 'autoplay'
type NavigateDirection = 'prev' | 'next'

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

interface UsePreviewTraversalOptions {
  filteredFiles: FileItem[]
}

export function usePreviewTraversal({ filteredFiles }: UsePreviewTraversalOptions) {
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [showPreviewPane, setShowPreviewPane] = useState(false)
  const [previewAutoPlayOnOpen, setPreviewAutoPlayOnOpen] = useState(false)
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false)
  const [autoPlayIntervalSec, setAutoPlayIntervalSec] = useState(DEFAULT_AUTOPLAY_INTERVAL_SEC)
  const [autoPlayPausedByVisibility, setAutoPlayPausedByVisibility] = useState(false)
  const [playbackOrder, setPlaybackOrder] = useState<PlaybackOrder>('sequential')
  const [shuffleQueue, setShuffleQueue] = useState<string[]>([])
  const [shuffleHistory, setShuffleHistory] = useState<string[]>([])
  const autoPlayTimerRef = useRef<number | null>(null)

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
  const mediaSetKey = useMemo(
    () => mediaFiles.map((file) => file.path).sort().join('\u0000'),
    [mediaFiles]
  )
  const lastShuffleMediaSetKeyRef = useRef<string | null>(null)

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
    source: NavigateSource
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
    direction: NavigateDirection,
    options: { source: NavigateSource; wrap: boolean }
  ) => {
    const currentIndex = getMediaIndex(currentFile)
    if (currentIndex < 0 || !currentFile || currentFile.kind !== 'file') return
    const currentPath = currentFile.path

    if (playbackOrder === 'shuffle') {
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
    playbackOrder,
    shuffleHistory,
    mediaFileByPath,
    shuffleQueue,
    mediaFiles,
    applyMediaSelection,
  ])

  const navigateMediaFromPane = useCallback((direction: NavigateDirection) => {
    navigateMedia(selectedFile, direction, { source: 'pane', wrap: WRAP_AT_BOUNDARY })
  }, [navigateMedia, selectedFile])

  const navigateMediaFromModal = useCallback((direction: NavigateDirection) => {
    navigateMedia(previewFile, direction, { source: 'modal', wrap: WRAP_AT_BOUNDARY })
  }, [navigateMedia, previewFile])

  const hasOpenPreview = !!previewFile || showPreviewPane
  const activeMediaFile = previewFile ?? (showPreviewPane ? selectedFile : null)
  const activeMediaIndex = getMediaIndex(activeMediaFile)
  const isAutoPlayEligible =
    autoPlayEnabled &&
    !autoPlayPausedByVisibility &&
    activeMediaIndex >= 0 &&
    mediaFiles.length > 1

  const showFileInPane = useCallback((file: FileItem) => {
    if (file.kind !== 'file') return
    setSelectedFile(file)
    setShowPreviewPane(true)
    setPreviewFile((current) => (current ? file : current))
  }, [])

  const openFileInModal = useCallback((file: FileItem) => {
    if (file.kind !== 'file') return
    setPreviewAutoPlayOnOpen(isVideoFile(file.name))
    setPreviewFile(file)
  }, [])

  const closePreviewModal = useCallback(() => {
    setPreviewFile(null)
    setPreviewAutoPlayOnOpen(false)
  }, [])

  const closePreviewPane = useCallback(() => {
    setShowPreviewPane(false)
  }, [])

  const openFullscreenFromPane = useCallback(() => {
    if (selectedFile?.kind !== 'file') return
    setPreviewAutoPlayOnOpen(isVideoFile(selectedFile.name))
    setPreviewFile(selectedFile)
  }, [selectedFile])

  const toggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled((previous) => !previous)
  }, [])

  const togglePlaybackOrder = useCallback(() => {
    const next = playbackOrder === 'sequential' ? 'shuffle' : 'sequential'
    setPlaybackOrder(next)

    if (next === 'sequential') {
      setShuffleQueue([])
      setShuffleHistory([])
      lastShuffleMediaSetKeyRef.current = null
      return
    }

    const anchor =
      activeMediaFile?.kind === 'file' && mediaIndexByPath.has(activeMediaFile.path)
        ? activeMediaFile.path
        : null

    if (anchor) {
      initializeShuffleState(anchor)
      lastShuffleMediaSetKeyRef.current = mediaSetKey
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
      lastShuffleMediaSetKeyRef.current = mediaSetKey
      return
    }

    setShuffleQueue([])
    setShuffleHistory([])
    lastShuffleMediaSetKeyRef.current = null
  }, [
    playbackOrder,
    activeMediaFile,
    mediaIndexByPath,
    mediaFiles,
    mediaSetKey,
    previewFile,
    initializeShuffleState,
  ])

  const setAutoPlayInterval = useCallback((value: number) => {
    const nextValue = Math.min(
      MAX_AUTOPLAY_INTERVAL_SEC,
      Math.max(MIN_AUTOPLAY_INTERVAL_SEC, value)
    )
    setAutoPlayIntervalSec(nextValue)
  }, [])

  const handleAutoPlayVideoEnded = useCallback(() => {
    if (!isAutoPlayEligible || !activeMediaFile || activeMediaFile.kind !== 'file') return
    if (!isVideoFile(activeMediaFile.name)) return
    navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: WRAP_AT_BOUNDARY })
  }, [isAutoPlayEligible, activeMediaFile, navigateMedia])

  const handleAutoPlayVideoPlaybackError = useCallback(() => {
    if (!isAutoPlayEligible || !activeMediaFile || activeMediaFile.kind !== 'file') return
    if (!isVideoFile(activeMediaFile.name)) return
    navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: WRAP_AT_BOUNDARY })
  }, [isAutoPlayEligible, activeMediaFile, navigateMedia])

  useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedFile(null)
      setShowPreviewPane(false)
      setPreviewFile(null)
      return
    }
    if (!selectedFile) return
    const stillExists = filteredFiles.some((item) => item.path === selectedFile.path)
    if (!stillExists) {
      const fallbackFile = filteredFiles.find((item): item is FileItem => item.kind === 'file') ?? null

      if (fallbackFile) {
        setSelectedFile(fallbackFile)
        if (showPreviewPane) {
          setShowPreviewPane(true)
        }
        if (previewFile) {
          setPreviewFile(fallbackFile)
        }
        return
      }

      setSelectedFile(filteredFiles[0])
      setShowPreviewPane(false)
      if (previewFile) {
        setPreviewFile(null)
      }
    }
  }, [filteredFiles, previewFile, selectedFile, showPreviewPane])

  useEffect(() => {
    if (playbackOrder !== 'shuffle') {
      lastShuffleMediaSetKeyRef.current = null
      return
    }
    if (mediaFiles.length === 0) {
      setShuffleQueue([])
      setShuffleHistory([])
      lastShuffleMediaSetKeyRef.current = mediaSetKey
      return
    }
    if (!previewFile && !showPreviewPane) {
      return
    }

    const activePath =
      activeMediaFile?.kind === 'file' && mediaIndexByPath.has(activeMediaFile.path)
        ? activeMediaFile.path
        : null

    const hasInvalidQueueEntry = shuffleQueue.some((path) => !mediaIndexByPath.has(path))
    const hasInvalidHistoryEntry = shuffleHistory.some((path) => !mediaIndexByPath.has(path))
    const tailPath = shuffleHistory[shuffleHistory.length - 1]
    const hasMediaSetChanged = lastShuffleMediaSetKeyRef.current !== mediaSetKey

    if (!activePath) {
      const fallback = mediaFiles[0]
      setSelectedFile(fallback)
      if (previewFile) {
        setPreviewFile(fallback)
      }
      setShowPreviewPane(true)
      initializeShuffleState(fallback.path)
      lastShuffleMediaSetKeyRef.current = mediaSetKey
      return
    }

    if (hasMediaSetChanged || hasInvalidQueueEntry || hasInvalidHistoryEntry || tailPath !== activePath) {
      initializeShuffleState(activePath)
      lastShuffleMediaSetKeyRef.current = mediaSetKey
      return
    }
    lastShuffleMediaSetKeyRef.current = mediaSetKey
  }, [
    playbackOrder,
    mediaFiles,
    mediaSetKey,
    activeMediaFile,
    mediaIndexByPath,
    shuffleQueue,
    shuffleHistory,
    previewFile,
    showPreviewPane,
    initializeShuffleState,
  ])

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

  const clearAutoPlayTimer = useCallback(() => {
    if (autoPlayTimerRef.current !== null) {
      window.clearTimeout(autoPlayTimerRef.current)
      autoPlayTimerRef.current = null
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
      navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: WRAP_AT_BOUNDARY })
    }, autoPlayIntervalSec * 1000)

    return clearAutoPlayTimer
  }, [
    clearAutoPlayTimer,
    isAutoPlayEligible,
    activeMediaFile,
    autoPlayIntervalSec,
    navigateMedia,
  ])

  return {
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
  }
}
