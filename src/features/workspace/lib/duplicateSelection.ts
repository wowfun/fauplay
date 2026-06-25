import { toToolScopedProjectionId } from '../../../lib/projection.ts'
import type { FileItem, ResultProjection } from '../../../types/index.ts'

export type DuplicateSelectionRule = 'keep_newest' | 'keep_oldest' | 'keep_current_or_first'

export interface DuplicateProjectionGroup {
  groupId: string
  index: number
  items: FileItem[]
}

export type DuplicateSelectionPlanAction =
  | { kind: 'apply-rule'; rule: DuplicateSelectionRule }
  | { kind: 'clear-all' }
  | { kind: 'reapply-group'; groupId: string }
  | { kind: 'clear-group'; groupId: string }

export type DuplicateSelectionPlan =
  | { kind: 'none' }
  | {
    kind: 'update'
    activeProjectionTabId: string
    activeSurface: { kind: 'projection'; tabId: string }
    lastProjectionTabId: string
    selectedPaths: string[]
    nextRule: DuplicateSelectionRule | null | undefined
  }

interface ResolveDuplicateSelectionPlanParams {
  projection: ResultProjection | null | undefined
  currentSelectedPaths: string[]
  currentRule: DuplicateSelectionRule | null
  action: DuplicateSelectionPlanAction
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

export function resolveDuplicateSelectionPlan({
  projection,
  currentSelectedPaths,
  currentRule,
  action,
}: ResolveDuplicateSelectionPlanParams): DuplicateSelectionPlan {
  if (!isDuplicateProjection(projection)) {
    return { kind: 'none' }
  }

  if (action.kind === 'apply-rule') {
    return {
      kind: 'update',
      activeProjectionTabId: projection.id,
      activeSurface: { kind: 'projection', tabId: projection.id },
      lastProjectionTabId: projection.id,
      selectedPaths: buildDuplicateSelectionForProjection(projection.files, action.rule),
      nextRule: action.rule,
    }
  }

  if (action.kind === 'clear-all') {
    return {
      kind: 'update',
      activeProjectionTabId: projection.id,
      activeSurface: { kind: 'projection', tabId: projection.id },
      lastProjectionTabId: projection.id,
      selectedPaths: [],
      nextRule: null,
    }
  }

  if (action.kind === 'reapply-group') {
    if (!currentRule) {
      return { kind: 'none' }
    }
    const targetGroup = groupDuplicateProjectionFiles(projection.files)
      .find((group) => group.groupId === action.groupId)
    if (!targetGroup) {
      return { kind: 'none' }
    }

    return {
      kind: 'update',
      activeProjectionTabId: projection.id,
      activeSurface: { kind: 'projection', tabId: projection.id },
      lastProjectionTabId: projection.id,
      selectedPaths: replaceDuplicateGroupSelection(
        projection.files,
        currentSelectedPaths,
        action.groupId,
        buildDuplicateSelectionForGroup(targetGroup.items, currentRule)
      ),
      nextRule: undefined,
    }
  }

  if (action.kind === 'clear-group') {
    return {
      kind: 'update',
      activeProjectionTabId: projection.id,
      activeSurface: { kind: 'projection', tabId: projection.id },
      lastProjectionTabId: projection.id,
      selectedPaths: replaceDuplicateGroupSelection(
        projection.files,
        currentSelectedPaths,
        action.groupId,
        []
      ),
      nextRule: undefined,
    }
  }

  return { kind: 'none' }
}
