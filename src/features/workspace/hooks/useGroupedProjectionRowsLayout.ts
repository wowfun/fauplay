import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { FILE_GRID_GAP } from '@/features/explorer/constants/gridLayout'

interface UseGroupedProjectionRowsLayoutParams {
  cardHeight: number
}

export function useGroupedProjectionRowsLayout({
  cardHeight,
}: UseGroupedProjectionRowsLayoutParams) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const pageRowCount = useMemo(() => {
    const rowHeight = cardHeight + FILE_GRID_GAP
    return Math.max(1, Math.floor(containerHeight / rowHeight))
  }, [cardHeight, containerHeight])

  const handleHorizontalRowWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.shiftKey) {
      return
    }
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    event.preventDefault()
    container.scrollTop += event.deltaY
  }, [])

  return {
    containerRef,
    pageRowCount,
    handleHorizontalRowWheel,
  }
}
