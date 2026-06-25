export interface FileGridViewportDimensions {
  width: number
  height: number
}

export interface FileGridPathEntry {
  path: string
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

export interface FileGridRenderWindow {
  overscanColumnStartIndex: number
  overscanColumnStopIndex: number
  overscanRowStartIndex: number
  overscanRowStopIndex: number
  visibleColumnStartIndex: number
  visibleColumnStopIndex: number
  visibleRowStartIndex: number
  visibleRowStopIndex: number
}

export type FileGridThumbnailPriority = 'visible' | 'nearby'

export interface ResolveFileGridThumbnailPriorityParams {
  rowIndex: number
  columnIndex: number
  renderWindow: FileGridRenderWindow
}

export interface ResolveFileGridSelectedPathStateParams {
  files: readonly FileGridPathEntry[]
  selectedIndex: number
  selectedPath: string | null
}

export interface FileGridSelectedPathState {
  selectedIndex: number
  selectedPath: string | null
}

export interface ResolveFileGridTransientSelectionStateParams {
  files: readonly FileGridPathEntry[]
  selectionAnchorPath: string | null
  pendingPreviewPathDuringRange: string | null
}

export interface FileGridTransientSelectionState {
  selectionAnchorPath: string | null
  pendingPreviewPathDuringRange: string | null
  shouldResetAnchor: boolean
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

export function resolveFileGridRenderWindow(
  previous: FileGridRenderWindow,
  next: FileGridRenderWindow,
): FileGridRenderWindow {
  return areFileGridRenderWindowsEqual(previous, next) ? previous : next
}

export function resolveFileGridThumbnailPriority({
  rowIndex,
  columnIndex,
  renderWindow,
}: ResolveFileGridThumbnailPriorityParams): FileGridThumbnailPriority {
  const isVisible =
    rowIndex >= renderWindow.visibleRowStartIndex &&
    rowIndex <= renderWindow.visibleRowStopIndex &&
    columnIndex >= renderWindow.visibleColumnStartIndex &&
    columnIndex <= renderWindow.visibleColumnStopIndex

  return isVisible ? 'visible' : 'nearby'
}

export function resolveFileGridSelectedPathState({
  files,
  selectedIndex,
  selectedPath,
}: ResolveFileGridSelectedPathStateParams): FileGridSelectedPathState {
  if (files.length === 0) {
    return {
      selectedIndex: 0,
      selectedPath: null,
    }
  }

  if (selectedPath) {
    const selectedIndexByPath = files.findIndex((item) => item.path === selectedPath)
    if (selectedIndexByPath >= 0) {
      return {
        selectedIndex: selectedIndexByPath,
        selectedPath,
      }
    }
  }

  const nextSelectedIndex = clampGridIndex(selectedIndex, files.length)
  return {
    selectedIndex: nextSelectedIndex,
    selectedPath: files[nextSelectedIndex]?.path ?? null,
  }
}

export function resolveFileGridTransientSelectionState({
  files,
  selectionAnchorPath,
  pendingPreviewPathDuringRange,
}: ResolveFileGridTransientSelectionStateParams): FileGridTransientSelectionState {
  const visiblePathSet = new Set(files.map((file) => file.path))
  const nextSelectionAnchorPath = selectionAnchorPath && !visiblePathSet.has(selectionAnchorPath)
    ? null
    : selectionAnchorPath
  const nextPendingPreviewPathDuringRange = pendingPreviewPathDuringRange &&
    !visiblePathSet.has(pendingPreviewPathDuringRange)
    ? null
    : pendingPreviewPathDuringRange

  return {
    selectionAnchorPath: nextSelectionAnchorPath,
    pendingPreviewPathDuringRange: nextPendingPreviewPathDuringRange,
    shouldResetAnchor: Boolean(selectionAnchorPath && !nextSelectionAnchorPath),
  }
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

function areFileGridRenderWindowsEqual(left: FileGridRenderWindow, right: FileGridRenderWindow): boolean {
  return left.overscanColumnStartIndex === right.overscanColumnStartIndex &&
    left.overscanColumnStopIndex === right.overscanColumnStopIndex &&
    left.overscanRowStartIndex === right.overscanRowStartIndex &&
    left.overscanRowStopIndex === right.overscanRowStopIndex &&
    left.visibleColumnStartIndex === right.visibleColumnStartIndex &&
    left.visibleColumnStopIndex === right.visibleColumnStopIndex &&
    left.visibleRowStartIndex === right.visibleRowStartIndex &&
    left.visibleRowStopIndex === right.visibleRowStopIndex
}

function clampGridIndex(index: number, fileCount: number): number {
  return Math.max(0, Math.min(fileCount - 1, index))
}
