import { useCallback, useEffect } from 'react'

type PreviewVideoSurface = 'lightbox' | 'panel'

interface UseActivePreviewVideoControlsParams {
  preferredSurface: PreviewVideoSurface
  seekStepSec: number
  playbackRate: number
  enabled: boolean
}

interface ActivePreviewVideoControls {
  toggleActivePreviewVideoPlayback: () => boolean
  seekActivePreviewVideo: (direction: 'backward' | 'forward') => boolean
}

export function useActivePreviewVideoControls({
  preferredSurface,
  seekStepSec,
  playbackRate,
  enabled,
}: UseActivePreviewVideoControlsParams): ActivePreviewVideoControls {
  const getActivePreviewVideoElement = useCallback((): HTMLVideoElement | null => {
    const preferredSelector = `video[data-preview-video="true"][data-preview-video-surface="${preferredSurface}"]`
    return (
      document.querySelector<HTMLVideoElement>(preferredSelector)
      ?? document.querySelector<HTMLVideoElement>('video[data-preview-video="true"]')
    )
  }, [preferredSurface])

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
    const delta = direction === 'backward' ? -seekStepSec : seekStepSec
    const nextTime = Math.min(duration, Math.max(0, baseCurrentTime + delta))
    videoElement.currentTime = nextTime
    return true
  }, [getActivePreviewVideoElement, seekStepSec])

  useEffect(() => {
    if (!enabled) return
    applyVideoPlaybackRateToActivePreviewVideo(playbackRate)
  }, [applyVideoPlaybackRateToActivePreviewVideo, enabled, playbackRate])

  return {
    toggleActivePreviewVideoPlayback,
    seekActivePreviewVideo,
  }
}
