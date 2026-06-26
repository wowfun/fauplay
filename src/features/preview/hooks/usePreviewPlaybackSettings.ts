import { useCallback, useEffect, useState } from 'react'
import {
  clampAutoPlayIntervalSec,
  DEFAULT_AUTOPLAY_INTERVAL_SEC,
  nextVideoPlaybackRate,
  normalizeVideoPlaybackRate,
  normalizeVideoSeekStepSec,
} from '@/features/preview/lib/previewTraversalModel'
import {
  readPreviewPlaybackPreferences,
  savePreviewPlaybackPreferences,
  type PreviewPlaybackPreferences,
  type PreviewPlaybackPreferencesStorage,
} from '@/features/preview/lib/previewPlaybackPreferences'
import type { PlaybackOrder } from '@/features/preview/types/playback'

function getPreviewPlaybackPreferencesStorage(): PreviewPlaybackPreferencesStorage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function readPersistedPreviewPlaybackPreferences(): PreviewPlaybackPreferences {
  return readPreviewPlaybackPreferences(getPreviewPlaybackPreferencesStorage())
}

function savePersistedPreviewPlaybackPreferences(preferences: PreviewPlaybackPreferences): void {
  savePreviewPlaybackPreferences(getPreviewPlaybackPreferencesStorage(), preferences)
}

export function usePreviewPlaybackSettings() {
  const [autoPlayIntervalSec, setAutoPlayIntervalSec] = useState(DEFAULT_AUTOPLAY_INTERVAL_SEC)
  const [initialPlaybackPreferences] = useState(readPersistedPreviewPlaybackPreferences)
  const [videoSeekStepSec, setVideoSeekStepSec] = useState<number>(() => initialPlaybackPreferences.videoSeekStepSec)
  const [videoPlaybackRate, setVideoPlaybackRateState] = useState<number>(() => initialPlaybackPreferences.videoPlaybackRate)
  const [faceBboxVisible, setFaceBboxVisible] = useState<boolean>(() => initialPlaybackPreferences.faceBboxVisible)
  const [playbackOrder, setPlaybackOrderState] = useState<PlaybackOrder>(() => initialPlaybackPreferences.playbackOrder)

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

  const setPlaybackOrder = useCallback((value: PlaybackOrder) => {
    setPlaybackOrderState(value)
  }, [])

  useEffect(() => {
    savePersistedPreviewPlaybackPreferences({
      videoSeekStepSec,
      videoPlaybackRate,
      playbackOrder,
      faceBboxVisible,
    })
  }, [faceBboxVisible, playbackOrder, videoPlaybackRate, videoSeekStepSec])

  return {
    autoPlayIntervalSec,
    videoSeekStepSec,
    videoPlaybackRate,
    faceBboxVisible,
    playbackOrder,
    setPlaybackOrder,
    setAutoPlayInterval,
    setVideoSeekStep,
    setVideoPlaybackRate,
    cycleVideoPlaybackRate,
    toggleFaceBboxVisible,
  }
}
