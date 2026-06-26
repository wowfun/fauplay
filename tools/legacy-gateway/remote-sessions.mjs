import {
  authorizeRuntimeRemoteAccessSession,
  loginRuntimeRemoteAccessSession,
  logoutRuntimeRemoteAccessSession,
  readRuntimeRemoteFileList,
  readRuntimeRemoteRoots,
} from './remote-file-access.mjs'
import { createMcpRuntimeError } from './runtime-errors.mjs'

function createRemoteUnauthorizedError(setCookies = []) {
  const error = new Error('Unauthorized')
  error.code = 'REMOTE_UNAUTHORIZED'
  error.statusCode = 401
  error.setCookies = setCookies
  return error
}

export function createRemoteBudgetExceededError(message = 'Remote request exceeds configured budget') {
  const error = new Error(message)
  error.code = 'REMOTE_BUDGET_EXCEEDED'
  error.statusCode = 422
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
