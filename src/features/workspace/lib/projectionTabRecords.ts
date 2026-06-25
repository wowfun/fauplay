import type { DuplicateSelectionRule } from './duplicateSelection.ts'
import type { ResultProjection } from '../../../types/index.ts'

export type WorkspaceActiveSurface =
  | { kind: 'directory' }
  | { kind: 'projection'; tabId: string }

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function resolveProjectionSelectedPathsByIdUpdate(
  previous: Record<string, string[]>,
  tabId: string,
  selectedPaths: string[],
): Record<string, string[]> {
  const currentSelectedPaths = previous[tabId] ?? []
  if (areStringArraysEqual(currentSelectedPaths, selectedPaths)) {
    return previous
  }
  if (selectedPaths.length === 0) {
    return omitRecordKey(previous, tabId)
  }
  return {
    ...previous,
    [tabId]: selectedPaths,
  }
}

export function resolveProjectionRuleByIdUpdate(
  previous: Record<string, DuplicateSelectionRule | null>,
  tabId: string,
  rule: DuplicateSelectionRule | null,
): Record<string, DuplicateSelectionRule | null> {
  const currentRule = previous[tabId] ?? null
  if (currentRule === rule) {
    return previous
  }
  if (rule === null) {
    return omitRecordKey(previous, tabId)
  }
  return {
    ...previous,
    [tabId]: rule,
  }
}

export function resolveProjectionFocusedPathByIdUpdate(
  previous: Record<string, string | null>,
  tabId: string,
  focusedPath: string | null,
): Record<string, string | null> {
  const currentFocusedPath = previous[tabId] ?? null
  if (currentFocusedPath === focusedPath) {
    return previous
  }
  if (!focusedPath) {
    return omitRecordKey(previous, tabId)
  }
  return {
    ...previous,
    [tabId]: focusedPath,
  }
}

export function normalizeRootRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

export function resolveProjectionPreferredPath(
  projection: ResultProjection | null,
  preferredPath: string | null | undefined
): string | null {
  if (!projection) return null
  const normalizedPreferredPath = normalizeRootRelativePath(preferredPath || '')
  if (
    normalizedPreferredPath
    && projection.files.some((file) => normalizeRootRelativePath(file.path) === normalizedPreferredPath)
  ) {
    return normalizedPreferredPath
  }
  return projection.files[0]?.path ?? null
}

export function pruneProjectionAfterDeletedAbsolutePaths(
  projection: ResultProjection,
  deletedAbsolutePaths: ReadonlySet<string>
): ResultProjection | null {
  if (deletedAbsolutePaths.size === 0) {
    return projection
  }

  const nextFiles = projection.files.filter((file) => {
    const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
    return !absolutePath || !deletedAbsolutePaths.has(absolutePath)
  })
  if (nextFiles.length === 0) {
    return null
  }
  if (nextFiles.length === projection.files.length) {
    return projection
  }
  return {
    ...projection,
    files: nextFiles,
  }
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record
  }
  const next = { ...record }
  delete next[key]
  return next
}
