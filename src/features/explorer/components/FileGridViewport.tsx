import {
  useMemo,
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react'
import { FixedSizeGrid as Grid } from 'react-window'
import type { FixedSizeGrid as FixedSizeGridType } from 'react-window'
import { FileGridCard } from './FileGridCard'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import type { FileItem, ThumbnailSizePreset } from '@/types'
import { FILE_GRID_CARD_SIZE_BY_PRESET, FILE_GRID_GAP } from '@/features/explorer/constants/gridLayout'
import {
  type FileGridRenderWindow,
  type FileGridThumbnailPriority,
  resolveFileGridRenderWindow,
  resolveFileGridSelectedPathState,
  resolveFileGridThumbnailPriority,
  resolveFileGridTransientSelectionState,
  resolveFileGridViewportMetrics,
  shouldLoadNextFileGridPage,
} from '@/features/explorer/lib/fileGridViewportModel'
import { useFileGridKeyboardNavigation } from '@/features/explorer/hooks/useFileGridKeyboardNavigation'
import { useFileGridItemInteractionHandlers } from '@/features/explorer/hooks/useFileGridItemInteractionHandlers'
import { useGridSelection } from '@/hooks/useGridSelection'

interface FileGridViewportProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  thumbnailSizePreset: ThumbnailSizePreset
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
  selectionScopeKey: string
  canClearSelectionWithEscape: boolean
  keyboardNavigationEnabled?: boolean
  selectedPaths?: string[]
  onSelectionChange: (selectedPaths: string[]) => void
  hasNextPage?: boolean
  isLoadingNextPage?: boolean
  onLoadNextPage?: () => Promise<void>
}

export interface FileGridViewportHandle {
  syncSelectedPath: (path: string | null, options?: { scroll?: boolean; focus?: boolean }) => void
}

interface FocusItemOptions {
  syncPreview: boolean
  updateAnchor: boolean
  applyRangeSelection: boolean
  queuePreviewAfterShiftRelease: boolean
}

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

