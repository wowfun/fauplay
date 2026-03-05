import {
  useMemo,
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { FixedSizeGrid as Grid } from 'react-window'
import type { FixedSizeGrid as FixedSizeGridType } from 'react-window'
import { FileGridCard } from './FileGridCard'
import type { ThumbnailTaskPriority } from '@/lib/thumbnailPipeline'
import type { FileItem, ThumbnailSizePreset } from '@/types'
import { keyboardShortcuts } from '@/config/shortcuts'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import { FILE_GRID_CARD_SIZE_BY_PRESET, FILE_GRID_GAP } from '@/features/explorer/constants/gridLayout'

interface FileGridViewportProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  thumbnailSizePreset: ThumbnailSizePreset
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
  selectionScopeKey: string
  canClearSelectionWithEscape: boolean
  onSelectionChange: (selectedPaths: string[]) => void
}

export interface FileGridViewportHandle {
  syncSelectedPath: (path: string | null, options?: { scroll?: boolean; focus?: boolean }) => void
}

interface GridRenderWindow {
  overscanColumnStartIndex: number
  overscanColumnStopIndex: number
  overscanRowStartIndex: number
  overscanRowStopIndex: number
  visibleColumnStartIndex: number
  visibleColumnStopIndex: number
  visibleRowStartIndex: number
  visibleRowStopIndex: number
}

interface FocusItemOptions {
  syncPreview: boolean
  updateAnchor: boolean
  applyRangeSelection: boolean
  queuePreviewAfterShiftRelease: boolean
}

const INITIAL_RENDER_WINDOW: GridRenderWindow = {
  overscanColumnStartIndex: 0,
  overscanColumnStopIndex: -1,
  overscanRowStartIndex: 0,
  overscanRowStopIndex: -1,
  visibleColumnStartIndex: 0,
  visibleColumnStopIndex: -1,
  visibleRowStartIndex: 0,
  visibleRowStopIndex: -1,
}

function arePathSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) {
    if (!right.has(item)) return false
  }
  return true
}

