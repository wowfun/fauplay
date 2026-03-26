import type { FileItem, FilePreviewKind, ResultProjection, ResultProjectionOrdering } from '@/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toPreviewKind(value: unknown): FilePreviewKind {
  if (value === 'image' || value === 'video' || value === 'text') {
    return value
  }
  return 'unsupported'
}

function toProjectionOrdering(value: unknown): ResultProjectionOrdering | undefined {
  if (!isRecord(value)) return undefined
  const mode = value.mode
  if (mode !== 'listed' && mode !== 'group_contiguous' && mode !== 'mixed') {
    return undefined
  }

  const keys = Array.isArray(value.keys)
    ? value.keys.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined

  return {
    mode,
    ...(keys && keys.length > 0 ? { keys } : {}),
  }
}

function toProjectionFileItem(value: unknown): FileItem | null {
  if (!isRecord(value)) return null
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!absolutePath || !name) {
    return null
  }

  const lastModifiedMs = Number.isFinite(Number(value.lastModifiedMs))
    ? Number(value.lastModifiedMs)
    : undefined
  const path = typeof value.path === 'string' && value.path.trim()
    ? value.path.trim()
    : (typeof value.sourceRelativePath === 'string' && value.sourceRelativePath.trim()
      ? value.sourceRelativePath.trim()
      : absolutePath)

  return {
    name,
    path,
    kind: 'file',
    absolutePath,
    displayPath: typeof value.displayPath === 'string' && value.displayPath.trim()
      ? value.displayPath.trim()
      : absolutePath,
    previewKind: toPreviewKind(value.previewKind),
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined,
    size: Number.isFinite(Number(value.size)) ? Number(value.size) : undefined,
    lastModifiedMs,
    lastModified: typeof lastModifiedMs === 'number' ? new Date(lastModifiedMs) : undefined,
    sourceType: typeof value.sourceType === 'string' ? value.sourceType : undefined,
    sourceRootPath: typeof value.sourceRootPath === 'string' ? value.sourceRootPath : undefined,
    sourceRelativePath: typeof value.sourceRelativePath === 'string' ? value.sourceRelativePath : undefined,
    groupId: typeof value.groupId === 'string' ? value.groupId : undefined,
    groupRank: Number.isFinite(Number(value.groupRank)) ? Number(value.groupRank) : undefined,
    isCurrentFile: value.isCurrentFile === true,
    deletedAt: Number.isFinite(Number(value.deletedAt)) ? Number(value.deletedAt) : undefined,
    recycleId: typeof value.recycleId === 'string' ? value.recycleId : undefined,
    originalAbsolutePath: typeof value.originalAbsolutePath === 'string' ? value.originalAbsolutePath : undefined,
  }
}

export function toToolScopedProjectionId(toolName: string): string {
  return `tool:${toolName}`
}

export function withToolScopedProjection(projection: ResultProjection, toolName: string): ResultProjection {
  const scopedId = toToolScopedProjectionId(toolName)
  if (projection.id === scopedId) {
    return projection
  }
  return {
    ...projection,
    id: scopedId,
  }
}

export function extractResultProjection(result: unknown): ResultProjection | null {
  if (!isRecord(result) || !isRecord(result.projection)) {
    return null
  }

  const projection = result.projection
  const id = typeof projection.id === 'string' ? projection.id.trim() : ''
  const title = typeof projection.title === 'string' ? projection.title.trim() : ''
  const entry = projection.entry
  if (!id || !title || (entry !== 'auto' && entry !== 'manual')) {
    return null
  }

  const files = Array.isArray(projection.files)
    ? projection.files
      .map((item) => toProjectionFileItem(item))
      .filter((item): item is FileItem => item !== null)
    : []
  if (files.length === 0) {
    return null
  }

  return {
    id,
    title,
    entry,
    ordering: toProjectionOrdering(projection.ordering),
    files,
  }
}

export function stripProjectionFromResult(result: unknown): unknown {
  if (!isRecord(result) || !Object.prototype.hasOwnProperty.call(result, 'projection')) {
    return result
  }

  const next = { ...result }
  delete next.projection
  return next
}
