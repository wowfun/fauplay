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

function normalizeAbsolutePathInput(absolutePath) {
  const normalizedAbsolutePath = typeof absolutePath === 'string' ? absolutePath.trim() : ''
  if (!normalizedAbsolutePath) {
    throw createMcpRuntimeError('RUNTIME_HTTP_ERROR', 'absolutePath is required', 400)
  }
  return normalizedAbsolutePath
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

export function parseRemoteByteRangeHeader(rangeHeader, totalSizeBytes) {
  if (typeof rangeHeader !== 'string' || !rangeHeader.trim()) {
    return null
  }

  if (!rangeHeader.startsWith('bytes=')) {
    return { invalid: true }
  }

  if (!Number.isFinite(totalSizeBytes) || totalSizeBytes <= 0) {
    return { invalid: true }
  }

  const rawRanges = rangeHeader.slice('bytes='.length).split(',').map((value) => value.trim()).filter(Boolean)
  if (rawRanges.length !== 1) {
    return { invalid: true }
  }

  const [startPart = '', endPart = ''] = rawRanges[0].split('-', 2)
  if (!startPart && !endPart) {
    return { invalid: true }
  }

  if (!startPart) {
    const suffixLength = Number.parseInt(endPart, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { invalid: true }
    }
    const clampedLength = Math.min(suffixLength, totalSizeBytes)
    return {
      start: totalSizeBytes - clampedLength,
      end: totalSizeBytes - 1,
    }
  }

  const start = Number.parseInt(startPart, 10)
  const end = endPart ? Number.parseInt(endPart, 10) : totalSizeBytes - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalSizeBytes) {
    return { invalid: true }
  }

  return {
    start,
    end: Math.min(end, totalSizeBytes - 1),
  }
}

export function sendRemoteRangeNotSatisfiable(res, totalSizeBytes, options = {}) {
  res.statusCode = 416
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Range', `bytes */${Math.max(0, totalSizeBytes)}`)
  res.setHeader('Cache-Control', options.cacheControl || 'no-store')
  if (typeof options.lastModifiedMs === 'number' && options.lastModifiedMs > 0) {
    res.setHeader('Last-Modified', new Date(options.lastModifiedMs).toUTCString())
  }
  res.end()
}

