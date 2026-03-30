import type { DuplicateSelectionRule } from '@/features/workspace/lib/duplicateSelection'
import type {
  AddressPathHistoryEntry,
  FileItem,
  FilterState,
  ResultPanelDisplayMode,
  ResultProjection,
} from '@/types'

export type DeleteUndoSourceType = 'root_trash' | 'global_recycle'

export interface DeleteUndoRestoreItem {
  sourceType: DeleteUndoSourceType
  originalAbsolutePath: string
  absolutePath?: string
  recycleId?: string
}

export interface DeleteUndoPreviewSnapshot {
  showPreviewPane: boolean
  selectedFile: FileItem | null
  previewFile: FileItem | null
}

export interface DeleteUndoSnapshot {
  historyEntry: AddressPathHistoryEntry
  rootPath: string | null
  currentPath: string
  filter: FilterState
  isFlattenView: boolean
  activeSurface:
    | { kind: 'directory' }
    | { kind: 'projection'; tabId: string }
  directorySelectedPaths: string[]
  directoryFocusedPath: string | null
  isResultPanelOpen: boolean
  resultPanelDisplayMode: ResultPanelDisplayMode
  resultPanelHeightPx: number
  lastNormalResultPanelHeightPx: number
  projectionTabs: ResultProjection[]
  activeProjectionTabId: string | null
  projectionSelectedPathsById: Record<string, string[]>
  projectionFocusedPathById: Record<string, string | null>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  preview: DeleteUndoPreviewSnapshot
}

export interface DeleteUndoBatch {
  id: string
  createdAt: number
  deletedCount: number
  restoreItems: DeleteUndoRestoreItem[]
  snapshot: DeleteUndoSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeRelativePath(value: string): string {
  return value.split('/').filter(Boolean).join('/')
}

export function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
}

export function normalizeAbsolutePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized) return ''
  if (normalized === '/' || /^[a-zA-Z]:\/$/.test(normalized)) {
    return normalized
  }
  return normalized.replace(/\/+$/, '')
}

export function joinRootAndRelativePath(rootPath: string, relativePath: string): string {
  const normalizedRootPath = normalizeAbsolutePath(rootPath)
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  if (!normalizedRelativePath) {
    return normalizedRootPath
  }
  return `${normalizedRootPath}/${normalizedRelativePath}`
}

export function toRelativePathWithinRoot(rootPath: string, absolutePath: string): string | null {
  const normalizedRootPath = normalizeAbsolutePath(rootPath)
  const normalizedAbsolutePath = normalizeAbsolutePath(absolutePath)
  if (!normalizedRootPath || !normalizedAbsolutePath) {
    return null
  }
  if (normalizedAbsolutePath === normalizedRootPath) {
    return ''
  }
  const prefix = `${normalizedRootPath}/`
  if (!normalizedAbsolutePath.startsWith(prefix)) {
    return null
  }
  return normalizeRelativePath(normalizedAbsolutePath.slice(prefix.length))
}

export function remapPathForRoot(
  value: string | null | undefined,
  rootPath: string | null,
  restoredAbsolutePathByOriginalAbsolutePath: Map<string, string>
): string | null {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  if (!normalizedValue) {
    return null
  }
  if (isAbsolutePathLike(normalizedValue)) {
    const remappedAbsolutePath = restoredAbsolutePathByOriginalAbsolutePath.get(
      normalizeAbsolutePath(normalizedValue)
    )
    return remappedAbsolutePath ?? normalizedValue
  }
  if (!rootPath) {
    return normalizeRelativePath(normalizedValue)
  }
  const originalAbsolutePath = joinRootAndRelativePath(rootPath, normalizedValue)
  const remappedAbsolutePath = restoredAbsolutePathByOriginalAbsolutePath.get(
    normalizeAbsolutePath(originalAbsolutePath)
  )
  if (!remappedAbsolutePath) {
    return normalizeRelativePath(normalizedValue)
  }
  const remappedRelativePath = toRelativePathWithinRoot(rootPath, remappedAbsolutePath)
  return remappedRelativePath ?? normalizeRelativePath(normalizedValue)
}

export function remapFileItemAfterRestore(
  file: FileItem,
  fallbackRootPath: string | null,
  restoredAbsolutePathByOriginalAbsolutePath: Map<string, string>
): FileItem {
  const absolutePath = typeof file.absolutePath === 'string' && file.absolutePath.trim()
    ? (
      restoredAbsolutePathByOriginalAbsolutePath.get(normalizeAbsolutePath(file.absolutePath))
      ?? file.absolutePath
    )
    : file.absolutePath
  const effectiveRootPath = typeof file.sourceRootPath === 'string' && file.sourceRootPath.trim()
    ? file.sourceRootPath.trim()
    : fallbackRootPath
  const nextSourceRelativePath = typeof file.sourceRelativePath === 'string' && file.sourceRelativePath.trim()
    ? remapPathForRoot(file.sourceRelativePath, effectiveRootPath, restoredAbsolutePathByOriginalAbsolutePath)
    : (
      effectiveRootPath && typeof absolutePath === 'string' && absolutePath.trim()
        ? toRelativePathWithinRoot(effectiveRootPath, absolutePath)
        : null
    )
  const nextPath = isAbsolutePathLike(file.path)
    ? (typeof absolutePath === 'string' && absolutePath.trim() ? absolutePath : file.path)
    : (
      remapPathForRoot(
        file.path,
        effectiveRootPath ?? fallbackRootPath,
        restoredAbsolutePathByOriginalAbsolutePath
      ) ?? file.path
    )
  const nextDisplayPath = nextSourceRelativePath
    ?? (
      typeof absolutePath === 'string' && absolutePath.trim()
        ? absolutePath
        : file.displayPath
    )

  return {
    ...file,
    absolutePath,
    path: nextPath,
    displayPath: nextDisplayPath,
    sourceRootPath: effectiveRootPath ?? undefined,
    sourceRelativePath: nextSourceRelativePath ?? undefined,
  }
}

export function readDeleteUndoRestoreItems(result: unknown): DeleteUndoRestoreItem[] {
  if (!isRecord(result) || !Array.isArray(result.items)) {
    return []
  }

  const items: DeleteUndoRestoreItem[] = []
  const seen = new Set<string>()
  for (const item of result.items) {
    if (!isRecord(item) || item.ok !== true) {
      continue
    }

    const originalAbsolutePath = typeof item.absolutePath === 'string' ? item.absolutePath.trim() : ''
    if (!originalAbsolutePath) {
      continue
    }

    const nextAbsolutePath = typeof item.nextAbsolutePath === 'string' ? item.nextAbsolutePath.trim() : ''
    const recycleId = typeof item.recycleId === 'string' ? item.recycleId.trim() : ''

    if (nextAbsolutePath) {
      const dedupeKey = `root_trash:${nextAbsolutePath}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      items.push({
        sourceType: 'root_trash',
        originalAbsolutePath,
        absolutePath: nextAbsolutePath,
      })
      continue
    }

    if (recycleId) {
      const dedupeKey = `global_recycle:${recycleId}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      items.push({
        sourceType: 'global_recycle',
        originalAbsolutePath,
        recycleId,
      })
    }
  }

  return items
}
