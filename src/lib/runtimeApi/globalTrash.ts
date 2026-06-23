import { getMimeType } from '@/lib/fileSystem'
import type { FileItem, TextPreviewPayload } from '@/types'
import { buildRuntimeUrl, callRuntimeJson, isObject, RuntimeApiError, toFiniteNumber } from './core'
import { parseRuntimeTextPreviewPayload } from './textPreview'
import type {
  RuntimeGlobalTrashEntry,
  RuntimeGlobalTrashFileContentRequest,
  RuntimeGlobalTrashFileMetadataRequest,
  RuntimeGlobalTrashFileMetadataResponse,
  RuntimeGlobalTrashListRequest,
  RuntimeGlobalTrashListResponse,
  RuntimeGlobalTrashMoveItem,
  RuntimeGlobalTrashMoveRequest,
  RuntimeGlobalTrashMoveResponse,
  RuntimeGlobalTrashRestoreItem,
  RuntimeGlobalTrashRestoreRequest,
  RuntimeGlobalTrashRestoreResponse,
  RuntimeGlobalTrashTextPreviewRequest,
} from './types'

export async function loadRuntimeGlobalTrashTextPreview(
  request: RuntimeGlobalTrashTextPreviewRequest,
  timeoutMs?: number,
): Promise<TextPreviewPayload> {
  const query = new URLSearchParams({
    recycleId: request.recycleId,
  })
  if (
    typeof request.sizeLimitBytes === 'number'
    && Number.isFinite(request.sizeLimitBytes)
    && request.sizeLimitBytes > 0
  ) {
    query.set('sizeLimitBytes', String(Math.trunc(request.sizeLimitBytes)))
  }

  const payload = await callRuntimeJson(`/v1/global-trash/text-preview?${query.toString()}`, timeoutMs)
  return parseRuntimeTextPreviewPayload(payload)
}

export async function listRuntimeGlobalTrash(
  request: RuntimeGlobalTrashListRequest = {},
  timeoutMs?: number,
): Promise<RuntimeGlobalTrashListResponse> {
  const query = new URLSearchParams()
  if (typeof request.limit === 'number' && Number.isFinite(request.limit) && request.limit > 0) {
    query.set('limit', String(Math.trunc(request.limit)))
  }
  if (typeof request.offset === 'number' && Number.isFinite(request.offset) && request.offset > 0) {
    query.set('offset', String(Math.trunc(request.offset)))
  }

  const queryString = query.toString()
  const payload = await callRuntimeJson(
    queryString ? `/v1/global-trash?${queryString}` : '/v1/global-trash',
    timeoutMs,
  )
  return parseRuntimeGlobalTrashListResponse(payload)
}

