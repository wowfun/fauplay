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
  const normalizedBaseUrl = String(runtimeBaseUrl || '').trim().replace(/\/+$/, '')
  if (!normalizedBaseUrl) {
    throw createMcpRuntimeError('RUNTIME_HTTP_ERROR', 'Fauplay Runtime base URL is required', 502)
  }
  const absolutePath = typeof options.absolutePath === 'string' ? options.absolutePath.trim() : ''
  if (!absolutePath) {
    throw createMcpRuntimeError('RUNTIME_HTTP_ERROR', 'absolutePath is required', 400)
  }

  const endpoint = new URL('/v1/files/content', `${normalizedBaseUrl}/`)
  endpoint.searchParams.set('absolutePath', absolutePath)
  const controller = new AbortController()
  const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_RUNTIME_CONTENT_TIMEOUT_MS
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
    if (isAbortError(error)) {
      throw createMcpRuntimeError(
        'RUNTIME_HTTP_TIMEOUT',
        `Fauplay Runtime file content request timed out after ${timeoutMs}ms`,
        504,
      )
    }
    throw error
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
