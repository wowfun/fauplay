import { useMemo, useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { FixedSizeGrid as Grid } from 'react-window'
import type { FixedSizeGrid as FixedSizeGridType } from 'react-window'
import { FileGridCard } from './FileGridCard'
import type { FileItem, ThumbnailSizePreset } from '@/types'
import { keyboardShortcuts } from '@/config/shortcuts'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'

interface FileGridViewportProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  thumbnailSizePreset: ThumbnailSizePreset
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
}

export interface FileGridViewportHandle {
  syncSelectedPath: (path: string | null, options?: { scroll?: boolean; focus?: boolean }) => void
}

const GAP = 16

const CARD_SIZE_BY_PRESET: Record<ThumbnailSizePreset, { width: number; height: number }> = {
  auto: { width: 160, height: 180 },
  '256': { width: 256, height: 256 },
  '512': { width: 512, height: 512 },
}

export const FileGridViewport = forwardRef<FileGridViewportHandle, FileGridViewportProps>(function FileGridViewport({
  files,
  rootHandle,
  thumbnailSizePreset,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<FixedSizeGridType>(null)
  const selectedIndexRef = useRef(0)
  const selectedPathRef = useRef<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const cardSize = CARD_SIZE_BY_PRESET[thumbnailSizePreset]

  const markSelectedElement = useCallback((index: number, path: string) => {
    selectedIndexRef.current = index
    selectedPathRef.current = path

    const container = containerRef.current
    if (!container) return

    const prev = container.querySelector<HTMLButtonElement>('[data-grid-selected="true"]')
    if (prev) {
      prev.setAttribute('data-grid-selected', 'false')
    }

    const next = container.querySelector<HTMLButtonElement>(`[data-grid-index="${index}"]`)
    if (next) {
      next.setAttribute('data-grid-selected', 'true')
    }
  }, [])

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

  const columnCount = useMemo(() => {
    return Math.max(1, Math.floor((dimensions.width + GAP) / (cardSize.width + GAP)))
  }, [dimensions.width, cardSize.width])

  const rowCount = useMemo(() => {
    return Math.ceil(files.length / columnCount)
  }, [files.length, columnCount])

  const pageSize = useMemo(() => {
    const visibleRows = Math.max(1, Math.floor(dimensions.height / (cardSize.height + GAP)))
    return visibleRows * columnCount
  }, [dimensions.height, columnCount, cardSize.height])

  const syncSelectedPath = useCallback((
    path: string | null,
    options?: { scroll?: boolean; focus?: boolean }
  ) => {
    if (!path || files.length === 0) return

    const selectedIndex = files.findIndex((item) => item.path === path)
    if (selectedIndex < 0) return
    if (
      selectedIndexRef.current === selectedIndex &&
      selectedPathRef.current === path
    ) {
      return
    }

    selectedIndexRef.current = selectedIndex
    selectedPathRef.current = path
    markSelectedElement(selectedIndex, path)

    if (options?.scroll !== false) {
      gridRef.current?.scrollToItem({
        rowIndex: Math.floor(selectedIndex / columnCount),
        columnIndex: selectedIndex % columnCount,
        align: 'smart',
      })
    }

    if (options?.focus) {
      requestAnimationFrame(() => {
        const element = containerRef.current?.querySelector<HTMLButtonElement>(
          `[data-grid-index="${selectedIndex}"]`
        )
        element?.focus({ preventScroll: true })
      })
    }
  }, [files, columnCount, markSelectedElement])

  useImperativeHandle(ref, () => ({
    syncSelectedPath,
  }), [syncSelectedPath])

  useEffect(() => {
    if (files.length === 0) {
      selectedIndexRef.current = 0
      selectedPathRef.current = null
      return
    }
    const selectedPath = selectedPathRef.current
    if (selectedPath) {
      const selectedIndexByPath = files.findIndex((item) => item.path === selectedPath)
      if (selectedIndexByPath >= 0) {
        selectedIndexRef.current = selectedIndexByPath
      } else {
        selectedIndexRef.current = Math.min(selectedIndexRef.current, files.length - 1)
        selectedPathRef.current = files[selectedIndexRef.current]?.path ?? null
      }
    } else {
      selectedIndexRef.current = Math.min(selectedIndexRef.current, files.length - 1)
    }

    const path = selectedPathRef.current
    if (!path) return

    requestAnimationFrame(() => {
      markSelectedElement(selectedIndexRef.current, path)
    })
  }, [files, markSelectedElement])

  useEffect(() => {
    const focusItem = (index: number) => {
      const clampedIndex = Math.max(0, Math.min(files.length - 1, index))
      const targetFile = files[clampedIndex]
      markSelectedElement(clampedIndex, targetFile.path)

      gridRef.current?.scrollToItem({
        rowIndex: Math.floor(clampedIndex / columnCount),
        columnIndex: clampedIndex % columnCount,
        align: 'smart',
      })

      requestAnimationFrame(() => {
        const element = containerRef.current?.querySelector<HTMLButtonElement>(
          `[data-grid-index="${clampedIndex}"]`
        )
        element?.focus({ preventScroll: true })
      })

      // Keep preview pane in sync with keyboard selection for files.
      if (targetFile.kind === 'file') {
        onFileClick(targetFile)
      }
    }

    const getCurrentIndex = () => {
      const active = document.activeElement as HTMLElement | null
      const rawIndex = active?.dataset?.gridIndex
      if (rawIndex === undefined) {
        return selectedIndexRef.current
      }
      const index = Number(rawIndex)
      return Number.isNaN(index) ? selectedIndexRef.current : index
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (files.length === 0 || isTypingTarget(event.target)) return

      let nextIndex = -1
      const currentIndex = getCurrentIndex()

      if (matchesAnyShortcut(event, keyboardShortcuts.grid.moveRight)) {
        nextIndex = Math.min(files.length - 1, currentIndex + 1)
      } else if (matchesAnyShortcut(event, keyboardShortcuts.grid.moveLeft)) {
        nextIndex = Math.max(0, currentIndex - 1)
      } else if (matchesAnyShortcut(event, keyboardShortcuts.grid.moveDown)) {
        nextIndex = Math.min(files.length - 1, currentIndex + columnCount)
      } else if (matchesAnyShortcut(event, keyboardShortcuts.grid.moveUp)) {
        nextIndex = Math.max(0, currentIndex - columnCount)
      } else if (matchesAnyShortcut(event, keyboardShortcuts.grid.pageDown)) {
        nextIndex = Math.min(files.length - 1, currentIndex + pageSize)
      } else if (matchesAnyShortcut(event, keyboardShortcuts.grid.pageUp)) {
        nextIndex = Math.max(0, currentIndex - pageSize)
      } else if (matchesAnyShortcut(event, keyboardShortcuts.grid.openSelected)) {
        event.preventDefault()
        if (files[currentIndex].kind === 'directory') {
          onDirectoryClick(files[currentIndex].name)
        } else if (onFileDoubleClick) {
          onFileDoubleClick(files[currentIndex])
        } else {
          onFileClick(files[currentIndex])
        }
        return
      } else {
        return
      }

      event.preventDefault()
      if (nextIndex >= 0) focusItem(nextIndex)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [files, columnCount, pageSize, onDirectoryClick, onFileDoubleClick, onFileClick, markSelectedElement])

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>没有文件</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden">
      <Grid
        ref={gridRef}
        columnCount={columnCount}
        columnWidth={cardSize.width + GAP}
        height={dimensions.height}
        rowCount={rowCount}
        rowHeight={cardSize.height + GAP}
        width={dimensions.width}
        className="scrollbar-thin"
      >
        {({ columnIndex, rowIndex, style }) => {
          const index = rowIndex * columnCount + columnIndex
          if (index >= files.length) return null

          const file = files[index]

          return (
            <div
              style={{
                ...style,
                left: Number(style.left) + GAP / 2,
                top: Number(style.top) + GAP / 2,
                width: cardSize.width,
                height: cardSize.height,
              }}
            >
              <FileGridCard
                file={file}
                rootHandle={rootHandle}
                itemIndex={index}
                thumbnailSizePreset={thumbnailSizePreset}
                isSelected={file.path === selectedPathRef.current}
                onClick={() => {
                  markSelectedElement(index, file.path)
                  if (file.kind === 'directory') {
                    onDirectoryClick(file.name)
                  } else {
                    onFileClick(file)
                  }
                }}
                onDoubleClick={() => {
                  if (file.kind === 'file' && onFileDoubleClick) {
                    onFileDoubleClick(file)
                  }
                }}
              />
            </div>
          )
        }}
      </Grid>
    </div>
  )
})
