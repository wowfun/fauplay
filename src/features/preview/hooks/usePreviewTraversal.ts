import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPreviewMediaCollection,
  canNavigatePreviewMedia,
  clampAutoPlayIntervalSec,
  DEFAULT_AUTOPLAY_INTERVAL_SEC,
  getPreviewMediaIndex,
  normalizeVideoPlaybackRate,
  normalizeVideoSeekStepSec,
  nextVideoPlaybackRate,
  resolvePreviewFilteredFilesChangePlan,
  resolvePreviewMediaNavigation,
  resolvePreviewPlaybackOrderTogglePlan,
  resolvePreviewShuffleMediaSetSyncPlan,
  type PreviewNavigateDirection,
} from '@/features/preview/lib/previewTraversalModel'
import {
  readPreviewPlaybackPreferences,
  savePreviewPlaybackPreferences,
  type PreviewPlaybackPreferencesStorage,
} from '@/features/preview/lib/previewPlaybackPreferences'
import {
  resolvePreviewAutoPlayAdvanceIntent,
  resolvePreviewAutoPlayEligibility,
  resolvePreviewAutoPlayGateIntent,
  resolvePreviewAutoPlayTimerPlan,
} from '@/features/preview/lib/previewAutoPlayModel'
import {
  resolvePreviewFullscreenFromPaneIntent,
  resolvePreviewModalOpenIntent,
  resolvePreviewPaneOpenIntent,
  resolvePreviewPathAlignmentIntent,
  type PreviewModalOpenIntent,
  type PreviewSurfaceSelectionIntent,
} from '@/features/preview/lib/previewSurfaceActionModel'
import type { FileItem } from '@/types'
import type { PlaybackOrder } from '@/features/preview/types/playback'

const WRAP_AT_BOUNDARY = true

type NavigateSource = 'pane' | 'modal' | 'autoplay'
type NavigateDirection = PreviewNavigateDirection

interface UsePreviewTraversalOptions {
  filteredFiles: FileItem[]
}

function getPreviewPlaybackPreferencesStorage(): PreviewPlaybackPreferencesStorage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function readPersistedPreviewPlaybackPreferences() {
  return readPreviewPlaybackPreferences(getPreviewPlaybackPreferencesStorage())
}

function savePersistedPreviewPlaybackPreferences(preferences: {
  videoSeekStepSec: number
  videoPlaybackRate: number
  playbackOrder: PlaybackOrder
  faceBboxVisible: boolean
}): void {
  savePreviewPlaybackPreferences(getPreviewPlaybackPreferencesStorage(), preferences)
}

