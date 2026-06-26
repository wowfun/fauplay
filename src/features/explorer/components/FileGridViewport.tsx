import {
  useRef,
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
  type FileGridThumbnailPriority,
  resolveFileGridThumbnailPriority,
} from '@/features/explorer/lib/fileGridViewportModel'
import { useFileGridSelectionController } from '@/features/explorer/hooks/useFileGridSelectionController'
import { useFileGridViewportLayout } from '@/features/explorer/hooks/useFileGridViewportLayout'

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
  const gridRef = useRef<FixedSizeGridType>(null)
  const cardSize = FILE_GRID_CARD_SIZE_BY_PRESET[thumbnailSizePreset]
  const {
    containerRef,
    dimensions,
    renderWindow,
    columnCount,
    rowCount,
    pageSize,
    cellWidth,
    cellHeight,
    handleItemsRendered,
  } = useFileGridViewportLayout({
    cardSize,
    gap: FILE_GRID_GAP,
    fileCount: files.length,
    hasNextPage,
    isLoadingNextPage,
    onLoadNextPage,
  })
  const {
    selectedPathSet,
    selectedPathRef,
    marqueeRect,
    handleMarqueePointerDown,
    handleItemToggleChecked,
    handleItemClick,
    handleItemDoubleClick,
    syncSelectedPath,
  } = useFileGridSelectionController({
    files,
    containerRef,
    gridRef,
    columnCount,
    pageSize,
    selectedPaths,
    onSelectionChange,
    selectionScopeKey,
    keyboardNavigationEnabled,
    keyboardShortcuts,
    canClearSelectionWithEscape,
    onDirectoryClick,
    onFileClick,
    onFileDoubleClick,
  })

  useImperativeHandle(ref, () => ({
    syncSelectedPath,
  }), [syncSelectedPath])

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
