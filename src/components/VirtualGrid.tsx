import { useMemo, useRef, useEffect, useState } from 'react'
import { FixedSizeGrid as Grid } from 'react-window'
import type { FixedSizeGrid as FixedSizeGridType } from 'react-window'
import { FileItemCard } from './FileItemCard'
import type { FileItem } from '@/types'

interface VirtualGridProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
}

const CARD_WIDTH = 160
const CARD_HEIGHT = 180
const GAP = 16

export function VirtualGrid({
  files,
  rootHandle,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
}: VirtualGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<FixedSizeGridType>(null)
  const selectedIndexRef = useRef(0)
  const selectedPathRef = useRef<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  const markSelectedElement = (index: number, path: string) => {
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
  }

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
    return Math.max(1, Math.floor((dimensions.width + GAP) / (CARD_WIDTH + GAP)))
  }, [dimensions.width])

  const rowCount = useMemo(() => {
    return Math.ceil(files.length / columnCount)
  }, [files.length, columnCount])

  const pageSize = useMemo(() => {
    const visibleRows = Math.max(1, Math.floor(dimensions.height / (CARD_HEIGHT + GAP)))
    return visibleRows * columnCount
  }, [dimensions.height, columnCount])

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
  }, [files])

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      )
    }

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
      const key = event.key.toLowerCase()

      switch (key) {
        case 'arrowright':
        case 'd':
          nextIndex = Math.min(files.length - 1, currentIndex + 1)
          break
        case 'arrowleft':
        case 'a':
          nextIndex = Math.max(0, currentIndex - 1)
          break
        case 'arrowdown':
        case 's':
          nextIndex = Math.min(files.length - 1, currentIndex + columnCount)
          break
        case 'arrowup':
        case 'w':
          nextIndex = Math.max(0, currentIndex - columnCount)
          break
        case 'pagedown':
          nextIndex = Math.min(files.length - 1, currentIndex + pageSize)
          break
        case 'pageup':
          nextIndex = Math.max(0, currentIndex - pageSize)
          break
        case 'enter':
          event.preventDefault()
          if (files[currentIndex].kind === 'directory') {
            onDirectoryClick(files[currentIndex].name)
          } else if (onFileDoubleClick) {
            onFileDoubleClick(files[currentIndex])
          } else {
            onFileClick(files[currentIndex])
          }
          return
        default:
          return
      }

      event.preventDefault()
      if (nextIndex >= 0) focusItem(nextIndex)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [files, columnCount, pageSize, onDirectoryClick, onFileDoubleClick, onFileClick])

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
        columnWidth={CARD_WIDTH + GAP}
        height={dimensions.height}
        rowCount={rowCount}
        rowHeight={CARD_HEIGHT + GAP}
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
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
              }}
            >
              <FileItemCard
                file={file}
                rootHandle={rootHandle}
                itemIndex={index}
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
}
