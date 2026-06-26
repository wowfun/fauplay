import {
  clearRemoteSession,
  getCurrentOrigin,
} from '../accessState.ts'
import { resolveLocalRuntimeBaseUrl } from './baseUrl.ts'
import {
  RuntimeHttpError,
  createRuntimeRequestTimeoutError,
} from './errors.ts'

export {
  RuntimeHttpError,
  RuntimeMcpError,
  createRuntimeRequestTimeoutError,
} from './errors.ts'

export const DEFAULT_RUNTIME_API_TIMEOUT_MS = 5000

export type ToolCallResult = Record<string, unknown> | unknown[] | string | number | boolean | null

export interface SameOriginRequestOptions {
  clearSessionOnUnauthorized?: boolean
  headers?: Record<string, string>
}

interface RuntimeHttpErrorPayload {
  ok?: boolean
  error?: string
  code?: string
}

export function getSameOriginRuntimeBaseUrl(): string {
  return getCurrentOrigin()
}

export function getLocalRuntimeBaseUrl(): string {
  return resolveLocalRuntimeBaseUrl({
    VITE_FAUPLAY_RUNTIME_BASE_URL: import.meta.env.VITE_FAUPLAY_RUNTIME_BASE_URL,
  }, getCurrentOrigin)
}

export function buildLocalRuntimeUrl(endpointPath: string): string {
  const normalizedPath = normalizeEndpointPath(endpointPath)
  return new URL(normalizedPath, `${getLocalRuntimeBaseUrl().replace(/\/+$/, '')}/`).toString()
}

export function normalizeEndpointPath(endpointPath: string): string {
  return endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
}

export function appendQueryString(baseUrl: string, query: URLSearchParams): string {
  const serialized = query.toString()
  return serialized ? `${baseUrl}?${serialized}` : baseUrl
}

export function buildRemoteLoginHeaders(token: string): Record<string, string> {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new RuntimeHttpError('远程 token 不能为空', 'REMOTE_TOKEN_REQUIRED', 400)
  }
  return {
    Authorization: `Bearer ${normalizedToken}`,
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new RuntimeHttpError(`Runtime API request failed: ${response.status}`, undefined, response.status)
    }
    return response.json()
  } catch (error) {
    if (isAbortError(error)) {
      throw createRuntimeRequestTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function callLocalRuntimeHttp<T = ToolCallResult>(
  endpointPath: string,
  body: unknown = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'
): Promise<T> {
  const effectiveTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_RUNTIME_API_TIMEOUT_MS
  const normalizedPath = normalizeEndpointPath(endpointPath)
  const endpoint = buildLocalRuntimeUrl(normalizedPath)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), effectiveTimeoutMs)

  try {
    const requestInit: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    }
    if (method !== 'GET') {
      requestInit.body = JSON.stringify(body)
    }

    const response = await fetch(endpoint, requestInit)
    const payload = (await response.json().catch(() => ({}))) as RuntimeHttpErrorPayload & T

    if (!response.ok) {
      const message = typeof payload?.error === 'string'
        ? payload.error
        : `Runtime API request failed: ${response.status}`
      const code = typeof payload?.code === 'string' ? payload.code : undefined
      throw new RuntimeHttpError(message, code, response.status)
    }

    if (
      payload
      && typeof payload === 'object'
      && 'ok' in payload
      && payload.ok === false
    ) {
      const message = typeof payload.error === 'string' ? payload.error : 'Runtime API request failed'
      const code = typeof payload.code === 'string' ? payload.code : undefined
      throw new RuntimeHttpError(message, code, response.status)
    }

    return payload as T
  } catch (error) {
    if (isAbortError(error)) {
      throw createRuntimeRequestTimeoutError(effectiveTimeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function callSameOriginRemoteHttp<T = ToolCallResult>(
  endpointPath: string,
  body: Record<string, unknown> = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' = 'POST',
  query?: URLSearchParams,
  options: SameOriginRequestOptions = {},
): Promise<T> {
  const effectiveTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_RUNTIME_API_TIMEOUT_MS
  const normalizedPath = normalizeEndpointPath(endpointPath)
  const baseUrl = `${getSameOriginRuntimeBaseUrl()}${normalizedPath}`
  const endpoint = query ? appendQueryString(baseUrl, query) : baseUrl
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), effectiveTimeoutMs)

  try {
    const requestInit: RequestInit = {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    }
    if (method !== 'GET') {
      requestInit.body = JSON.stringify(body)
    }

    const response = await fetch(endpoint, requestInit)
    const payload = (await response.json().catch(() => ({}))) as RuntimeHttpErrorPayload & T

    if (!response.ok) {
      if (response.status === 401) {
        handleRemoteUnauthorizedResponse(response.status, options)
      }
      const message = typeof payload?.error === 'string'
        ? payload.error
        : `Runtime API request failed: ${response.status}`
      const code = typeof payload?.code === 'string' ? payload.code : undefined
      throw new RuntimeHttpError(message, code, response.status)
    }

    if (
      payload
      && typeof payload === 'object'
      && 'ok' in payload
      && payload.ok === false
    ) {
      const message = typeof payload.error === 'string' ? payload.error : 'Runtime API request failed'
      const code = typeof payload.code === 'string' ? payload.code : undefined
      throw new RuntimeHttpError(message, code, response.status)
    }

    return payload as T
  } catch (error) {
    if (isAbortError(error)) {
      throw createRuntimeRequestTimeoutError(effectiveTimeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function callRemoteRuntimeHttp<T = ToolCallResult>(
  endpointPath: string,
  body: Record<string, unknown> = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' = 'POST',
  query?: URLSearchParams
): Promise<T> {
  return callSameOriginRemoteHttp(endpointPath, body, timeoutMs, method, query)
}

export async function fetchSameOriginJsonWithTimeout(
  endpointPath: string,
  timeoutMs: number,
  options: SameOriginRequestOptions = {}
): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${getSameOriginRuntimeBaseUrl()}${normalizeEndpointPath(endpointPath)}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: options.headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401) {
        handleRemoteUnauthorizedResponse(response.status, options)
      }
      throw new RuntimeHttpError(`Runtime API request failed: ${response.status}`, undefined, response.status)
    }
    return response.json()
  } catch (error) {
    if (isAbortError(error)) {
      throw createRuntimeRequestTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function handleRemoteUnauthorizedResponse(
  status: number,
  { clearSessionOnUnauthorized = true }: SameOriginRequestOptions = {}
): never {
  if (clearSessionOnUnauthorized) {
    clearRemoteSession({ emitInvalidatedEvent: true })
  }
  throw new RuntimeHttpError('远程会话已失效，请重新连接', 'REMOTE_UNAUTHORIZED', status)
}
