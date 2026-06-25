export interface FileGridViewportDimensions {
  width: number
  height: number
}

export interface FileGridCardSize {
  width: number
  height: number
}

export interface ResolveFileGridViewportMetricsParams {
  dimensions: FileGridViewportDimensions
  cardSize: FileGridCardSize
  gap: number
  fileCount: number
}

export interface FileGridViewportMetrics {
  columnCount: number
  rowCount: number
  pageSize: number
  cellWidth: number
  cellHeight: number
}

export interface ShouldLoadNextFileGridPageParams {
  hasNextPage: boolean
  isLoadingNextPage: boolean
  canLoadNextPage: boolean
  fileCount: number
  rowCount: number
  overscanRowStopIndex: number
}

export type FileGridKeyboardAction =
  | 'select-all'
  | 'clear-selection'
  | 'move-right'
  | 'move-left'
  | 'move-down'
  | 'move-up'
  | 'page-down'
  | 'page-up'
  | 'open-selected'

export type FileGridKeyboardIntent =
  | { kind: 'none' }
  | { kind: 'select-all' }
  | { kind: 'clear-selection' }
  | { kind: 'open-selected' }
  | { kind: 'focus-item'; index: number }

export interface ResolveFileGridKeyboardIntentParams {
  action: FileGridKeyboardAction
  currentIndex: number
  fileCount: number
  columnCount: number
  pageSize: number
  selectedCount: number
  canClearSelectionWithEscape: boolean
}

export function resolveFileGridViewportMetrics({
  dimensions,
  cardSize,
  gap,
  fileCount,
}: ResolveFileGridViewportMetricsParams): FileGridViewportMetrics {
  const cellWidth = cardSize.width + gap
  const cellHeight = cardSize.height + gap
  const columnCount = Math.max(1, Math.floor((dimensions.width + gap) / cellWidth))
  const rowCount = Math.ceil(Math.max(0, fileCount) / columnCount)
  const visibleRows = Math.max(1, Math.floor(dimensions.height / cellHeight))

  return {
    columnCount,
    rowCount,
    pageSize: visibleRows * columnCount,
    cellWidth,
    cellHeight,
  }
}

export function shouldLoadNextFileGridPage({
  hasNextPage,
  isLoadingNextPage,
  canLoadNextPage,
  fileCount,
  rowCount,
  overscanRowStopIndex,
}: ShouldLoadNextFileGridPageParams): boolean {
  if (!hasNextPage || isLoadingNextPage || !canLoadNextPage) return false
  if (fileCount <= 0 || rowCount <= 0) return false

  const preloadThresholdRow = Math.max(0, rowCount - 2)
  return overscanRowStopIndex >= preloadThresholdRow
}

export function resolveFileGridKeyboardIntent({
  action,
  currentIndex,
  fileCount,
  columnCount,
  pageSize,
  selectedCount,
  canClearSelectionWithEscape,
}: ResolveFileGridKeyboardIntentParams): FileGridKeyboardIntent {
  if (fileCount <= 0) return { kind: 'none' }

  switch (action) {
    case 'select-all':
      return { kind: 'select-all' }
    case 'clear-selection':
      return canClearSelectionWithEscape && selectedCount > 0
        ? { kind: 'clear-selection' }
        : { kind: 'none' }
    case 'open-selected':
      return { kind: 'open-selected' }
    case 'move-right':
      return { kind: 'focus-item', index: clampGridIndex(currentIndex + 1, fileCount) }
    case 'move-left':
      return { kind: 'focus-item', index: clampGridIndex(currentIndex - 1, fileCount) }
    case 'move-down':
      return { kind: 'focus-item', index: clampGridIndex(currentIndex + columnCount, fileCount) }
    case 'move-up':
      return { kind: 'focus-item', index: clampGridIndex(currentIndex - columnCount, fileCount) }
    case 'page-down':
      return { kind: 'focus-item', index: clampGridIndex(currentIndex + pageSize, fileCount) }
    case 'page-up':
      return { kind: 'focus-item', index: clampGridIndex(currentIndex - pageSize, fileCount) }
  }
}

function clampGridIndex(index: number, fileCount: number): number {
  return Math.max(0, Math.min(fileCount - 1, index))
}
