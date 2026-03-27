import { toToolScopedProjectionId } from '@/lib/projection'
import type { FileItem, ResultProjection } from '@/types'

export type DuplicateSelectionRule = 'keep_newest' | 'keep_oldest' | 'keep_current_or_first'

export interface DuplicateProjectionGroup {
  groupId: string
  index: number
  items: FileItem[]
}

const DUPLICATE_FILES_TOOL_NAME = 'data.findDuplicateFiles'
const DUPLICATE_FILES_PROJECTION_ID = toToolScopedProjectionId(DUPLICATE_FILES_TOOL_NAME)

function hasStableGroupIds(files: FileItem[]): boolean {
  return files.length > 0 && files.every((file) => typeof file.groupId === 'string' && file.groupId.length > 0)
}

function toFiniteTimestamp(value: number | undefined): number | null {
  return Number.isFinite(value) ? Number(value) : null
}

export function isDuplicateProjection(projection: ResultProjection | null | undefined): projection is ResultProjection {
  return Boolean(
    projection
    && projection.id === DUPLICATE_FILES_PROJECTION_ID
    && projection.ordering?.mode === 'group_contiguous'
    && hasStableGroupIds(projection.files)
  )
}

export function groupDuplicateProjectionFiles(files: FileItem[]): DuplicateProjectionGroup[] {
  const groups: DuplicateProjectionGroup[] = []
  let currentGroup: DuplicateProjectionGroup | null = null

  files.forEach((file) => {
    const groupId = file.groupId ?? file.path
    if (!currentGroup || currentGroup.groupId !== groupId) {
      currentGroup = {
        groupId,
        index: groups.length,
        items: [],
      }
      groups.push(currentGroup)
    }

    currentGroup.items.push(file)
  })

  return groups
}

function resolveKeepNewestIndex(items: FileItem[]): number {
  let anchorIndex = 0
  let bestTimestamp = toFiniteTimestamp(items[0]?.lastModifiedMs)

  for (let index = 1; index < items.length; index += 1) {
    const candidateTimestamp = toFiniteTimestamp(items[index]?.lastModifiedMs)
    if (candidateTimestamp === null) continue
    if (bestTimestamp === null || candidateTimestamp > bestTimestamp) {
      anchorIndex = index
      bestTimestamp = candidateTimestamp
    }
  }

  return anchorIndex
}

function resolveKeepOldestIndex(items: FileItem[]): number {
  let anchorIndex = 0
  let bestTimestamp = toFiniteTimestamp(items[0]?.lastModifiedMs)

  for (let index = 1; index < items.length; index += 1) {
    const candidateTimestamp = toFiniteTimestamp(items[index]?.lastModifiedMs)
    if (candidateTimestamp === null) continue
    if (bestTimestamp === null || candidateTimestamp < bestTimestamp) {
      anchorIndex = index
      bestTimestamp = candidateTimestamp
    }
  }

  return anchorIndex
}

function resolveKeepCurrentOrFirstIndex(items: FileItem[]): number {
  const currentFileIndex = items.findIndex((item) => item.isCurrentFile)
  return currentFileIndex >= 0 ? currentFileIndex : 0
}

function resolveAnchorIndex(items: FileItem[], rule: DuplicateSelectionRule): number {
  if (items.length <= 1) {
    return 0
  }

  if (rule === 'keep_newest') {
    return resolveKeepNewestIndex(items)
  }
  if (rule === 'keep_oldest') {
    return resolveKeepOldestIndex(items)
  }
  return resolveKeepCurrentOrFirstIndex(items)
}

export function buildDuplicateSelectionForGroup(items: FileItem[], rule: DuplicateSelectionRule): string[] {
  if (items.length <= 1) {
    return []
  }

  const anchorIndex = resolveAnchorIndex(items, rule)
  return items
    .filter((_, index) => index !== anchorIndex)
    .map((item) => item.path)
}

export function buildDuplicateSelectionForProjection(files: FileItem[], rule: DuplicateSelectionRule): string[] {
  return groupDuplicateProjectionFiles(files).flatMap((group) => buildDuplicateSelectionForGroup(group.items, rule))
}

export function replaceDuplicateGroupSelection(
  files: FileItem[],
  selectedPaths: string[],
  groupId: string,
  nextGroupSelectedPaths: string[]
): string[] {
  const selectedPathSet = new Set(selectedPaths)
  const nextGroupSelectedPathSet = new Set(nextGroupSelectedPaths)

  return files.flatMap((file) => {
    if (file.groupId !== groupId) {
      return selectedPathSet.has(file.path) ? [file.path] : []
    }
    return nextGroupSelectedPathSet.has(file.path) ? [file.path] : []
  })
}
