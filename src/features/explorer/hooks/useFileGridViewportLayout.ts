import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type FileGridCardSize,
  type FileGridRenderWindow,
  resolveFileGridRenderWindow,
  resolveFileGridViewportMetrics,
  shouldLoadNextFileGridPage,
} from '@/features/explorer/lib/fileGridViewportModel'

const INITIAL_RENDER_WINDOW: FileGridRenderWindow = {
  overscanColumnStartIndex: 0,
  overscanColumnStopIndex: -1,
  overscanRowStartIndex: 0,
  overscanRowStopIndex: -1,
  visibleColumnStartIndex: 0,
  visibleColumnStopIndex: -1,
  visibleRowStartIndex: 0,
  visibleRowStopIndex: -1,
}

interface UseFileGridViewportLayoutParams {
  cardSize: FileGridCardSize
  gap: number
  fileCount: number
  hasNextPage: boolean
  isLoadingNextPage: boolean
  onLoadNextPage?: () => Promise<void>
}

export function useFileGridViewportLayout({
  cardSize,
  gap,
  fileCount,
  hasNextPage,
  isLoadingNextPage,
  onLoadNextPage,
}: UseFileGridViewportLayoutParams) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [renderWindow, setRenderWindow] = useState<FileGridRenderWindow>(INITIAL_RENDER_WINDOW)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const metrics = useMemo(() => resolveFileGridViewportMetrics({
    dimensions,
    cardSize,
    gap,
    fileCount,
  }), [cardSize, dimensions, fileCount, gap])

  const handleItemsRendered = useCallback((window: FileGridRenderWindow) => {
    setRenderWindow((previous) => resolveFileGridRenderWindow(previous, window))
  }, [])

  useEffect(() => {
    if (!shouldLoadNextFileGridPage({
      hasNextPage,
      isLoadingNextPage,
      canLoadNextPage: Boolean(onLoadNextPage),
      fileCount,
      rowCount: metrics.rowCount,
      overscanRowStopIndex: renderWindow.overscanRowStopIndex,
    })) {
      return
    }

    void onLoadNextPage?.()
  }, [
    fileCount,
    hasNextPage,
    isLoadingNextPage,
    metrics.rowCount,
    onLoadNextPage,
    renderWindow.overscanRowStopIndex,
  ])

  return {
    containerRef,
    dimensions,
    renderWindow,
    handleItemsRendered,
    ...metrics,
  }
}