function getFileSelectionId(file: FileItem): string {
  return file.path
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
  keyboardNavigationEnabled = true,
  selectedPaths,
  onSelectionChange,
  hasNextPage = false,
  isLoadingNextPage = false,
  onLoadNextPage,
}, ref) {
  const keyboardShortcuts = useKeyboardShortcuts()
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<FixedSizeGridType>(null)
  const selectedIndexRef = useRef(0)
  const selectedPathRef = useRef<string | null>(null)
  const selectionAnchorPathRef = useRef<string | null>(null)
  const pendingPreviewPathDuringRangeRef = useRef<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [renderWindow, setRenderWindow] = useState<FileGridRenderWindow>(INITIAL_RENDER_WINDOW)
  const cardSize = FILE_GRID_CARD_SIZE_BY_PRESET[thumbnailSizePreset]
  const {
    selectedIdSet: selectedPathSet,
    marqueeRect,
    clearSelection,
    selectAll,
    toggleSelection,
    setAnchorId,
    resetAnchor,
    selectRangeToId,
    handleMarqueePointerDown,
    shouldSuppressClick,
  } = useGridSelection({
    items: files,
    getId: getFileSelectionId,
    selectedIds: selectedPaths ?? null,
    onSelectionChange,
    containerRef,
  })

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

  const {
    columnCount,
    rowCount,
    pageSize,
    cellWidth,
    cellHeight,
  } = useMemo(() => resolveFileGridViewportMetrics({
    dimensions,
    cardSize,
    gap: FILE_GRID_GAP,
    fileCount: files.length,
  }), [cardSize, dimensions, files.length])

  const handleItemsRendered = useCallback((window: FileGridRenderWindow) => {
    setRenderWindow((previous) => {
      return resolveFileGridRenderWindow(previous, window)
    })
  }, [])

  useEffect(() => {
    if (!shouldLoadNextFileGridPage({
      hasNextPage,
      isLoadingNextPage,
      canLoadNextPage: Boolean(onLoadNextPage),
      fileCount: files.length,
      rowCount,
      overscanRowStopIndex: renderWindow.overscanRowStopIndex,
    })) {
      return
    }

    void onLoadNextPage?.()
  }, [
    files.length,
    hasNextPage,
    isLoadingNextPage,
    onLoadNextPage,
    renderWindow.overscanRowStopIndex,
    rowCount,
  ])

  const applyRangeSelection = useCallback((targetIndex: number, options?: { queuePreviewAfterShiftRelease?: boolean }) => {
    if (files.length === 0) return
    const clampedIndex = Math.max(0, Math.min(files.length - 1, targetIndex))
    const targetFile = files[clampedIndex]
    const fallbackAnchor = selectionAnchorPathRef.current ?? selectedPathRef.current ?? targetFile.path
    if (!selectionAnchorPathRef.current) {
      selectionAnchorPathRef.current = fallbackAnchor
      setAnchorId(fallbackAnchor)
    }
    selectRangeToId(targetFile.path)
    markSelectedElement(clampedIndex, targetFile.path)

    if (options?.queuePreviewAfterShiftRelease) {
      pendingPreviewPathDuringRangeRef.current = targetFile.kind === 'file' ? targetFile.path : null
    }
  }, [files, markSelectedElement, selectRangeToId, setAnchorId])

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
      setAnchorId(targetFile.path)
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
  }, [applyRangeSelection, columnCount, files, markSelectedElement, onFileClick, setAnchorId])

  const clearCheckedPaths = useCallback(() => {
    clearSelection()
  }, [clearSelection])

  const selectAllVisiblePaths = useCallback(() => {
    selectAll()
  }, [selectAll])

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
    resetAnchor()
    pendingPreviewPathDuringRangeRef.current = null
    if (selectedPaths) {
      return
    }
    clearCheckedPaths()
  }, [clearCheckedPaths, resetAnchor, selectedPaths, selectionScopeKey])

  useEffect(() => {
    const nextState = resolveFileGridTransientSelectionState({
      files,
      selectionAnchorPath: selectionAnchorPathRef.current,
      pendingPreviewPathDuringRange: pendingPreviewPathDuringRangeRef.current,
    })

    selectionAnchorPathRef.current = nextState.selectionAnchorPath
    pendingPreviewPathDuringRangeRef.current = nextState.pendingPreviewPathDuringRange

    if (nextState.shouldResetAnchor) {
      resetAnchor()
    }
  }, [files, resetAnchor])

  useEffect(() => {
    const nextState = resolveFileGridSelectedPathState({
      files,
      selectedIndex: selectedIndexRef.current,
      selectedPath: selectedPathRef.current,
    })
    selectedIndexRef.current = nextState.selectedIndex
    selectedPathRef.current = nextState.selectedPath

    const path = selectedPathRef.current
    if (!path) return

    requestAnimationFrame(() => {
      markSelectedElement(selectedIndexRef.current, path)
    })
  }, [files, markSelectedElement])

  useFileGridKeyboardNavigation({
    enabled: keyboardNavigationEnabled,
    keyboardShortcuts,
    files,
    selectedIndexRef,
    pendingPreviewPathDuringRangeRef,
    selectedCount: selectedPathSet.size,
    canClearSelectionWithEscape,
    columnCount,
    pageSize,
    onSelectAll: selectAllVisiblePaths,
    onClearSelection: clearCheckedPaths,
    onFocusItem: focusItem,
    onDirectoryClick,
    onFileClick,
    onFileDoubleClick,
  })

  const {
    handleItemToggleChecked,
    handleItemClick,
    handleItemDoubleClick,
  } = useFileGridItemInteractionHandlers({
    markSelectedElement,
    applyRangeSelection,
    selectionAnchorPathRef,
    pendingPreviewPathDuringRangeRef,
    setAnchorId,
    toggleSelection,
    shouldSuppressClick,
    onDirectoryClick,
    onFileClick,
    onFileDoubleClick,
  })

  if (files.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
        <p>没有文件</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onPointerDown={handleMarqueePointerDown}
    >
      {marqueeRect && (
        <div
          className="pointer-events-none fixed z-[70] rounded-sm border border-primary bg-primary/15"
          style={marqueeRect}
        />
      )}
      <Grid
        ref={gridRef}
        columnCount={columnCount}
        columnWidth={cellWidth}
        height={dimensions.height}
        onItemsRendered={handleItemsRendered}
        rowCount={rowCount}
        rowHeight={cellHeight}
        width={dimensions.width}
        className="scrollbar-thin"
      >
        {({ columnIndex, rowIndex, style }) => {
          const index = rowIndex * columnCount + columnIndex
          if (index >= files.length) return null

          const file = files[index]
          const thumbnailPriority: FileGridThumbnailPriority = resolveFileGridThumbnailPriority({
            rowIndex,
            columnIndex,
            renderWindow,
          })

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
                onToggleChecked={(event) => {
                  handleItemToggleChecked(file, index, event)
                }}
                onClick={(event) => {
                  handleItemClick(file, index, event)
                }}
                onDoubleClick={() => {
                  handleItemDoubleClick(file)
                }}
              />
            </div>
          )
        }}
      </Grid>
    </div>
  )
})
