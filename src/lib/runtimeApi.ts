import { getMimeType } from '@/lib/fileSystem'
import { getFilePreviewKind } from '@/lib/filePreview'
import type { FileItem, TextPreviewPayload } from '@/types'

const LOCAL_RUNTIME_BASE_URL_CONFIG =
  (import.meta.env.VITE_FAUPLAY_RUNTIME_BASE_URL as string | undefined)?.trim()
  || 'http://127.0.0.1:3211'
const DEFAULT_RUNTIME_TIMEOUT_MS = 120000

export interface RuntimeHealthSnapshot {
  status: string
  runtime: string
}

export interface RuntimeDirectoryEntry {
  name: string
  rootRelativePath: string
  kind: 'directory' | 'file'
  isEmpty?: boolean
  size?: number
  lastModifiedMs?: number
}

export interface RuntimeListDirectoryRequest {
  rootPath: string
  rootRelativePath?: string
  flattened?: boolean
  limit?: number
  offset?: number
  nameContains?: string
  entryFilter?: 'all' | 'image' | 'video'
  hideEmptyFolders?: boolean
  sortBy?: 'name' | 'date' | 'size'
  sortOrder?: 'asc' | 'desc'
}

export interface RuntimeTextPreviewRequest {
  rootPath: string
  rootRelativePath: string
  sizeLimitBytes?: number
}

export interface RuntimeFileContentRequest {
  rootPath: string
  rootRelativePath: string
}

export interface RuntimeRootTrashRequest {
  rootPath: string
  rootRelativePath: string | string[]
  dryRun?: boolean
}

export interface RuntimeRootTrashListRequest {
  rootPath: string
  limit?: number
  offset?: number
}

export interface RuntimeRootTrashEntry {
  name: string
  rootRelativePath: string
  originalRootRelativePath: string
  absolutePath: string
  originalAbsolutePath: string
  size: number
  lastModifiedMs?: number
  deletedAtMs?: number
}

export interface RuntimeRootTrashListResponse {
  entries: RuntimeRootTrashEntry[]
  isTruncated: boolean
  nextOffset: number | null
}

export interface RuntimeRootTrashItem {
  rootRelativePath: string
  nextRootRelativePath: string | null
  absolutePath: string
  nextAbsolutePath: string | null
  ok: boolean
  reason: string | null
  error: string | null
}

export interface RuntimeRootTrashResponse {
  dryRun: boolean
  total: number
  completed: number
  failed: number
  items: RuntimeRootTrashItem[]
}

export interface RuntimeListDirectoryResponse {
  entries: RuntimeDirectoryEntry[]
  isTruncated: boolean
  nextOffset: number | null
}

export class RuntimeApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'RuntimeApiError'
    this.status = status
  }
}

function getLocalRuntimeBaseUrl(): string {
  return LOCAL_RUNTIME_BASE_URL_CONFIG
}

function normalizeEndpointPath(endpointPath: string): string {
  return endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
}

function buildRuntimeUrl(endpointPath: string): string {
  return new URL(
    normalizeEndpointPath(endpointPath),
    `${getLocalRuntimeBaseUrl().replace(/\/+$/, '')}/`,
  ).toString()
}

function createTimeoutError(timeoutMs: number): RuntimeApiError {
  return new RuntimeApiError(`Fauplay Runtime request timed out after ${timeoutMs}ms`)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toFiniteNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

async function callRuntimeJson(
  endpointPath: string,
  timeoutMs = DEFAULT_RUNTIME_TIMEOUT_MS,
  method: 'GET' | 'POST' = 'GET',
): Promise<unknown> {
  const endpoint = buildRuntimeUrl(endpointPath)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(endpoint, {
      method,
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      const message = isObject(payload) && typeof payload.error === 'string'
        ? payload.error
        : `Fauplay Runtime request failed: ${response.status}`
      throw new RuntimeApiError(message, response.status)
    }

    return payload
  } catch (error) {
    if (isAbortError(error)) {
      throw createTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function parseRuntimeHealthSnapshot(payload: unknown): RuntimeHealthSnapshot {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime health response was invalid')
  }

  return {
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    runtime: typeof payload.runtime === 'string' ? payload.runtime : 'unknown',
  }
}

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

function normalizeRootRelativePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

export async function loadRuntimeHealth(timeoutMs?: number): Promise<RuntimeHealthSnapshot> {
  const payload = await callRuntimeJson('/v1/health', timeoutMs)
  return parseRuntimeHealthSnapshot(payload)
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

export async function loadRuntimeTextPreview(
  request: RuntimeTextPreviewRequest,
  timeoutMs?: number,
): Promise<TextPreviewPayload> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath,
  })
  if (
    typeof request.sizeLimitBytes === 'number'
    && Number.isFinite(request.sizeLimitBytes)
    && request.sizeLimitBytes > 0
  ) {
    query.set('sizeLimitBytes', String(Math.trunc(request.sizeLimitBytes)))
  }

  const payload = await callRuntimeJson(`/v1/text-preview?${query.toString()}`, timeoutMs)
  return parseRuntimeTextPreviewPayload(payload)
}

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

export function buildRuntimeFileContentUrl(request: RuntimeFileContentRequest): string {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath,
  })
  return buildRuntimeUrl(`/v1/file-content?${query.toString()}`)
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

function parseRuntimeTextPreviewPayload(payload: unknown): TextPreviewPayload {
  if (!isObject(payload)) {
    return {
      status: 'error',
      content: null,
      fileSizeBytes: null,
      sizeLimitBytes: 0,
      error: 'Fauplay Runtime text preview response was invalid',
    }
  }

  const status = (
    payload.status === 'ready'
    || payload.status === 'too_large'
    || payload.status === 'binary'
    || payload.status === 'error'
  ) ? payload.status : 'error'

  return {
    status,
    content: typeof payload.content === 'string' ? payload.content : null,
    fileSizeBytes: typeof payload.fileSizeBytes === 'number' && Number.isFinite(payload.fileSizeBytes)
      ? payload.fileSizeBytes
      : null,
    sizeLimitBytes: typeof payload.sizeLimitBytes === 'number' && Number.isFinite(payload.sizeLimitBytes)
      ? payload.sizeLimitBytes
      : 0,
    error: typeof payload.error === 'string' ? payload.error : null,
  }
}

export function toRuntimeFileItems(entries: RuntimeDirectoryEntry[]): FileItem[] {
  return entries.map((entry) => {
    const lastModified = typeof entry.lastModifiedMs === 'number'
      ? new Date(entry.lastModifiedMs)
      : undefined

    return {
      name: entry.name,
      path: entry.rootRelativePath,
      kind: entry.kind,
      isEmpty: entry.isEmpty,
      size: entry.size,
      lastModified,
      lastModifiedMs: entry.lastModifiedMs,
      mimeType: entry.kind === 'file' ? getMimeType(entry.name) : undefined,
      displayPath: entry.rootRelativePath,
    }
  })
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
