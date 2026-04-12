import { useEffect, useState } from 'react'
import type { ViewportMode } from '@/features/workspace/types/presentation'

const COMPACT_VIEWPORT_MEDIA_QUERY = '(max-width: 768px)'

function readViewportMode(): ViewportMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'wide'
  }

  return window.matchMedia(COMPACT_VIEWPORT_MEDIA_QUERY).matches ? 'compact' : 'wide'
}

export function useViewportMode(): ViewportMode {
  const [viewportMode, setViewportMode] = useState<ViewportMode>(() => readViewportMode())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia(COMPACT_VIEWPORT_MEDIA_QUERY)
    const applyViewportMode = () => {
      setViewportMode(mediaQuery.matches ? 'compact' : 'wide')
    }

    applyViewportMode()
    mediaQuery.addEventListener('change', applyViewportMode)
    return () => mediaQuery.removeEventListener('change', applyViewportMode)
  }, [])

  return viewportMode
}