export async function moveRuntimePathToGlobalTrash(
  request: RuntimeGlobalTrashMoveRequest,
  timeoutMs?: number,
): Promise<RuntimeGlobalTrashMoveResponse> {
  const payload = await callRuntimeJson(
    `/v1/global-trash/move?${globalTrashMoveQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeGlobalTrashMoveResponse(payload)
}

export async function restoreRuntimeGlobalTrash(
  request: RuntimeGlobalTrashRestoreRequest,
  timeoutMs?: number,
): Promise<RuntimeGlobalTrashRestoreResponse> {
  const payload = await callRuntimeJson(
    `/v1/global-trash/restore?${globalTrashRestoreQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeGlobalTrashRestoreResponse(payload)
}

export function buildRuntimeGlobalTrashFileContentUrl(
  request: RuntimeGlobalTrashFileContentRequest,
): string {
  const query = new URLSearchParams({
    recycleId: request.recycleId,
  })
  return buildRuntimeUrl(`/v1/global-trash/file-content?${query.toString()}`)
}

export async function loadRuntimeGlobalTrashFileMetadata(
  request: RuntimeGlobalTrashFileMetadataRequest,
  timeoutMs?: number,
): Promise<RuntimeGlobalTrashFileMetadataResponse> {
  const query = new URLSearchParams({
    recycleId: request.recycleId,
  })
  const payload = await callRuntimeJson(`/v1/global-trash/file-metadata?${query.toString()}`, timeoutMs)
  return parseRuntimeGlobalTrashFileMetadataResponse(payload)
}

export function buildRuntimeGlobalTrashFileContentUrlForItem(file: FileItem): string | null {
  const recycleId = resolveRuntimeGlobalTrashRecycleId(file)
  if (!recycleId) {
    return null
  }

  return buildRuntimeGlobalTrashFileContentUrl({ recycleId })
}

export function resolveRuntimeGlobalTrashRecycleId(file: FileItem): string | null {
  if (file.sourceType !== 'global_recycle') {
    return null
  }

  const recycleId = typeof file.recycleId === 'string' ? file.recycleId.trim() : ''
  return recycleId || null
}

function globalTrashMoveQuery(request: RuntimeGlobalTrashMoveRequest): URLSearchParams {
  const query = new URLSearchParams()
  const absolutePaths = Array.isArray(request.absolutePath)
    ? request.absolutePath
    : [request.absolutePath]
  for (const absolutePath of absolutePaths) {
    query.append('absolutePath', absolutePath)
  }
  if (request.dryRun === true) {
    query.set('dryRun', 'true')
  }
  return query
}

function globalTrashRestoreQuery(request: RuntimeGlobalTrashRestoreRequest): URLSearchParams {
  const query = new URLSearchParams()
  const recycleIds = Array.isArray(request.recycleId)
    ? request.recycleId
    : [request.recycleId]
  for (const recycleId of recycleIds) {
    query.append('recycleId', recycleId)
  }
  if (request.dryRun === true) {
    query.set('dryRun', 'true')
  }
  return query
}

function parseRuntimeGlobalTrashMoveResponse(payload: unknown): RuntimeGlobalTrashMoveResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      total: 0,
      moved: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    dryRun: payload.dryRun === true,
    total: Math.max(0, Math.trunc(toFiniteNumber(payload.total) ?? 0)),
    moved: Math.max(0, Math.trunc(toFiniteNumber(payload.moved) ?? 0)),
    failed: Math.max(0, Math.trunc(toFiniteNumber(payload.failed) ?? 0)),
    items: Array.isArray(payload.items)
      ? payload.items
        .map((item) => parseRuntimeGlobalTrashMoveItem(item))
        .filter((item): item is RuntimeGlobalTrashMoveItem => item !== null)
      : [],
  }
}

function parseRuntimeGlobalTrashRestoreResponse(payload: unknown): RuntimeGlobalTrashRestoreResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      total: 0,
      restored: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    dryRun: payload.dryRun === true,
    total: Math.max(0, Math.trunc(toFiniteNumber(payload.total) ?? 0)),
    restored: Math.max(0, Math.trunc(toFiniteNumber(payload.restored) ?? 0)),
    failed: Math.max(0, Math.trunc(toFiniteNumber(payload.failed) ?? 0)),
    items: Array.isArray(payload.items)
      ? payload.items
        .map((item) => parseRuntimeGlobalTrashRestoreItem(item))
        .filter((item): item is RuntimeGlobalTrashRestoreItem => item !== null)
      : [],
  }
}

function parseRuntimeGlobalTrashListResponse(payload: unknown): RuntimeGlobalTrashListResponse {
  if (!isObject(payload)) {
    return {
      entries: [],
      isTruncated: false,
      nextOffset: null,
    }
  }

  return {
    entries: Array.isArray(payload.entries)
      ? payload.entries
        .map((entry) => parseRuntimeGlobalTrashEntry(entry))
        .filter((entry): entry is RuntimeGlobalTrashEntry => entry !== null)
      : [],
    isTruncated: payload.isTruncated === true,
    nextOffset: typeof payload.nextOffset === 'number' && Number.isFinite(payload.nextOffset)
      ? payload.nextOffset
      : null,
  }
}

function parseRuntimeGlobalTrashMoveItem(value: unknown): RuntimeGlobalTrashMoveItem | null {
  if (!isObject(value)) return null
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  if (!absolutePath) return null

  return {
    sourceType: 'global_recycle',
    recycleId: typeof value.recycleId === 'string' ? value.recycleId : '',
    absolutePath,
    nextAbsolutePath: typeof value.nextAbsolutePath === 'string' ? value.nextAbsolutePath : null,
    deletedAt: toFiniteNumber(value.deletedAt),
    ok: value.ok === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    error: typeof value.error === 'string' ? value.error : null,
  }
}