export function usePreviewTraversal({ filteredFiles }: UsePreviewTraversalOptions) {
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [showPreviewPane, setShowPreviewPane] = useState(false)
  const [previewAutoPlayOnOpen, setPreviewAutoPlayOnOpen] = useState(false)
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false)
  const [autoPlayIntervalSec, setAutoPlayIntervalSec] = useState(DEFAULT_AUTOPLAY_INTERVAL_SEC)
  const [initialPlaybackPreferences] = useState(readPersistedPreviewPlaybackPreferences)
  const [videoSeekStepSec, setVideoSeekStepSec] = useState<number>(() => initialPlaybackPreferences.videoSeekStepSec)
  const [videoPlaybackRate, setVideoPlaybackRateState] = useState<number>(() => initialPlaybackPreferences.videoPlaybackRate)
  const [faceBboxVisible, setFaceBboxVisible] = useState<boolean>(() => initialPlaybackPreferences.faceBboxVisible)
  const [autoPlayPausedByVisibility, setAutoPlayPausedByVisibility] = useState(false)
  const [playbackOrder, setPlaybackOrder] = useState<PlaybackOrder>(() => initialPlaybackPreferences.playbackOrder)
  const [shuffleQueue, setShuffleQueue] = useState<string[]>([])
  const [shuffleHistory, setShuffleHistory] = useState<string[]>([])
  const autoPlayTimerRef = useRef<number | null>(null)
  const preferredPreviewPathRef = useRef<string | null>(null)

  const mediaCollection = useMemo(
    () => buildPreviewMediaCollection(filteredFiles),
    [filteredFiles]
  )
  const {
    mediaFiles,
  } = mediaCollection
  const lastShuffleMediaSetKeyRef = useRef<string | null>(null)

  const getMediaIndex = useCallback(
    (file: FileItem | null) => getPreviewMediaIndex(mediaCollection, file),
    [mediaCollection]
  )

  const applySurfaceSelectionIntent = useCallback((intent: PreviewSurfaceSelectionIntent) => {
    if (intent.kind === 'none') return
    if (intent.kind === 'clear-preferred-path' || intent.kind === 'store-preferred-path') {
      preferredPreviewPathRef.current = intent.preferredPreviewPath
      return
    }

    preferredPreviewPathRef.current = intent.preferredPreviewPath
    setSelectedFile(intent.selectedFile)
    setPreviewFile(intent.previewFile)
    setShowPreviewPane(intent.showPreviewPane)
  }, [])

  const applyModalOpenIntent = useCallback((intent: PreviewModalOpenIntent) => {
    if (intent.kind === 'none') return
    setPreviewAutoPlayOnOpen(intent.previewAutoPlayOnOpen)
    setPreviewFile(intent.previewFile)
  }, [])

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
    const navigationPlan = resolvePreviewMediaNavigation({
      collection: mediaCollection,
      currentFile,
      direction,
      playbackOrder,
      wrap: options.wrap,
      shuffleState: playbackOrder === 'shuffle'
        ? { queue: shuffleQueue, history: shuffleHistory }
        : undefined,
    })
    if (!navigationPlan) return

    if (navigationPlan.shuffleState) {
      setShuffleQueue(navigationPlan.shuffleState.queue)
      setShuffleHistory(navigationPlan.shuffleState.history)
    }
    applyMediaSelection(navigationPlan.nextFile, options.source)
  }, [
    mediaCollection,
    playbackOrder,
    shuffleQueue,
    shuffleHistory,
    applyMediaSelection,
  ])

  const navigateMediaFromPane = useCallback((direction: NavigateDirection) => {
    navigateMedia(selectedFile, direction, { source: 'pane', wrap: WRAP_AT_BOUNDARY })
  }, [navigateMedia, selectedFile])

  const navigateMediaFromModal = useCallback((direction: NavigateDirection) => {
    navigateMedia(previewFile, direction, { source: 'modal', wrap: WRAP_AT_BOUNDARY })
  }, [navigateMedia, previewFile])

  const canNavigateMediaFromPane = useMemo(() => (
    canNavigatePreviewMedia(mediaCollection, selectedFile)
  ), [mediaCollection, selectedFile])

  const canNavigateMediaFromModal = useMemo(() => (
    canNavigatePreviewMedia(mediaCollection, previewFile)
  ), [mediaCollection, previewFile])

  const hasOpenPreview = !!previewFile || showPreviewPane
  const activeMediaFile = previewFile ?? (showPreviewPane ? selectedFile : null)
  const activeMediaIndex = getMediaIndex(activeMediaFile)
  const hasActiveMediaPreview = activeMediaIndex >= 0
  const isAutoPlayEligible = resolvePreviewAutoPlayEligibility({
    autoPlayEnabled,
    pausedByVisibility: autoPlayPausedByVisibility,
    hasActiveMediaPreview,
    mediaCount: mediaFiles.length,
  })

  const showFileInPane = useCallback((file: FileItem) => {
    applySurfaceSelectionIntent(resolvePreviewPaneOpenIntent({
      file,
      currentPreviewFile: previewFile,
    }))
  }, [applySurfaceSelectionIntent, previewFile])

  const alignPreviewToPath = useCallback((path: string | null) => {
    applySurfaceSelectionIntent(resolvePreviewPathAlignmentIntent({
      path,
      files: filteredFiles,
      currentPreviewFile: previewFile,
      showPreviewPane,
    }))
  }, [applySurfaceSelectionIntent, filteredFiles, previewFile, showPreviewPane])

  const openFileInModal = useCallback((file: FileItem) => {
    applyModalOpenIntent(resolvePreviewModalOpenIntent({ file }))
  }, [applyModalOpenIntent])

  const closePreviewModal = useCallback(() => {
    setPreviewFile(null)
    setPreviewAutoPlayOnOpen(false)
  }, [])

  const closePreviewPane = useCallback(() => {
    setShowPreviewPane(false)
  }, [])

  const openFullscreenFromPane = useCallback(() => {
    applyModalOpenIntent(resolvePreviewFullscreenFromPaneIntent({ selectedFile }))
  }, [applyModalOpenIntent, selectedFile])

  const toggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled((previous) => !previous)
  }, [])

  const togglePlaybackOrder = useCallback(() => {
    const togglePlan = resolvePreviewPlaybackOrderTogglePlan({
      collection: mediaCollection,
      currentPlaybackOrder: playbackOrder,
      activeMediaFile,
      isPreviewModalOpen: !!previewFile,
    })

    setPlaybackOrder(togglePlan.playbackOrder)
    setShuffleQueue(togglePlan.shuffleState.queue)
    setShuffleHistory(togglePlan.shuffleState.history)
    lastShuffleMediaSetKeyRef.current = togglePlan.lastShuffleMediaSetKey

    if (!togglePlan.selection) return
    setSelectedFile(togglePlan.selection.selectedFile)
    setPreviewFile(togglePlan.selection.previewFile)
    setShowPreviewPane(togglePlan.selection.showPreviewPane)
  }, [
    playbackOrder,
    activeMediaFile,
    mediaCollection,
    previewFile,
  ])

  const setAutoPlayInterval = useCallback((value: number) => {
    setAutoPlayIntervalSec(clampAutoPlayIntervalSec(value))
  }, [])

  const setVideoSeekStep = useCallback((value: number) => {
    setVideoSeekStepSec(normalizeVideoSeekStepSec(value))
  }, [])

  const setVideoPlaybackRate = useCallback((value: number) => {
    setVideoPlaybackRateState(normalizeVideoPlaybackRate(value))
  }, [])

  const cycleVideoPlaybackRate = useCallback(() => {
    setVideoPlaybackRateState((previous) => nextVideoPlaybackRate(previous))
  }, [])

  const toggleFaceBboxVisible = useCallback(() => {
    setFaceBboxVisible((previous) => !previous)
  }, [])

  const handleAutoPlayVideoEnded = useCallback(() => {
    const intent = resolvePreviewAutoPlayAdvanceIntent({
      isAutoPlayEligible,
      activeFile: activeMediaFile,
    })
    if (intent.kind === 'none') return
    navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: WRAP_AT_BOUNDARY })
  }, [isAutoPlayEligible, activeMediaFile, navigateMedia])

  const handleAutoPlayVideoPlaybackError = useCallback(() => {
    const intent = resolvePreviewAutoPlayAdvanceIntent({
      isAutoPlayEligible,
      activeFile: activeMediaFile,
    })
    if (intent.kind === 'none') return
    navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: WRAP_AT_BOUNDARY })
  }, [isAutoPlayEligible, activeMediaFile, navigateMedia])

  useEffect(() => {
    const changePlan = resolvePreviewFilteredFilesChangePlan({
      files: filteredFiles,
      collection: mediaCollection,
      preferredPreviewPath: preferredPreviewPathRef.current,
      selectedFile,
      previewFile,
      showPreviewPane,
      playbackOrder,
      shuffleState: {
        queue: shuffleQueue,
        history: shuffleHistory,
      },
    })

    if (changePlan.kind === 'none') return
    if (changePlan.clearPreferredPreviewPath) {
      preferredPreviewPathRef.current = null
    }

    setSelectedFile(changePlan.selection.selectedFile)
    setShowPreviewPane(changePlan.selection.showPreviewPane)
    setPreviewFile(changePlan.selection.previewFile)
    if (changePlan.shuffleState) {
      setShuffleQueue(changePlan.shuffleState.queue)
      setShuffleHistory(changePlan.shuffleState.history)
    }
  }, [
    filteredFiles,
    mediaCollection,
    playbackOrder,
    previewFile,
    selectedFile,
    showPreviewPane,
    shuffleQueue,
    shuffleHistory,
  ])

  useEffect(() => {
    const syncPlan = resolvePreviewShuffleMediaSetSyncPlan({
      collection: mediaCollection,
      playbackOrder,
      activeMediaFile,
      hasOpenPreview: !!previewFile || showPreviewPane,
      shuffleState: {
        queue: shuffleQueue,
        history: shuffleHistory,
      },
      lastShuffleMediaSetKey: lastShuffleMediaSetKeyRef.current,
    })

    if (syncPlan.kind === 'none') return
    if (syncPlan.kind === 'clear-last-shuffle-media-set') {
      lastShuffleMediaSetKeyRef.current = syncPlan.lastShuffleMediaSetKey
      return
    }
    if (syncPlan.kind === 'mark-current-media-set') {
      lastShuffleMediaSetKeyRef.current = syncPlan.lastShuffleMediaSetKey
      return
    }

    setShuffleQueue(syncPlan.shuffleState.queue)
    setShuffleHistory(syncPlan.shuffleState.history)
    lastShuffleMediaSetKeyRef.current = syncPlan.lastShuffleMediaSetKey
  }, [
    playbackOrder,
    mediaCollection,
    activeMediaFile,
    shuffleQueue,
    shuffleHistory,
    previewFile,
    showPreviewPane,
  ])

  useEffect(() => {
    const gateIntent = resolvePreviewAutoPlayGateIntent({
      autoPlayEnabled,
      hasOpenPreview,
      hasActiveMediaPreview,
    })
    if (gateIntent.kind === 'disable-autoplay') {
      setAutoPlayEnabled(false)
    }
  }, [autoPlayEnabled, hasActiveMediaPreview, hasOpenPreview])

  useEffect(() => {
    savePersistedPreviewPlaybackPreferences({
      videoSeekStepSec,
      videoPlaybackRate,
      playbackOrder,
      faceBboxVisible,
    })
  }, [faceBboxVisible, playbackOrder, videoPlaybackRate, videoSeekStepSec])

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

    const timerPlan = resolvePreviewAutoPlayTimerPlan({
      isAutoPlayEligible,
      activeFile: activeMediaFile,
      intervalSec: autoPlayIntervalSec,
    })
    if (timerPlan.kind === 'none') return

    autoPlayTimerRef.current = window.setTimeout(() => {
      navigateMedia(activeMediaFile, 'next', { source: 'autoplay', wrap: WRAP_AT_BOUNDARY })
    }, timerPlan.delayMs)

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
  }
}
