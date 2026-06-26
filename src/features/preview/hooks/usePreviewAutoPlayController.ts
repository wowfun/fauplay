import { useCallback, useEffect, useRef, useState } from 'react'
import {
  resolvePreviewAutoPlayAdvanceIntent,
  resolvePreviewAutoPlayEligibility,
  resolvePreviewAutoPlayGateIntent,
  resolvePreviewAutoPlayTimerPlan,
} from '@/features/preview/lib/previewAutoPlayModel'
import type { FileItem } from '@/types'

interface UsePreviewAutoPlayControllerOptions {
  activeMediaFile: FileItem | null
  autoPlayIntervalSec: number
  hasActiveMediaPreview: boolean
  hasOpenPreview: boolean
  mediaCount: number
  onAdvance: () => void
}

export function usePreviewAutoPlayController({
  activeMediaFile,
  autoPlayIntervalSec,
  hasActiveMediaPreview,
  hasOpenPreview,
  mediaCount,
  onAdvance,
}: UsePreviewAutoPlayControllerOptions) {
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false)
  const [autoPlayPausedByVisibility, setAutoPlayPausedByVisibility] = useState(false)
  const autoPlayTimerRef = useRef<number | null>(null)

  const isAutoPlayEligible = resolvePreviewAutoPlayEligibility({
    autoPlayEnabled,
    pausedByVisibility: autoPlayPausedByVisibility,
    hasActiveMediaPreview,
    mediaCount,
  })

  const toggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled((previous) => !previous)
  }, [])

  const handleAutoPlayAdvance = useCallback(() => {
    const intent = resolvePreviewAutoPlayAdvanceIntent({
      isAutoPlayEligible,
      activeFile: activeMediaFile,
    })
    if (intent.kind === 'none') return
    onAdvance()
  }, [activeMediaFile, isAutoPlayEligible, onAdvance])

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
    if (typeof document === 'undefined' || typeof window === 'undefined') return

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
    if (autoPlayTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(autoPlayTimerRef.current)
      autoPlayTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    clearAutoPlayTimer()

    if (typeof window === 'undefined') return
    const timerPlan = resolvePreviewAutoPlayTimerPlan({
      isAutoPlayEligible,
      activeFile: activeMediaFile,
      intervalSec: autoPlayIntervalSec,
    })
    if (timerPlan.kind === 'none') return

    autoPlayTimerRef.current = window.setTimeout(() => {
      onAdvance()
    }, timerPlan.delayMs)

    return clearAutoPlayTimer
  }, [
    clearAutoPlayTimer,
    isAutoPlayEligible,
    activeMediaFile,
    autoPlayIntervalSec,
    onAdvance,
  ])

  return {
    autoPlayEnabled,
    toggleAutoPlay,
    handleAutoPlayVideoEnded: handleAutoPlayAdvance,
    handleAutoPlayVideoPlaybackError: handleAutoPlayAdvance,
  }
}