function parseRuntimeGlobalTrashRestoreItem(value: unknown): RuntimeGlobalTrashRestoreItem | null {
  if (!isObject(value)) return null
  const recycleId = typeof value.recycleId === 'string' ? value.recycleId.trim() : ''
  if (!recycleId) return null

  return {
    sourceType: 'global_recycle',
    recycleId,
    absolutePath: typeof value.absolutePath === 'string' ? value.absolutePath : '',
    originalAbsolutePath: typeof value.originalAbsolutePath === 'string'
      ? value.originalAbsolutePath
      : '',
    nextAbsolutePath: typeof value.nextAbsolutePath === 'string' ? value.nextAbsolutePath : null,
    ok: value.ok === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    error: typeof value.error === 'string' ? value.error : null,
  }
}

function parseRuntimeGlobalTrashEntry(value: unknown): RuntimeGlobalTrashEntry | null {
  if (!isObject(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath.trim() : ''
  const path = typeof value.path === 'string' && value.path.trim()
    ? value.path.trim()
    : absolutePath
  if (!name || !absolutePath || !path) return null

  return {
    name,
    path,
    absolutePath,
    size: Math.max(0, Math.trunc(toFiniteNumber(value.size) ?? 0)),
    mimeType: typeof value.mimeType === 'string' && value.mimeType.trim()
      ? value.mimeType
      : getMimeType(name),
    previewKind: parseRuntimePreviewKind(value.previewKind),
    displayPath: typeof value.displayPath === 'string' && value.displayPath.trim()
      ? value.displayPath
      : absolutePath,
    deletedAt: Math.max(0, Math.trunc(toFiniteNumber(value.deletedAt) ?? 0)),
    sourceType: 'global_recycle',
    recycleId: typeof value.recycleId === 'string' ? value.recycleId : '',
    originalAbsolutePath: typeof value.originalAbsolutePath === 'string'
      ? value.originalAbsolutePath
      : '',
    lastModifiedMs: toFiniteNumber(value.lastModifiedMs),
  }
}

function parseRuntimePreviewKind(value: unknown): NonNullable<FileItem['previewKind']> {
  return (
    value === 'image'
    || value === 'video'
    || value === 'text'
    || value === 'unsupported'
  ) ? value : 'unsupported'
}

function parseRuntimeGlobalTrashFileMetadataResponse(
  payload: unknown,
): RuntimeGlobalTrashFileMetadataResponse {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime Global Trash File Metadata response was invalid')
  }

  const recycleId = typeof payload.recycleId === 'string' ? payload.recycleId.trim() : ''
  const size = toFiniteNumber(payload.size)
  if (!recycleId || typeof size !== 'number') {
    throw new RuntimeApiError('Fauplay Runtime Global Trash File Metadata response was invalid')
  }

  return {
    recycleId,
    size,
    lastModifiedMs: toFiniteNumber(payload.lastModifiedMs),
  }
}

export function toRuntimeGlobalTrashFileItems(entries: RuntimeGlobalTrashEntry[]): FileItem[] {
  return entries.map((entry) => {
    const lastModifiedMs = typeof entry.lastModifiedMs === 'number'
      ? entry.lastModifiedMs
      : entry.deletedAt
    const lastModified = typeof lastModifiedMs === 'number'
      ? new Date(lastModifiedMs)
      : undefined

    return {
      name: entry.name,
      path: entry.path,
      kind: 'file',
      absolutePath: entry.absolutePath,
      size: entry.size,
      mimeType: entry.mimeType,
      previewKind: entry.previewKind,
      displayPath: entry.displayPath,
      deletedAt: entry.deletedAt,
      sourceType: entry.sourceType,
      recycleId: entry.recycleId || undefined,
      originalAbsolutePath: entry.originalAbsolutePath || undefined,
      lastModifiedMs,
      lastModified,
    }
  })
}
