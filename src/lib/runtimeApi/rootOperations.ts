import { getFilePreviewKind } from '@/lib/filePreview'
import { getMimeType } from '@/lib/fileSystem'
import type { FileItem } from '@/types'
import { callRuntimeJson, isObject, normalizeRootRelativePath, toFiniteNumber } from './core'
import type {
  RuntimeRootMoveBatchItem,
  RuntimeRootMoveBatchRequest,
  RuntimeRootMoveBatchResponse,
  RuntimeRootMoveRequest,
  RuntimeRootMoveResponse,
  RuntimeRootTrashEntry,
  RuntimeRootTrashItem,
  RuntimeRootTrashListRequest,
  RuntimeRootTrashListResponse,
  RuntimeRootTrashRequest,
  RuntimeRootTrashResponse,
} from './types'

export async function listRuntimeRootTrash(
  request: RuntimeRootTrashListRequest,
  timeoutMs?: number,
): Promise<RuntimeRootTrashListResponse> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
  })
  if (typeof request.limit === 'number' && Number.isFinite(request.limit) && request.limit > 0) {
    query.set('limit', String(Math.trunc(request.limit)))
  }
  if (typeof request.offset === 'number' && Number.isFinite(request.offset) && request.offset > 0) {
    query.set('offset', String(Math.trunc(request.offset)))
  }

  const payload = await callRuntimeJson(`/v1/root-trash?${query.toString()}`, timeoutMs)
  return parseRuntimeRootTrashListResponse(payload)
}

