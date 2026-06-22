import { getMimeType } from '@/lib/fileSystem'
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
}

export interface RuntimeTextPreviewRequest {
  rootPath: string
  rootRelativePath: string
  sizeLimitBytes?: number
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

async function callRuntimeJson(endpointPath: string, timeoutMs = DEFAULT_RUNTIME_TIMEOUT_MS): Promise<unknown> {
  const endpoint = buildRuntimeUrl(endpointPath)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
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
