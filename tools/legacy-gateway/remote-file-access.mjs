import { createMcpRuntimeError } from './runtime-errors.mjs'

const DEFAULT_RUNTIME_CONTENT_TIMEOUT_MS = readPositiveIntegerEnv(
  'FAUPLAY_RUNTIME_CONTENT_TIMEOUT_MS',
  120000,
)

function readPositiveIntegerEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function normalizeRuntimeBaseUrl(runtimeBaseUrl) {
  const normalizedBaseUrl = String(runtimeBaseUrl || '').trim().replace(/\/+$/, '')
  if (!normalizedBaseUrl) {
    throw createMcpRuntimeError('RUNTIME_HTTP_ERROR', 'Fauplay Runtime base URL is required', 502)
  }
  return normalizedBaseUrl
}

function normalizeRequiredStringInput(value, fieldName) {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  if (!normalizedValue) {
    throw createMcpRuntimeError('RUNTIME_HTTP_ERROR', `${fieldName} is required`, 400)
  }
  return normalizedValue
}

function resolveRuntimeTimeout(options = {}) {
  return typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_RUNTIME_CONTENT_TIMEOUT_MS
}

function rethrowRuntimeTimeout(error, timeoutMs, operation) {
  if (isAbortError(error)) {
    throw createMcpRuntimeError(
      'RUNTIME_HTTP_TIMEOUT',
      `Fauplay Runtime ${operation} request timed out after ${timeoutMs}ms`,
      504,
    )
  }
  throw error
}

async function postRuntimeJson(runtimeBaseUrl, pathname, payload, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const endpoint = new URL(pathname, `${normalizedBaseUrl}/`)
  const controller = new AbortController()
  const timeoutMs = resolveRuntimeTimeout(options)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_ERROR',
        `Fauplay Runtime ${pathname} request failed: ${response.status}`,
        response.status,
      )
    }
    try {
      return body ? JSON.parse(body) : {}
    } catch (error) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_ERROR',
        `Fauplay Runtime ${pathname} response was not valid JSON: ${error.message}`,
        502,
      )
    }
  } catch (error) {
    rethrowRuntimeTimeout(error, timeoutMs, pathname)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function getRuntimeJson(runtimeBaseUrl, pathname, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const endpoint = new URL(pathname, `${normalizedBaseUrl}/`)
  const controller = new AbortController()
  const timeoutMs = resolveRuntimeTimeout(options)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: 'GET',
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_ERROR',
        `Fauplay Runtime ${pathname} request failed: ${response.status}`,
        response.status,
      )
    }
    try {
      return body ? JSON.parse(body) : {}
    } catch (error) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_ERROR',
        `Fauplay Runtime ${pathname} response was not valid JSON: ${error.message}`,
        502,
      )
    }
  } catch (error) {
    rethrowRuntimeTimeout(error, timeoutMs, pathname)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function getRuntimeJsonExchange(runtimeBaseUrl, pathname, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const endpoint = new URL(pathname, `${normalizedBaseUrl}/`)
  const controller = new AbortController()
  const timeoutMs = resolveRuntimeTimeout(options)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const headers = {
    ...(typeof options.cookieHeader === 'string' && options.cookieHeader.trim()
      ? { Cookie: options.cookieHeader.trim() }
      : {}),
    ...(typeof options.userAgent === 'string' && options.userAgent.trim()
      ? { 'User-Agent': options.userAgent.trim() }
      : {}),
    ...(typeof options.forwardedFor === 'string' && options.forwardedFor.trim()
      ? { 'X-Forwarded-For': options.forwardedFor.trim() }
      : {}),
  }

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    return {
      statusCode: response.status,
      contentType: response.headers.get('content-type') || 'application/json',
      setCookies: responseSetCookies(response),
      body: await response.text(),
    }
  } catch (error) {
    rethrowRuntimeTimeout(error, timeoutMs, pathname)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function getRuntimeBinaryExchange(runtimeBaseUrl, pathname, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const endpoint = new URL(pathname, `${normalizedBaseUrl}/`)
  appendRuntimeQueryParams(endpoint, options.query)
  const controller = new AbortController()
  const timeoutMs = resolveRuntimeTimeout(options)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const headers = {
    ...(typeof options.cookieHeader === 'string' && options.cookieHeader.trim()
      ? { Cookie: options.cookieHeader.trim() }
      : {}),
    ...(typeof options.userAgent === 'string' && options.userAgent.trim()
      ? { 'User-Agent': options.userAgent.trim() }
      : {}),
    ...(typeof options.forwardedFor === 'string' && options.forwardedFor.trim()
      ? { 'X-Forwarded-For': options.forwardedFor.trim() }
      : {}),
    ...(typeof options.rangeHeader === 'string' && options.rangeHeader.trim()
      ? { Range: options.rangeHeader.trim() }
      : {}),
  }

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    return {
      statusCode: response.status,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      setCookies: responseSetCookies(response),
      acceptRanges: response.headers.get('accept-ranges'),
      cacheControl: response.headers.get('cache-control'),
      contentRange: response.headers.get('content-range'),
      lastModified: response.headers.get('last-modified'),
      body: Buffer.from(await response.arrayBuffer()),
    }
  } catch (error) {
    rethrowRuntimeTimeout(error, timeoutMs, pathname)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function postRuntimeJsonExchange(runtimeBaseUrl, pathname, payload, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const endpoint = new URL(pathname, `${normalizedBaseUrl}/`)
  const controller = new AbortController()
  const timeoutMs = resolveRuntimeTimeout(options)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const headers = {
    'Content-Type': 'application/json',
    ...(typeof options.authorization === 'string' && options.authorization.trim()
      ? { Authorization: options.authorization.trim() }
      : {}),
    ...(typeof options.cookieHeader === 'string' && options.cookieHeader.trim()
      ? { Cookie: options.cookieHeader.trim() }
      : {}),
    ...(typeof options.userAgent === 'string' && options.userAgent.trim()
      ? { 'User-Agent': options.userAgent.trim() }
      : {}),
    ...(typeof options.forwardedFor === 'string' && options.forwardedFor.trim()
      ? { 'X-Forwarded-For': options.forwardedFor.trim() }
      : {}),
  }

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    return {
      statusCode: response.status,
      contentType: response.headers.get('content-type') || 'application/json',
      setCookies: responseSetCookies(response),
      body: await response.text(),
    }
  } catch (error) {
    rethrowRuntimeTimeout(error, timeoutMs, pathname)
  } finally {
    clearTimeout(timeoutId)
  }
}

function appendRuntimeQueryParams(endpoint, query) {
  if (!query || typeof query !== 'object') {
    return
  }
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string') {
      continue
    }
    const normalizedValue = value.trim()
    if (normalizedValue) {
      endpoint.searchParams.set(key, normalizedValue)
    }
  }
}

function responseSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie()
  }
  const raw = response.headers.get('set-cookie') ?? ''
  return raw.split(/,\s*(?=__Host-fauplay-remote-)/).filter(Boolean)
}

export async function readRuntimeFaceCrop(runtimeBaseUrl, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const faceId = normalizeRequiredStringInput(options.faceId, 'faceId')
  const endpoint = new URL(`/v1/faces/crops/${encodeURIComponent(faceId)}`, `${normalizedBaseUrl}/`)
  if (typeof options.rootPath === 'string' && options.rootPath.trim()) {
    endpoint.searchParams.set('rootPath', options.rootPath.trim())
  }
  if (typeof options.size === 'string' && options.size.trim()) {
    endpoint.searchParams.set('size', options.size.trim())
  }
  if (typeof options.padding === 'string' && options.padding.trim()) {
    endpoint.searchParams.set('padding', options.padding.trim())
  }
  const controller = new AbortController()
  const timeoutMs = resolveRuntimeTimeout(options)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: 'GET',
      signal: controller.signal,
    })
    const body = Buffer.from(await response.arrayBuffer())
    if (!response.ok) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_ERROR',
        `Fauplay Runtime face crop request failed: ${response.status}`,
        response.status,
      )
    }
    return {
      statusCode: response.status,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      acceptRanges: response.headers.get('accept-ranges') || 'bytes',
      contentRange: response.headers.get('content-range'),
      body,
    }
  } catch (error) {
    rethrowRuntimeTimeout(error, timeoutMs, 'face crop')
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function listRuntimePeople(runtimeBaseUrl, options = {}) {
  const rootPath = normalizeRequiredStringInput(options.rootPath, 'rootPath')
  return postRuntimeJson(runtimeBaseUrl, '/v1/faces/list-people', {
    rootPath,
    scope: 'root',
    ...(typeof options.query === 'string' ? { query: options.query } : {}),
    ...(typeof options.page !== 'undefined' ? { page: options.page } : {}),
    ...(typeof options.size !== 'undefined' ? { size: options.size } : {}),
  }, options)
}

export async function listRuntimeAssetFaces(runtimeBaseUrl, options = {}) {
  const rootPath = normalizeRequiredStringInput(options.rootPath, 'rootPath')
  const personId = typeof options.personId === 'string' ? options.personId.trim() : ''
  const relativePath = typeof options.relativePath === 'string' ? options.relativePath.trim() : ''
  if (!personId && !relativePath) {
    throw createMcpRuntimeError('RUNTIME_HTTP_ERROR', 'personId or relativePath is required', 400)
  }
  return postRuntimeJson(runtimeBaseUrl, '/v1/faces/list-asset-faces', {
    rootPath,
    ...(personId ? { personId } : {}),
    ...(relativePath ? { relativePath } : {}),
  }, options)
}

export async function readRuntimeRemoteTagOptions(runtimeBaseUrl, payload, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/tags/options', payload, options)
}

export async function queryRuntimeRemoteFileAnnotations(runtimeBaseUrl, payload, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/tags/query', payload, options)
}

export async function readRuntimeRemoteFileAnnotation(runtimeBaseUrl, payload, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/tags/file', payload, options)
}

export async function readRuntimeRemoteFavorites(runtimeBaseUrl, options = {}) {
  return getRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/favorites', options)
}

export async function readRuntimeRemoteAccessConfig(runtimeBaseUrl, options = {}) {
  return getRuntimeJson(runtimeBaseUrl, '/v1/remote/access/config', options)
}

export async function readRuntimeRemoteRoots(runtimeBaseUrl, options = {}) {
  return getRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/roots', options)
}

export async function readRuntimeRemoteFileList(runtimeBaseUrl, payload, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/files/list', payload, options)
}

export async function readRuntimeRemoteFileContent(runtimeBaseUrl, options = {}) {
  return getRuntimeBinaryExchange(runtimeBaseUrl, '/v1/remote/files/content', {
    ...options,
    query: {
      rootId: options.rootId,
      relativePath: options.relativePath,
    },
  })
}

export async function readRuntimeRemoteFileThumbnail(runtimeBaseUrl, options = {}) {
  return getRuntimeBinaryExchange(runtimeBaseUrl, '/v1/remote/files/thumbnail', {
    ...options,
    query: {
      rootId: options.rootId,
      relativePath: options.relativePath,
      sizePreset: options.sizePreset,
    },
  })
}

export async function readRuntimeRemoteTextPreview(runtimeBaseUrl, payload, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/files/text-preview', payload, options)
}

export async function loginRuntimeRemoteAccessSession(runtimeBaseUrl, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/session/login', {
    rememberDevice: options.rememberDevice === true,
    rememberDeviceLabel: typeof options.rememberDeviceLabel === 'string'
      ? options.rememberDeviceLabel
      : '',
  }, options)
}

