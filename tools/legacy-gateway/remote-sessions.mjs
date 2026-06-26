import {
  authorizeRuntimeRemoteAccessSession,
  loginRuntimeRemoteAccessSession,
  logoutRuntimeRemoteAccessSession,
  readRuntimeRemoteFileContent,
  readRuntimeRemoteFileList,
  readRuntimeRemoteFileThumbnail,
  readRuntimeRemoteFavorites,
  queryRuntimeRemoteFileAnnotations,
  removeRuntimeRemoteFavorite,
  readRuntimeRemoteFileAnnotation,
  readRuntimeRemoteRoots,
  readRuntimeRemoteTagOptions,
  readRuntimeRemoteTextPreview,
  upsertRuntimeRemoteFavorite,
} from './remote-file-access.mjs'
import { createMcpRuntimeError } from './runtime-errors.mjs'

function createRemoteUnauthorizedError(setCookies = []) {
  const error = new Error('Unauthorized')
  error.code = 'REMOTE_UNAUTHORIZED'
  error.statusCode = 401
  error.setCookies = setCookies
  return error
}

export function appendRemoteRuntimeSetCookies(res, setCookies = []) {
  for (const cookie of setCookies) {
    appendSetCookieHeader(res, cookie)
  }
}

export async function forwardRemoteReadonlySessionLogin(req, res, runtimeBaseUrl, payload = {}) {
  const result = await loginRuntimeRemoteAccessSession(runtimeBaseUrl, {
    authorization: readHeader(req, 'authorization'),
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
    rememberDevice: payload.rememberDevice === true,
    rememberDeviceLabel: typeof payload.rememberDeviceLabel === 'string'
      ? payload.rememberDeviceLabel
      : '',
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlySessionLogout(req, res, runtimeBaseUrl, payload = {}) {
  const result = await logoutRuntimeRemoteAccessSession(runtimeBaseUrl, {
    cookieHeader: readHeader(req, 'cookie'),
    forgetDevice: payload.forgetDevice === true,
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyRoots(req, res, runtimeBaseUrl) {
  const result = await readRuntimeRemoteRoots(runtimeBaseUrl, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyFileList(req, res, runtimeBaseUrl, payload = {}) {
  const result = await readRuntimeRemoteFileList(runtimeBaseUrl, payload, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyFileContent(req, res, runtimeBaseUrl, query = {}) {
  const result = await readRuntimeRemoteFileContent(runtimeBaseUrl, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
    rangeHeader: readHeader(req, 'range'),
    rootId: query.rootId,
    relativePath: query.relativePath,
  })
  sendRuntimeBinaryExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyFileThumbnail(req, res, runtimeBaseUrl, query = {}) {
  const result = await readRuntimeRemoteFileThumbnail(runtimeBaseUrl, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
    rootId: query.rootId,
    relativePath: query.relativePath,
    sizePreset: query.sizePreset,
  })
  sendRuntimeBinaryExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyTextPreview(req, res, runtimeBaseUrl, payload = {}) {
  const result = await readRuntimeRemoteTextPreview(runtimeBaseUrl, payload, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyTagOptions(req, res, runtimeBaseUrl, payload = {}) {
  const result = await readRuntimeRemoteTagOptions(runtimeBaseUrl, payload, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyTagQuery(req, res, runtimeBaseUrl, payload = {}) {
  const result = await queryRuntimeRemoteFileAnnotations(runtimeBaseUrl, payload, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyTagFile(req, res, runtimeBaseUrl, payload = {}) {
  const result = await readRuntimeRemoteFileAnnotation(runtimeBaseUrl, payload, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyFavorites(req, res, runtimeBaseUrl) {
  const result = await readRuntimeRemoteFavorites(runtimeBaseUrl, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyFavoriteUpsert(req, res, runtimeBaseUrl, payload = {}) {
  const result = await upsertRuntimeRemoteFavorite(runtimeBaseUrl, payload, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function forwardRemoteReadonlyFavoriteRemove(req, res, runtimeBaseUrl, payload = {}) {
  const result = await removeRuntimeRemoteFavorite(runtimeBaseUrl, payload, {
    cookieHeader: readHeader(req, 'cookie'),
    userAgent: readHeader(req, 'user-agent'),
    forwardedFor: readRemoteReadonlyClientId(req),
  })
  sendRuntimeSessionExchangeResponse(res, result)
}

export async function ensureRemoteReadonlySessionAuthorized(
  remoteConfig,
  req,
  res,
  runtimeBaseUrl,
) {
  if (remoteConfig.enabled !== true || remoteConfig.authConfigured !== true) {
    throw createRemoteUnauthorizedError()
  }

  const result = await authorizeRuntimeRemoteAccessSession(runtimeBaseUrl, {
    cookieHeader: readHeader(req, 'cookie'),
  })
  appendRemoteRuntimeSetCookies(res, result.setCookies)

  if (result.statusCode === 204) {
    return
  }
  if (result.statusCode === 401) {
    throw createRemoteUnauthorizedError(result.setCookies)
  }
  throw createMcpRuntimeError(
    'RUNTIME_HTTP_ERROR',
    `Fauplay Runtime Remote Access session authorize request failed: ${result.statusCode}`,
    result.statusCode,
  )
}

function sendRuntimeSessionExchangeResponse(res, result) {
  appendRemoteRuntimeSetCookies(res, result.setCookies)
  res.statusCode = result.statusCode
  res.setHeader('Content-Type', result.contentType || 'application/json')
  res.end(result.body)
}

function sendRuntimeBinaryExchangeResponse(res, result) {
  appendRemoteRuntimeSetCookies(res, result.setCookies)
  const body = Buffer.isBuffer(result.body)
    ? result.body
    : Buffer.from(result.body ?? [])
  res.statusCode = result.statusCode
  res.setHeader('Content-Type', result.contentType || 'application/octet-stream')
  res.setHeader('Content-Length', String(body.length))
  if (result.acceptRanges) {
    res.setHeader('Accept-Ranges', result.acceptRanges)
  }
  if (result.cacheControl) {
    res.setHeader('Cache-Control', result.cacheControl)
  }
  if (result.contentRange) {
    res.setHeader('Content-Range', result.contentRange)
  }
  if (result.lastModified) {
    res.setHeader('Last-Modified', result.lastModified)
  }
  res.end(body)
}

function appendSetCookieHeader(res, cookieValue) {
  if (typeof cookieValue !== 'string' || !cookieValue.trim()) {
    return
  }
  const previous = res.getHeader('Set-Cookie')
  if (!previous) {
    res.setHeader('Set-Cookie', cookieValue)
    return
  }
  if (Array.isArray(previous)) {
    res.setHeader('Set-Cookie', [...previous, cookieValue])
    return
  }
  if (typeof previous === 'string' && previous) {
    res.setHeader('Set-Cookie', [previous, cookieValue])
    return
  }
  res.setHeader('Set-Cookie', cookieValue)
}

function readRemoteReadonlyClientId(req) {
  const forwardedFor = readHeader(req, 'x-forwarded-for')
  if (forwardedFor) {
    const firstHop = forwardedFor.split(',')[0]?.trim()
    if (firstHop) return firstHop
  }
  const remoteAddress = req.socket?.remoteAddress
  return typeof remoteAddress === 'string' && remoteAddress.trim()
    ? remoteAddress.trim()
    : 'unknown'
}

function readHeader(req, name) {
  const value = req.headers?.[name]
  if (Array.isArray(value)) return value[0] || ''
  return typeof value === 'string' ? value : ''
}
