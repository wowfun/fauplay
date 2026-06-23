const LOCAL_RUNTIME_BASE_URL_CONFIG =
  (import.meta.env.VITE_FAUPLAY_RUNTIME_BASE_URL as string | undefined)?.trim()
  || 'http://127.0.0.1:3211'

export const DEFAULT_RUNTIME_TIMEOUT_MS = 120000

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

export function buildRuntimeUrl(endpointPath: string): string {
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

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toFiniteNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

export async function callRuntimeJson(
  endpointPath: string,
  timeoutMs = DEFAULT_RUNTIME_TIMEOUT_MS,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<unknown> {
  const endpoint = buildRuntimeUrl(endpointPath)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const requestInit: RequestInit = {
      method,
      signal: controller.signal,
    }
    if (typeof body !== 'undefined') {
      requestInit.headers = {
        'Content-Type': 'application/json',
      }
      requestInit.body = JSON.stringify(body)
    }
    const response = await fetch(endpoint, {
      ...requestInit,
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

export async function callRuntimeHttp<T = unknown>(
  endpointPath: string,
  body: unknown = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'POST',
): Promise<T> {
  return callRuntimeJson(
    endpointPath,
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_RUNTIME_TIMEOUT_MS,
    method,
    method === 'GET' ? undefined : body,
  ) as Promise<T>
}

export function normalizeRootRelativePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

export function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

export function joinRootPath(rootPath: string, rootRelativePath: string): string | undefined {
  const normalizedRootPath = rootPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedRootRelativePath = normalizeRootRelativePath(rootRelativePath)
  if (!normalizedRootPath || !normalizedRootRelativePath) {
    return undefined
  }
  return `${normalizedRootPath}/${normalizedRootRelativePath}`
}