export async function authorizeRuntimeRemoteAccessSession(runtimeBaseUrl, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/session/authorize', {}, options)
}

export async function logoutRuntimeRemoteAccessSession(runtimeBaseUrl, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/session/logout', {
    forgetDevice: options.forgetDevice === true,
  }, options)
}

export async function upsertRuntimeRemoteFavorite(runtimeBaseUrl, payload, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/favorites/upsert', payload, options)
}

export async function removeRuntimeRemoteFavorite(runtimeBaseUrl, payload, options = {}) {
  return postRuntimeJsonExchange(runtimeBaseUrl, '/v1/remote/favorites/remove', payload, options)
}

export function sendRuntimeFileContentResponse(res, runtimeResponse, options = {}) {
  const body = Buffer.isBuffer(runtimeResponse.body)
    ? runtimeResponse.body
    : Buffer.from(runtimeResponse.body ?? [])
  res.statusCode = runtimeResponse.statusCode === 206 ? 206 : 200
  res.setHeader('Content-Type', runtimeResponse.contentType || 'application/octet-stream')
  res.setHeader('Accept-Ranges', runtimeResponse.acceptRanges || 'bytes')
  res.setHeader('Content-Length', String(body.length))
  res.setHeader('Cache-Control', options.cacheControl || 'no-store')
  if (runtimeResponse.contentRange) {
    res.setHeader('Content-Range', runtimeResponse.contentRange)
  }
  if (typeof options.lastModifiedMs === 'number' && options.lastModifiedMs > 0) {
    res.setHeader('Last-Modified', new Date(options.lastModifiedMs).toUTCString())
  }
  res.end(body)
}
