import type { FileItem } from '../../../types/index.ts'
import { groupDuplicateProjectionFiles } from './duplicateSelection.ts'

export interface GroupedProjectionRowItem {
  file: FileItem
  index: number
}

export interface GroupedProjectionRow {
  groupId: string
  items: GroupedProjectionRowItem[]
}

export interface GroupedProjectionRowsModel {
  rows: GroupedProjectionRow[]
  encodedLocationByIndex: Array<number | undefined>
}

export interface ResolveGroupedProjectionRangeSelectionParams {
  files: FileItem[]
  targetIndex: number
  anchorPath: string | null | undefined
  fallbackPath: string | null | undefined
}

export interface GroupedProjectionRangeSelection {
  clampedIndex: number
  targetPath: string
  selectedPaths: string[]
}

export type GroupedProjectionKeyboardAction =
  | 'select-all'
  | 'clear-selection'
  | 'move-right'
  | 'move-left'
  | 'move-down'
  | 'move-up'
  | 'page-down'
  | 'page-up'
  | 'open-selected'

export type GroupedProjectionKeyboardIntent =
  | { kind: 'none' }
  | { kind: 'select-all' }
  | { kind: 'clear-selection' }
  | { kind: 'open-selected' }
  | { kind: 'focus-item'; index: number }

export interface ResolveGroupedProjectionKeyboardIntentParams {
  model: GroupedProjectionRowsModel
  action: GroupedProjectionKeyboardAction
  currentIndex: number
  fileCount: number
  pageRowCount: number
  selectedCount: number
  canClearSelectionWithEscape: boolean
}

const ROW_LOCATION_MULTIPLIER = 100000

export function buildGroupedProjectionRowsModel(files: FileItem[]): GroupedProjectionRowsModel {
  const fileIndexByPath = new Map(files.map((file, index) => [file.path, index]))
  const rows = groupDuplicateProjectionFiles(files).map((group) => ({
    groupId: group.groupId,
    items: group.items.map((file) => ({
      file,
      index: fileIndexByPath.get(file.path) ?? 0,
    })),
  }))
  const encodedLocationByIndex = new Array<number | undefined>(files.length)

  rows.forEach((row, rowIndex) => {
    row.items.forEach((item, columnIndex) => {
      encodedLocationByIndex[item.index] = rowIndex * ROW_LOCATION_MULTIPLIER + columnIndex
    })
  })

  return {
    rows,
    encodedLocationByIndex,
  }
}

export function resolveGroupedProjectionVerticalNeighborIndex(
  model: GroupedProjectionRowsModel,
  currentIndex: number,
  deltaRows: number,
): number {
  const encodedLocation = model.encodedLocationByIndex[currentIndex]
  if (encodedLocation === undefined) {
    return currentIndex
  }

  const currentRowIndex = Math.floor(encodedLocation / ROW_LOCATION_MULTIPLIER)
  const currentColumnIndex = encodedLocation % ROW_LOCATION_MULTIPLIER
  const nextRowIndex = Math.max(0, Math.min(model.rows.length - 1, currentRowIndex + deltaRows))
  const nextRow = model.rows[nextRowIndex]
  if (!nextRow) {
    return currentIndex
  }

  const nextColumnIndex = Math.min(currentColumnIndex, nextRow.items.length - 1)
  return nextRow.items[nextColumnIndex]?.index ?? currentIndex
}

export function resolveGroupedProjectionRangeSelection({
  files,
  targetIndex,
  anchorPath,
  fallbackPath,
}: ResolveGroupedProjectionRangeSelectionParams): GroupedProjectionRangeSelection | null {
  if (files.length === 0) return null

  const clampedIndex = Math.max(0, Math.min(files.length - 1, targetIndex))
  const targetFile = files[clampedIndex]
  if (!targetFile) return null

  const fallbackAnchor = anchorPath ?? fallbackPath ?? targetFile.path
  const anchorIndexByPath = files.findIndex((file) => file.path === fallbackAnchor)
  const anchorIndex = anchorIndexByPath >= 0 ? anchorIndexByPath : clampedIndex
  const rangeStart = Math.min(anchorIndex, clampedIndex)
  const rangeEnd = Math.max(anchorIndex, clampedIndex)

  return {
    clampedIndex,
    targetPath: targetFile.path,
    selectedPaths: files.slice(rangeStart, rangeEnd + 1).map((file) => file.path),
  }
}

export function resolveGroupedProjectionKeyboardIntent({
  model,
  action,
  currentIndex,
  fileCount,
  pageRowCount,
  selectedCount,
  canClearSelectionWithEscape,
}: ResolveGroupedProjectionKeyboardIntentParams): GroupedProjectionKeyboardIntent {
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
      return { kind: 'focus-item', index: clampGroupedProjectionIndex(currentIndex + 1, fileCount) }
    case 'move-left':
      return { kind: 'focus-item', index: clampGroupedProjectionIndex(currentIndex - 1, fileCount) }
    case 'move-down':
      return { kind: 'focus-item', index: resolveGroupedProjectionVerticalNeighborIndex(model, currentIndex, 1) }
    case 'move-up':
      return { kind: 'focus-item', index: resolveGroupedProjectionVerticalNeighborIndex(model, currentIndex, -1) }
    case 'page-down':
      return {
        kind: 'focus-item',
        index: resolveGroupedProjectionVerticalNeighborIndex(model, currentIndex, pageRowCount),
      }
    case 'page-up':
      return {
        kind: 'focus-item',
        index: resolveGroupedProjectionVerticalNeighborIndex(model, currentIndex, -pageRowCount),
      }
  }
}

function clampGroupedProjectionIndex(index: number, fileCount: number): number {
  return Math.max(0, Math.min(fileCount - 1, index))
}
