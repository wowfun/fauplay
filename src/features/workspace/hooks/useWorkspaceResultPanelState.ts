import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResultPanelDisplayMode } from '@/types'

const DEFAULT_RESULT_PANEL_HEIGHT_PX = 280
const MIN_RESULT_PANEL_HEIGHT_PX = 180

interface WorkspaceResultPanelState {
  isResultPanelOpen: boolean
  setIsResultPanelOpen: (isOpen: boolean) => void
  resultPanelDisplayMode: ResultPanelDisplayMode
  setResultPanelDisplayMode: (mode: ResultPanelDisplayMode | ((previous: ResultPanelDisplayMode) => ResultPanelDisplayMode)) => void
  resultPanelHeightPx: number
  setResultPanelHeightPx: (heightPx: number | ((previous: number) => number)) => void
  lastNormalResultPanelHeightRef: MutableRefObject<number>
  handleResultPanelResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

function getMaxResultPanelHeightPx(): number {
  if (typeof window === 'undefined') {
    return 640
  }
  return Math.max(MIN_RESULT_PANEL_HEIGHT_PX, window.innerHeight - 220)
}

function clampResultPanelHeightPx(value: number): number {
  return Math.min(getMaxResultPanelHeightPx(), Math.max(MIN_RESULT_PANEL_HEIGHT_PX, value))
}

export function useWorkspaceResultPanelState(): WorkspaceResultPanelState {
  const [isResultPanelOpen, setIsResultPanelOpen] = useState(false)
  const [resultPanelDisplayMode, setResultPanelDisplayMode] = useState<ResultPanelDisplayMode>('normal')
  const [resultPanelHeightPx, setResultPanelHeightPx] = useState(DEFAULT_RESULT_PANEL_HEIGHT_PX)
  const lastNormalResultPanelHeightRef = useRef(DEFAULT_RESULT_PANEL_HEIGHT_PX)

  const handleResultPanelResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (resultPanelDisplayMode !== 'normal') return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = resultPanelHeightPx

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = clampResultPanelHeightPx(startHeight + (startY - moveEvent.clientY))
      lastNormalResultPanelHeightRef.current = nextHeight
      setResultPanelHeightPx(nextHeight)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [resultPanelDisplayMode, resultPanelHeightPx])

  useEffect(() => {
    if (resultPanelDisplayMode === 'normal') {
      lastNormalResultPanelHeightRef.current = resultPanelHeightPx
    }
  }, [resultPanelDisplayMode, resultPanelHeightPx])

  useEffect(() => {
    if (resultPanelDisplayMode !== 'normal') return

    const handleResize = () => {
      setResultPanelHeightPx((previous) => clampResultPanelHeightPx(previous))
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [resultPanelDisplayMode])

  return {
    isResultPanelOpen,
    setIsResultPanelOpen,
    resultPanelDisplayMode,
    setResultPanelDisplayMode,
    resultPanelHeightPx,
    setResultPanelHeightPx,
    lastNormalResultPanelHeightRef,
    handleResultPanelResizeStart,
  }
}
