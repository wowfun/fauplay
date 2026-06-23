import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  FILE_GRID_CARD_SIZE_BY_PRESET,
  TARGET_GRID_COLUMNS_AT_512_PRESET,
  requiredGridWidthForColumns,
} from '@/features/explorer/constants/gridLayout'
import type { ThumbnailSizePreset } from '@/types'

const MIN_PANE_WIDTH_RATIO = 0.15
const MAX_PANE_WIDTH_RATIO = 0.75
const DEFAULT_PANE_WIDTH_RATIO = 0.375
const PREVIEW_PANE_WIDTH_RATIO_STORAGE_KEY = 'fauplay:preview-pane-width-ratio'

interface PersistedPreviewPaneWidthState {
  ratio: number
  isManual: boolean
}

interface UseWorkspacePreviewPaneWidthParams {
  showPreviewPane: boolean
  thumbnailSizePreset: ThumbnailSizePreset
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

export function useWorkspacePreviewPaneWidth({
  showPreviewPane,
  thumbnailSizePreset,
}: UseWorkspacePreviewPaneWidthParams) {
  const contentRef = useRef<HTMLDivElement>(null)
  const initialPreviewPaneWidthStateRef = useRef<PersistedPreviewPaneWidthState>(loadPersistedPreviewPaneWidthState())
  const isPaneWidthManualRef = useRef(initialPreviewPaneWidthStateRef.current.isManual)
  const [paneWidthRatio, setPaneWidthRatio] = useState(initialPreviewPaneWidthStateRef.current.ratio)

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

  return {
    contentRef,
    paneWidthRatio,
    handlePreviewPaneResizeStart,
  }
}