export const FileGridViewport = forwardRef<FileGridViewportHandle, FileGridViewportProps>(function FileGridViewport({
  files,
  rootHandle,
  thumbnailSizePreset,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
  selectionScopeKey,
  canClearSelectionWithEscape,
  onSelectionChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<FixedSizeGridType>(null)
  const selectedIndexRef = useRef(0)
  const selectedPathRef = useRef<string | null>(null)
  const selectionAnchorPathRef = useRef<string | null>(null)
  const pendingPreviewPathDuringRangeRef = useRef<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [renderWindow, setRenderWindow] = useState<GridRenderWindow>(INITIAL_RENDER_WINDOW)
  const [selectedPathSet, setSelectedPathSet] = useState<Set<string>>(() => new Set())
  const cardSize = FILE_GRID_CARD_SIZE_BY_PRESET[thumbnailSizePreset]

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

  const setCheckedPathSet = useCallback((updater: (previous: Set<string>) => Set<string>) => {
    setSelectedPathSet((previous) => {
      const next = updater(previous)
      if (arePathSetsEqual(previous, next)) {
        return previous
      }
      return next
    })
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
    return Math.max(1, Math.floor((dimensions.width + FILE_GRID_GAP) / (cardSize.width + FILE_GRID_GAP)))
  }, [dimensions.width, cardSize.width])

  const rowCount = useMemo(() => {
    return Math.ceil(files.length / columnCount)
  }, [files.length, columnCount])

  const pageSize = useMemo(() => {
    const visibleRows = Math.max(1, Math.floor(dimensions.height / (cardSize.height + FILE_GRID_GAP)))
    return visibleRows * columnCount
  }, [dimensions.height, columnCount, cardSize.height])

  const orderedSelectedPaths = useMemo(() => {
    return files.filter((file) => selectedPathSet.has(file.path)).map((file) => file.path)
  }, [files, selectedPathSet])

  useEffect(() => {
    onSelectionChange(orderedSelectedPaths)
  }, [orderedSelectedPaths, onSelectionChange])

  const handleItemsRendered = useCallback((window: GridRenderWindow) => {
    setRenderWindow((previous) => {
      if (
        previous.overscanColumnStartIndex === window.overscanColumnStartIndex &&
        previous.overscanColumnStopIndex === window.overscanColumnStopIndex &&
        previous.overscanRowStartIndex === window.overscanRowStartIndex &&
        previous.overscanRowStopIndex === window.overscanRowStopIndex &&
        previous.visibleColumnStartIndex === window.visibleColumnStartIndex &&
        previous.visibleColumnStopIndex === window.visibleColumnStopIndex &&
        previous.visibleRowStartIndex === window.visibleRowStartIndex &&
        previous.visibleRowStopIndex === window.visibleRowStopIndex
      ) {
        return previous
      }
      return window
    })
  }, [])

  const applyRangeSelection = useCallback((targetIndex: number, options?: { queuePreviewAfterShiftRelease?: boolean }) => {
    if (files.length === 0) return
    const clampedIndex = Math.max(0, Math.min(files.length - 1, targetIndex))
    const targetFile = files[clampedIndex]
    const fallbackAnchor = selectionAnchorPathRef.current ?? selectedPathRef.current ?? targetFile.path
    const anchorIndexByPath = files.findIndex((file) => file.path === fallbackAnchor)
    const anchorIndex = anchorIndexByPath >= 0 ? anchorIndexByPath : clampedIndex
    const rangeStart = Math.min(anchorIndex, clampedIndex)
    const rangeEnd = Math.max(anchorIndex, clampedIndex)
    const nextSet = new Set(
      files.slice(rangeStart, rangeEnd + 1).map((file) => file.path)
    )

    setCheckedPathSet(() => nextSet)
    markSelectedElement(clampedIndex, targetFile.path)

    if (options?.queuePreviewAfterShiftRelease) {
      pendingPreviewPathDuringRangeRef.current = targetFile.kind === 'file' ? targetFile.path : null
    }
  }, [files, markSelectedElement, setCheckedPathSet])

  const focusItem = useCallback((index: number, options: FocusItemOptions) => {
    if (files.length === 0) return

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

    if (options.updateAnchor) {
      selectionAnchorPathRef.current = targetFile.path
    }

    if (options.applyRangeSelection) {
      applyRangeSelection(clampedIndex, {
        queuePreviewAfterShiftRelease: options.queuePreviewAfterShiftRelease,
      })
      return
    }

    pendingPreviewPathDuringRangeRef.current = null

    if (options.syncPreview && targetFile.kind === 'file') {
      onFileClick(targetFile)
    }
  }, [applyRangeSelection, columnCount, files, markSelectedElement, onFileClick])

  const toggleCheckedPath = useCallback((path: string) => {
    setCheckedPathSet((previous) => {
      const next = new Set(previous)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [setCheckedPathSet])

  const clearCheckedPaths = useCallback(() => {
    setCheckedPathSet((previous) => {
      if (previous.size === 0) return previous
      return new Set()
    })
  }, [setCheckedPathSet])

  const selectAllVisiblePaths = useCallback(() => {
    setCheckedPathSet(() => new Set(files.map((file) => file.path)))
  }, [files, setCheckedPathSet])

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
    selectionAnchorPathRef.current = null
    pendingPreviewPathDuringRangeRef.current = null
    clearCheckedPaths()
  }, [clearCheckedPaths, selectionScopeKey])

  useEffect(() => {
    const visiblePathSet = new Set(files.map((file) => file.path))
    setCheckedPathSet((previous) => {
      const next = new Set(
        [...previous].filter((path) => visiblePathSet.has(path))
      )
      return next
    })

    if (selectionAnchorPathRef.current && !visiblePathSet.has(selectionAnchorPathRef.current)) {
      selectionAnchorPathRef.current = null
    }
    if (
      pendingPreviewPathDuringRangeRef.current &&
      !visiblePathSet.has(pendingPreviewPathDuringRangeRef.current)
    ) {
      pendingPreviewPathDuringRangeRef.current = null
    }
  }, [files, setCheckedPathSet])

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
      selectedPathRef.current = files[selectedIndexRef.current]?.path ?? null
    }

    const path = selectedPathRef.current
    if (!path) return

    requestAnimationFrame(() => {
      markSelectedElement(selectedIndexRef.current, path)
    })
  }, [files, markSelectedElement])

  useEffect(() => {
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
      if (event.defaultPrevented || files.length === 0 || isTypingTarget(event.target)) return

      if (matchesAnyShortcut(event, keyboardShortcuts.grid.selectAll)) {
        event.preventDefault()
        selectAllVisiblePaths()
        return
      }

      if (matchesAnyShortcut(event, keyboardShortcuts.grid.clearSelection)) {
        if (canClearSelectionWithEscape && selectedPathSet.size > 0) {
          event.preventDefault()
          clearCheckedPaths()
        }
        return
      }

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
      if (nextIndex < 0) return

      const applyRangeSelectionByKeyboard = event.shiftKey
      focusItem(nextIndex, {
        syncPreview: !applyRangeSelectionByKeyboard,
        updateAnchor: !applyRangeSelectionByKeyboard,
        applyRangeSelection: applyRangeSelectionByKeyboard,
        queuePreviewAfterShiftRelease: applyRangeSelectionByKeyboard,
      })
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return
      const pendingPath = pendingPreviewPathDuringRangeRef.current
      if (!pendingPath) return
      pendingPreviewPathDuringRangeRef.current = null

      const targetFile = files.find((file) => file.path === pendingPath)
      if (targetFile?.kind === 'file') {
        onFileClick(targetFile)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [
    files,
    selectedPathSet.size,
    canClearSelectionWithEscape,
    columnCount,
    pageSize,
    onDirectoryClick,
    onFileDoubleClick,
    onFileClick,
    clearCheckedPaths,
    focusItem,
    selectAllVisiblePaths,
  ])

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
        columnWidth={cardSize.width + FILE_GRID_GAP}
        height={dimensions.height}
        onItemsRendered={handleItemsRendered}
        rowCount={rowCount}
        rowHeight={cardSize.height + FILE_GRID_GAP}
        width={dimensions.width}
        className="scrollbar-thin"
      >
        {({ columnIndex, rowIndex, style }) => {
          const index = rowIndex * columnCount + columnIndex
          if (index >= files.length) return null

          const file = files[index]
          const isVisible =
            rowIndex >= renderWindow.visibleRowStartIndex &&
            rowIndex <= renderWindow.visibleRowStopIndex &&
            columnIndex >= renderWindow.visibleColumnStartIndex &&
            columnIndex <= renderWindow.visibleColumnStopIndex
          const thumbnailPriority: ThumbnailTaskPriority = isVisible ? 'visible' : 'nearby'

          return (
            <div
              style={{
                ...style,
                left: Number(style.left) + FILE_GRID_GAP / 2,
                top: Number(style.top) + FILE_GRID_GAP / 2,
                width: cardSize.width,
                height: cardSize.height,
              }}
            >
              <FileGridCard
                file={file}
                rootHandle={rootHandle}
                itemIndex={index}
                thumbnailSizePreset={thumbnailSizePreset}
                thumbnailPriority={thumbnailPriority}
                isSelected={file.path === selectedPathRef.current}
                isChecked={selectedPathSet.has(file.path)}
                onToggleChecked={(event: ReactMouseEvent<HTMLInputElement>) => {
                  event.stopPropagation()
                  markSelectedElement(index, file.path)

                  if (event.shiftKey) {
                    applyRangeSelection(index)
                    return
                  }

                  selectionAnchorPathRef.current = file.path
                  pendingPreviewPathDuringRangeRef.current = null
                  toggleCheckedPath(file.path)
                }}
                onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                  markSelectedElement(index, file.path)

                  if (event.shiftKey) {
                    applyRangeSelection(index)
                    return
                  }

                  if (event.ctrlKey || event.metaKey) {
                    selectionAnchorPathRef.current = file.path
                    pendingPreviewPathDuringRangeRef.current = null
                    toggleCheckedPath(file.path)
                    return
                  }

                  selectionAnchorPathRef.current = file.path
                  pendingPreviewPathDuringRangeRef.current = null
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
