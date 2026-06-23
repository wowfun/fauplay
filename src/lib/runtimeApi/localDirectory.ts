import { getMimeType } from '@/lib/fileSystem'
import type { FileItem } from '@/types'
import { callRuntimeJson, isObject, joinRootPath, normalizeRootRelativePath, toFiniteNumber } from './core'
import type {
  RuntimeDirectoryEntry,
  RuntimeListDirectoryRequest,
  RuntimeListDirectoryResponse,
} from './types'

function parseRuntimeDirectoryEntry(value: unknown): RuntimeDirectoryEntry | null {
  if (!isObject(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const kind = value.kind === 'directory' || value.kind === 'file' ? value.kind : null
  if (!name || !rootRelativePath || !kind) return null

  return {
    name,
    rootRelativePath,
    kind,
    isEmpty: kind === 'directory' && typeof value.isEmpty === 'boolean'
      ? value.isEmpty
      : undefined,
    entryCount: kind === 'directory'
      ? toFiniteNumber(value.entryCount)
      : undefined,
    size: kind === 'file' ? toFiniteNumber(value.size) : undefined,
    lastModifiedMs: toFiniteNumber(value.lastModifiedMs),
  }
}

function parseRuntimeListDirectoryResponse(payload: unknown): RuntimeListDirectoryResponse {
  if (!isObject(payload)) {
    return {
      entries: [],
      isTruncated: false,
      nextOffset: null,
    }
  }

  const entries = Array.isArray(payload.entries)
    ? payload.entries
      .map((entry) => parseRuntimeDirectoryEntry(entry))
      .filter((entry): entry is RuntimeDirectoryEntry => entry !== null)
    : []

  return {
    entries,
    isTruncated: payload.isTruncated === true,
    nextOffset: typeof payload.nextOffset === 'number' && Number.isFinite(payload.nextOffset)
      ? payload.nextOffset
      : null,
  }
}

export async function listRuntimeLocalDirectory(
  request: RuntimeListDirectoryRequest,
  timeoutMs?: number,
): Promise<RuntimeListDirectoryResponse> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath ?? '',
  })
  if (request.flattened === true) {
    query.set('flattened', 'true')
  }
  if (typeof request.limit === 'number' && Number.isFinite(request.limit) && request.limit > 0) {
    query.set('limit', String(Math.trunc(request.limit)))
  }
  if (typeof request.offset === 'number' && Number.isFinite(request.offset) && request.offset > 0) {
    query.set('offset', String(Math.trunc(request.offset)))
  }
  const nameContains = request.nameContains?.trim()
  if (nameContains) {
    query.set('nameContains', nameContains)
  }
  if (request.entryFilter === 'image' || request.entryFilter === 'video') {
    query.set('entryFilter', request.entryFilter)
  }
  if (request.hideEmptyFolders === true) {
    query.set('hideEmptyFolders', 'true')
  }
  if (request.sortBy === 'date' || request.sortBy === 'size') {
    query.set('sortBy', request.sortBy)
  }
  if (request.sortOrder === 'desc') {
    query.set('sortOrder', 'desc')
  }
  const payload = await callRuntimeJson(`/v1/local-directory?${query.toString()}`, timeoutMs)
  return parseRuntimeListDirectoryResponse(payload)
}

export function toRuntimeFileItems(entries: RuntimeDirectoryEntry[], rootPath?: string | null): FileItem[] {
  const normalizedRootPath = typeof rootPath === 'string' && rootPath.trim()
    ? rootPath.trim()
    : null

  return entries.map((entry) => {
    const lastModified = typeof entry.lastModifiedMs === 'number'
      ? new Date(entry.lastModifiedMs)
      : undefined
    const absolutePath = normalizedRootPath && entry.kind === 'file'
      ? joinRootPath(normalizedRootPath, entry.rootRelativePath)
      : undefined

    return {
      name: entry.name,
      path: entry.rootRelativePath,
      kind: entry.kind,
      isEmpty: entry.isEmpty,
      entryCount: entry.entryCount,
      size: entry.size,
      lastModified,
      lastModifiedMs: entry.lastModifiedMs,
      mimeType: entry.kind === 'file' ? getMimeType(entry.name) : undefined,
      displayPath: entry.rootRelativePath,
      absolutePath,
      sourceRootPath: normalizedRootPath ?? undefined,
      sourceRelativePath: entry.rootRelativePath,
    }
  })
}