export async function readRuntimeFileContent(runtimeBaseUrl, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const absolutePath = normalizeAbsolutePathInput(options.absolutePath)

  const endpoint = new URL('/v1/files/content', `${normalizedBaseUrl}/`)
  endpoint.searchParams.set('absolutePath', absolutePath)
  const controller = new AbortController()
  const timeoutMs = resolveRuntimeTimeout(options)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const headers = {}
  if (typeof options.rangeHeader === 'string' && options.rangeHeader.trim()) {
    headers.Range = options.rangeHeader.trim()
  }

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    const body = Buffer.from(await response.arrayBuffer())
    if (!response.ok && response.status !== 206) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_ERROR',
        `Fauplay Runtime file content request failed: ${response.status}`,
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
    rethrowRuntimeTimeout(error, timeoutMs, 'file content')
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function readRuntimeFileThumbnail(runtimeBaseUrl, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const absolutePath = normalizeAbsolutePathInput(options.absolutePath)
  const endpoint = new URL('/v1/files/thumbnail', `${normalizedBaseUrl}/`)
  endpoint.searchParams.set('absolutePath', absolutePath)
  if (typeof options.sizePreset === 'string' && options.sizePreset.trim()) {
    endpoint.searchParams.set('sizePreset', options.sizePreset.trim())
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
        `Fauplay Runtime thumbnail request failed: ${response.status}`,
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
    rethrowRuntimeTimeout(error, timeoutMs, 'thumbnail')
  } finally {
    clearTimeout(timeoutId)
  }
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

export async function readRuntimeDirectoryListing(runtimeBaseUrl, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const rootPath = normalizeRequiredStringInput(options.rootPath, 'rootPath')
  const endpoint = new URL('/v1/local-directory', `${normalizedBaseUrl}/`)
  endpoint.searchParams.set('rootPath', rootPath)
  endpoint.searchParams.set(
    'rootRelativePath',
    typeof options.rootRelativePath === 'string' ? options.rootRelativePath.trim() : '',
  )
  if (options.flattened === true) {
    endpoint.searchParams.set('flattened', 'true')
  }
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
        `Fauplay Runtime directory listing request failed: ${response.status}`,
        response.status,
      )
    }
    try {
      return body ? JSON.parse(body) : {}
    } catch (error) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_ERROR',
        `Fauplay Runtime directory listing response was not valid JSON: ${error.message}`,
        502,
      )
    }
  } catch (error) {
    rethrowRuntimeTimeout(error, timeoutMs, 'directory listing')
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function readRuntimeTagOptions(runtimeBaseUrl, options = {}) {
  const rootPath = normalizeRequiredStringInput(options.rootPath, 'rootPath')
  return postRuntimeJson(runtimeBaseUrl, '/v1/data/tags/options', { rootPath }, options)
}

export async function queryRuntimeFileAnnotations(runtimeBaseUrl, options = {}) {
  const rootPath = normalizeRequiredStringInput(options.rootPath, 'rootPath')
  return postRuntimeJson(runtimeBaseUrl, '/v1/data/tags/query', {
    rootPath,
    ...(Array.isArray(options.includeTagKeys) ? { includeTagKeys: options.includeTagKeys } : {}),
    ...(Array.isArray(options.excludeTagKeys) ? { excludeTagKeys: options.excludeTagKeys } : {}),
    ...(typeof options.includeMatchMode === 'string' ? { includeMatchMode: options.includeMatchMode } : {}),
    ...(typeof options.page !== 'undefined' ? { page: options.page } : {}),
    ...(typeof options.size !== 'undefined' ? { size: options.size } : {}),
  }, options)
}

export async function readRuntimeFileAnnotation(runtimeBaseUrl, options = {}) {
  const rootPath = normalizeRequiredStringInput(options.rootPath, 'rootPath')
  const relativePath = normalizeRequiredStringInput(options.relativePath, 'relativePath')
  return postRuntimeJson(runtimeBaseUrl, '/v1/data/tags/file', {
    rootPath,
    relativePath,
  }, options)
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

export async function readRuntimeRemoteSharedFavorites(runtimeBaseUrl, options = {}) {
  return getRuntimeJson(runtimeBaseUrl, '/v1/remote/shared-favorites', options)
}

export async function upsertRuntimeRemoteSharedFavorite(runtimeBaseUrl, options = {}) {
  const rootId = normalizeRequiredStringInput(options.rootId, 'rootId')
  const path = typeof options.path === 'string' ? options.path : ''
  return postRuntimeJson(runtimeBaseUrl, '/v1/remote/shared-favorites/upsert', {
    rootId,
    path,
    ...(typeof options.favoritedAtMs === 'number' && Number.isFinite(options.favoritedAtMs)
      ? { favoritedAtMs: options.favoritedAtMs }
      : {}),
  }, options)
}

export async function removeRuntimeRemoteSharedFavorite(runtimeBaseUrl, options = {}) {
  const rootId = normalizeRequiredStringInput(options.rootId, 'rootId')
  const path = typeof options.path === 'string' ? options.path : ''
  return postRuntimeJson(runtimeBaseUrl, '/v1/remote/shared-favorites/remove', {
    rootId,
    path,
  }, options)
}

export async function readRuntimeTextPreview(runtimeBaseUrl, options = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(runtimeBaseUrl)
  const absolutePath = normalizeAbsolutePathInput(options.absolutePath)
  const endpoint = new URL('/v1/files/text-preview', `${normalizedBaseUrl}/`)
  const controller = new AbortController()
  const timeoutMs = resolveRuntimeTimeout(options)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const payload = {
    absolutePath,
    ...(typeof options.sizeLimitBytes !== 'undefined' ? { sizeLimitBytes: options.sizeLimitBytes } : {}),
  }

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
        `Fauplay Runtime text preview request failed: ${response.status}`,
        response.status,
      )
    }
    try {
      return body ? JSON.parse(body) : {}
    } catch (error) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_ERROR',
        `Fauplay Runtime text preview response was not valid JSON: ${error.message}`,
        502,
      )
    }
  } catch (error) {
    rethrowRuntimeTimeout(error, timeoutMs, 'text preview')
  } finally {
    clearTimeout(timeoutId)
  }
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