export async function moveRuntimePathToRootTrash(
  request: RuntimeRootTrashRequest,
  timeoutMs?: number,
): Promise<RuntimeRootTrashResponse> {
  const payload = await callRuntimeJson(
    `/v1/root-trash/move?${rootTrashQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeRootTrashResponse(payload)
}

export async function moveRuntimeRootPath(
  request: RuntimeRootMoveRequest,
  timeoutMs?: number,
): Promise<RuntimeRootMoveResponse> {
  const payload = await callRuntimeJson(
    `/v1/root-move?${rootMoveQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeRootMoveResponse(payload)
}

export async function moveRuntimeRootPathBatch(
  request: RuntimeRootMoveBatchRequest,
  timeoutMs?: number,
): Promise<RuntimeRootMoveBatchResponse> {
  const payload = await callRuntimeJson(
    '/v1/root-move/batch',
    timeoutMs,
    'POST',
    {
      rootPath: request.rootPath,
      rootRelativePaths: request.rootRelativePaths,
      nameMask: request.nameMask,
      findText: request.findText,
      replaceText: request.replaceText,
      searchMode: request.searchMode,
      regexFlags: request.regexFlags,
      counterStart: request.counterStart,
      counterStep: request.counterStep,
      counterPad: request.counterPad,
      dryRun: request.dryRun === true,
    },
  )
  return parseRuntimeRootMoveBatchResponse(payload)
}

export async function restoreRuntimePathFromRootTrash(
  request: RuntimeRootTrashRequest,
  timeoutMs?: number,
): Promise<RuntimeRootTrashResponse> {
  const payload = await callRuntimeJson(
    `/v1/root-trash/restore?${rootTrashQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeRootTrashResponse(payload)
}

function rootTrashQuery(request: RuntimeRootTrashRequest): URLSearchParams {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
  })
  const rootRelativePaths = Array.isArray(request.rootRelativePath)
    ? request.rootRelativePath
    : [request.rootRelativePath]
  for (const rootRelativePath of rootRelativePaths) {
    query.append('rootRelativePath', rootRelativePath)
  }
  if (request.dryRun === true) {
    query.set('dryRun', 'true')
  }
  return query
}

function rootMoveQuery(request: RuntimeRootMoveRequest): URLSearchParams {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    sourceRootRelativePath: request.sourceRootRelativePath,
    targetRootRelativePath: request.targetRootRelativePath,
  })
  if (request.dryRun === true) {
    query.set('dryRun', 'true')
  }
  return query
}

function parseRuntimeRootMoveResponse(payload: unknown): RuntimeRootMoveResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      sourceRootRelativePath: '',
      targetRootRelativePath: '',
      absolutePath: '',
      targetAbsolutePath: '',
      ok: false,
      reason: null,
      error: 'Fauplay Runtime Root Move response was invalid',
    }
  }

  return {
    dryRun: payload.dryRun === true,
    sourceRootRelativePath: typeof payload.sourceRootRelativePath === 'string'
      ? normalizeRootRelativePath(payload.sourceRootRelativePath)
      : '',
    targetRootRelativePath: typeof payload.targetRootRelativePath === 'string'
      ? normalizeRootRelativePath(payload.targetRootRelativePath)
      : '',
    absolutePath: typeof payload.absolutePath === 'string' ? payload.absolutePath : '',
    targetAbsolutePath: typeof payload.targetAbsolutePath === 'string'
      ? payload.targetAbsolutePath
      : '',
    ok: payload.ok === true,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
    error: typeof payload.error === 'string' ? payload.error : null,
  }
}

function parseRuntimeRootMoveBatchResponse(payload: unknown): RuntimeRootMoveBatchResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      total: 0,
      moved: 0,
      skipped: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    dryRun: payload.dryRun === true,
    total: Math.max(0, Math.trunc(toFiniteNumber(payload.total) ?? 0)),
    moved: Math.max(0, Math.trunc(toFiniteNumber(payload.moved) ?? 0)),
    skipped: Math.max(0, Math.trunc(toFiniteNumber(payload.skipped) ?? 0)),
    failed: Math.max(0, Math.trunc(toFiniteNumber(payload.failed) ?? 0)),
    items: Array.isArray(payload.items)
      ? payload.items
        .map((item) => parseRuntimeRootMoveBatchItem(item))
        .filter((item): item is RuntimeRootMoveBatchItem => item !== null)
      : [],
  }
}

function parseRuntimeRootMoveBatchItem(value: unknown): RuntimeRootMoveBatchItem | null {
  if (!isObject(value)) return null
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  if (!rootRelativePath || !absolutePath) return null

  return {
    rootRelativePath,
    nextRootRelativePath: typeof value.nextRootRelativePath === 'string'
      ? normalizeRootRelativePath(value.nextRootRelativePath)
      : null,
    absolutePath,
    nextAbsolutePath: typeof value.nextAbsolutePath === 'string' ? value.nextAbsolutePath : null,
    ok: value.ok === true,
    skipped: value.skipped === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    error: typeof value.error === 'string' ? value.error : null,
  }
}

function parseRuntimeRootTrashResponse(payload: unknown): RuntimeRootTrashResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      total: 0,
      completed: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    dryRun: payload.dryRun === true,
    total: Math.max(0, Math.trunc(toFiniteNumber(payload.total) ?? 0)),
    completed: Math.max(0, Math.trunc(toFiniteNumber(payload.completed) ?? 0)),
    failed: Math.max(0, Math.trunc(toFiniteNumber(payload.failed) ?? 0)),
    items: Array.isArray(payload.items)
      ? payload.items
        .map((item) => parseRuntimeRootTrashItem(item))
        .filter((item): item is RuntimeRootTrashItem => item !== null)
      : [],
  }
}

function parseRuntimeRootTrashListResponse(payload: unknown): RuntimeRootTrashListResponse {
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
        .map((entry) => parseRuntimeRootTrashEntry(entry))
        .filter((entry): entry is RuntimeRootTrashEntry => entry !== null)
      : [],
    isTruncated: payload.isTruncated === true,
    nextOffset: typeof payload.nextOffset === 'number' && Number.isFinite(payload.nextOffset)
      ? payload.nextOffset
      : null,
  }
}

function parseRuntimeRootTrashEntry(value: unknown): RuntimeRootTrashEntry | null {
  if (!isObject(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const originalRootRelativePath = typeof value.originalRootRelativePath === 'string'
    ? normalizeRootRelativePath(value.originalRootRelativePath)
    : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  const originalAbsolutePath = typeof value.originalAbsolutePath === 'string'
    ? value.originalAbsolutePath
    : ''
  if (!name || !rootRelativePath || !originalRootRelativePath || !absolutePath || !originalAbsolutePath) {
    return null
  }

  return {
    name,
    rootRelativePath,
    originalRootRelativePath,
    absolutePath,
    originalAbsolutePath,
    size: Math.max(0, Math.trunc(toFiniteNumber(value.size) ?? 0)),
    lastModifiedMs: toFiniteNumber(value.lastModifiedMs),
    deletedAtMs: toFiniteNumber(value.deletedAtMs),
  }
}

function parseRuntimeRootTrashItem(value: unknown): RuntimeRootTrashItem | null {
  if (!isObject(value)) return null
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  if (!rootRelativePath || !absolutePath) return null

  return {
    rootRelativePath,
    nextRootRelativePath: typeof value.nextRootRelativePath === 'string'
      ? normalizeRootRelativePath(value.nextRootRelativePath)
      : null,
    absolutePath,
    nextAbsolutePath: typeof value.nextAbsolutePath === 'string' ? value.nextAbsolutePath : null,
    ok: value.ok === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    error: typeof value.error === 'string' ? value.error : null,
  }
}

export function toRuntimeRootTrashFileItems(
  entries: RuntimeRootTrashEntry[],
  rootPath: string,
): FileItem[] {
  return entries.map((entry) => {
    const lastModifiedMs = typeof entry.lastModifiedMs === 'number'
      ? entry.lastModifiedMs
      : entry.deletedAtMs
    const lastModified = typeof lastModifiedMs === 'number'
      ? new Date(lastModifiedMs)
      : undefined

    return {
      name: entry.name,
      path: entry.rootRelativePath,
      kind: 'file',
      absolutePath: entry.absolutePath,
      size: entry.size,
      mimeType: getMimeType(entry.name),
      previewKind: getFilePreviewKind(entry.name),
      displayPath: entry.rootRelativePath,
      deletedAt: entry.deletedAtMs,
      sourceType: 'root_trash',
      sourceRootPath: rootPath,
      sourceRelativePath: entry.rootRelativePath,
      originalAbsolutePath: entry.originalAbsolutePath,
      lastModifiedMs,
      lastModified,
    }
  })
}
