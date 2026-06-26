import { randomUUID } from 'node:crypto'
import { createMcpRuntimeError } from './runtime-errors.mjs'

const REMOTE_SESSION_COOKIE_NAME = '__Host-fauplay-remote-session'
const REMOTE_REMEMBER_DEVICE_COOKIE_NAME = '__Host-fauplay-remote-remember-device'
const REMOTE_SESSION_ABSOLUTE_TTL_MS = readPositiveIntegerEnv('FAUPLAY_REMOTE_SESSION_ABSOLUTE_TTL_MS', 12 * 60 * 60 * 1000)
const REMOTE_SESSION_IDLE_TTL_MS = readPositiveIntegerEnv('FAUPLAY_REMOTE_SESSION_IDLE_TTL_MS', 30 * 60 * 1000)
export const REMOTE_REMEMBER_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REMOTE_LOGIN_FAILURE_WINDOW_MS = readPositiveIntegerEnv('FAUPLAY_REMOTE_LOGIN_FAILURE_WINDOW_MS', 10 * 60 * 1000)
const REMOTE_LOGIN_MAX_FAILURES = readPositiveIntegerEnv('FAUPLAY_REMOTE_LOGIN_MAX_FAILURES', 8)
const REMOTE_LOGIN_BLOCK_DURATION_MS = readPositiveIntegerEnv('FAUPLAY_REMOTE_LOGIN_BLOCK_DURATION_MS', 10 * 60 * 1000)
const REMEMBER_DEVICE_LABEL_MAX_LENGTH = 80

function readPositiveIntegerEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

export function normalizeRememberedDeviceLabel(value, { required = false } = {}) {
  if (value == null) {
    if (required) {
      throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'remembered-device label is required', 400)
    }
    return ''
  }
  if (typeof value !== 'string') {
    throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'remembered-device label must be a string', 400)
  }
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    if (required) {
      return ''
    }
    return ''
  }
  return normalized.slice(0, REMEMBER_DEVICE_LABEL_MAX_LENGTH)
}

function createRemoteUnauthorizedError() {
  const error = new Error('Unauthorized')
  error.code = 'REMOTE_UNAUTHORIZED'
  error.statusCode = 401
  return error
}

export function createRemoteBudgetExceededError(message = 'Remote request exceeds configured budget') {
  const error = new Error(message)
  error.code = 'REMOTE_BUDGET_EXCEEDED'
  error.statusCode = 422
  return error
}

function appendSetCookieHeader(res, cookieValue) {
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

function parseCookieHeader(cookieHeader) {
  if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) {
    return new Map()
  }

  const cookies = new Map()
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = part.split('=')
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (!name) continue
    const value = rawValueParts.join('=').trim()
    cookies.set(name, value)
  }
  return cookies
}

function readCookieValue(req, cookieName) {
  const rawCookie = Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie
  const cookies = parseCookieHeader(rawCookie)
  const encodedValue = cookies.get(cookieName)
  if (typeof encodedValue !== 'string' || !encodedValue) {
    return ''
  }
  try {
    return decodeURIComponent(encodedValue)
  } catch {
    return ''
  }
}

function readRemoteReadonlySessionId(req) {
  return readCookieValue(req, REMOTE_SESSION_COOKIE_NAME)
}

function readRemoteRememberDeviceCookie(req) {
  return readCookieValue(req, REMOTE_REMEMBER_DEVICE_COOKIE_NAME)
}

function readRequestUserAgent(req) {
  const raw = req.headers['user-agent']
  if (Array.isArray(raw)) return raw[0] || ''
  return typeof raw === 'string' ? raw : ''
}

function createRemoteSessionCookie(sessionId) {
  const maxAgeSeconds = Math.max(1, Math.ceil(REMOTE_SESSION_ABSOLUTE_TTL_MS / 1000))
  return [
    `${REMOTE_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

function createRemoteRememberDeviceCookie(cookieValue, expiresAtMs, nowMs = Date.now()) {
  const maxAgeMs = Math.max(0, expiresAtMs - nowMs)
  const maxAgeSeconds = Math.max(1, Math.ceil(maxAgeMs / 1000))
  return [
    `${REMOTE_REMEMBER_DEVICE_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

function createExpiredRemoteSessionCookie() {
  return [
    `${REMOTE_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
  ].join('; ')
}

function createExpiredRemoteRememberDeviceCookie() {
  return [
    `${REMOTE_REMEMBER_DEVICE_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
  ].join('; ')
}

function createRemoteReadonlySessionRecord(nowMs, rememberedDeviceId = null) {
  const normalizedRememberedDeviceId = typeof rememberedDeviceId === 'string' && rememberedDeviceId.trim()
    ? rememberedDeviceId.trim()
    : null
  return {
    createdAtMs: nowMs,
    lastSeenAtMs: nowMs,
    rememberedDeviceId: normalizedRememberedDeviceId,
  }
}

export function clearRemoteReadonlySession(res, remoteSessions, req) {
  const sessionId = readRemoteReadonlySessionId(req)
  if (sessionId) {
    remoteSessions.delete(sessionId)
  }
  appendSetCookieHeader(res, createExpiredRemoteSessionCookie())
}

export function clearRemoteReadonlySessionsByRememberedDeviceIds(remoteSessions, rememberedDeviceIds) {
  if (!Array.isArray(rememberedDeviceIds) || rememberedDeviceIds.length === 0) {
    return
  }
  const targetIds = new Set(
    rememberedDeviceIds
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  if (targetIds.size === 0) {
    return
  }
  for (const [sessionId, session] of remoteSessions.entries()) {
    const rememberedDeviceId = typeof session?.rememberedDeviceId === 'string'
      ? session.rememberedDeviceId.trim()
      : ''
    if (rememberedDeviceId && targetIds.has(rememberedDeviceId)) {
      remoteSessions.delete(sessionId)
    }
  }
}

export async function clearRemoteRememberedDevice(res, remoteSessions, remoteRememberedDevices, req) {
  const cookieValue = readRemoteRememberDeviceCookie(req)
  if (cookieValue) {
    const revokedDeviceIds = await remoteRememberedDevices.revoke(cookieValue)
    clearRemoteReadonlySessionsByRememberedDeviceIds(remoteSessions, revokedDeviceIds)
  }
  appendSetCookieHeader(res, createExpiredRemoteRememberDeviceCookie())
}

export function readRemoteReadonlyClientId(req) {
  const forwardedFor = req.headers['x-forwarded-for']
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  if (typeof forwardedValue === 'string' && forwardedValue.trim()) {
    const firstHop = forwardedValue.split(',')[0]?.trim()
    if (firstHop) return firstHop
  }
  const remoteAddress = req.socket?.remoteAddress
  return typeof remoteAddress === 'string' && remoteAddress.trim()
    ? remoteAddress.trim()
    : 'unknown'
}

function pruneRemoteReadonlyLoginFailures(state, nowMs) {
  const failures = Array.isArray(state?.failures)
    ? state.failures.filter((ts) => Number.isFinite(ts) && nowMs - ts <= REMOTE_LOGIN_FAILURE_WINDOW_MS)
    : []
  return {
    failures,
    blockedUntilMs: Number.isFinite(state?.blockedUntilMs) ? state.blockedUntilMs : 0,
  }
}

export function ensureRemoteReadonlyLoginAllowed(remoteLoginAttempts, clientId, nowMs = Date.now()) {
  const nextState = pruneRemoteReadonlyLoginFailures(remoteLoginAttempts.get(clientId), nowMs)
  if (nextState.blockedUntilMs > nowMs) {
    remoteLoginAttempts.set(clientId, nextState)
    throw createRemoteUnauthorizedError()
  }
  if (nextState.failures.length > 0 || nextState.blockedUntilMs > 0) {
    remoteLoginAttempts.set(clientId, nextState)
  } else {
    remoteLoginAttempts.delete(clientId)
  }
}

export function registerRemoteReadonlyLoginFailure(remoteLoginAttempts, clientId, nowMs = Date.now()) {
  const nextState = pruneRemoteReadonlyLoginFailures(remoteLoginAttempts.get(clientId), nowMs)
  nextState.failures.push(nowMs)
  if (nextState.failures.length >= REMOTE_LOGIN_MAX_FAILURES) {
    nextState.blockedUntilMs = nowMs + REMOTE_LOGIN_BLOCK_DURATION_MS
  }
  remoteLoginAttempts.set(clientId, nextState)
}

export function clearRemoteReadonlyLoginFailures(remoteLoginAttempts, clientId) {
  remoteLoginAttempts.delete(clientId)
}

function cleanupExpiredRemoteReadonlySessions(remoteSessions, nowMs = Date.now()) {
  for (const [sessionId, session] of remoteSessions.entries()) {
    const createdAtMs = Number(session?.createdAtMs)
    const lastSeenAtMs = Number(session?.lastSeenAtMs)
    if (
      !Number.isFinite(createdAtMs)
      || !Number.isFinite(lastSeenAtMs)
      || nowMs - createdAtMs > REMOTE_SESSION_ABSOLUTE_TTL_MS
      || nowMs - lastSeenAtMs > REMOTE_SESSION_IDLE_TTL_MS
    ) {
      remoteSessions.delete(sessionId)
    }
  }
}

export function issueRemoteReadonlySession(res, remoteSessions, req, nowMs = Date.now(), options = {}) {
  cleanupExpiredRemoteReadonlySessions(remoteSessions, nowMs)
  const existingSessionId = readRemoteReadonlySessionId(req)
  if (existingSessionId) {
    remoteSessions.delete(existingSessionId)
  }
  const nextSessionId = randomUUID()
  const rememberedDeviceId = typeof options?.rememberedDeviceId === 'string'
    ? options.rememberedDeviceId
    : null
  remoteSessions.set(nextSessionId, createRemoteReadonlySessionRecord(nowMs, rememberedDeviceId))
  appendSetCookieHeader(res, createRemoteSessionCookie(nextSessionId))
  return nextSessionId
}

export async function issueRemoteRememberedDevice(res, remoteSessions, remoteRememberedDevices, req, nowMs = Date.now(), options = {}) {
  const existingCookieValue = readRemoteRememberDeviceCookie(req)
  if (existingCookieValue) {
    const revokedDeviceIds = await remoteRememberedDevices.revoke(existingCookieValue, nowMs)
    clearRemoteReadonlySessionsByRememberedDeviceIds(remoteSessions, revokedDeviceIds)
  }
  const rememberedDevice = await remoteRememberedDevices.create(nowMs, {
    label: normalizeRememberedDeviceLabel(options.label),
    userAgent: readRequestUserAgent(req),
  })
  appendSetCookieHeader(
    res,
    createRemoteRememberDeviceCookie(rememberedDevice.cookieValue, rememberedDevice.expiresAtMs, nowMs),
  )
  return rememberedDevice
}

export async function ensureRemoteReadonlySessionAuthorized(
  remoteConfig,
  req,
  res,
  remoteSessions,
  remoteRememberedDevices,
) {
  if (remoteConfig.enabled !== true || !remoteConfig.token) {
    throw createRemoteUnauthorizedError()
  }

  const nowMs = Date.now()
  cleanupExpiredRemoteReadonlySessions(remoteSessions, nowMs)
  const sessionId = readRemoteReadonlySessionId(req)
  if (sessionId) {
    const session = remoteSessions.get(sessionId)
    if (session) {
      session.lastSeenAtMs = nowMs
      return sessionId
    }
  }

  const rememberDeviceCookie = readRemoteRememberDeviceCookie(req)
  if (!rememberDeviceCookie) {
    throw createRemoteUnauthorizedError()
  }

  const rotatedRememberedDevice = await remoteRememberedDevices.rotate(rememberDeviceCookie, nowMs)
  if (!rotatedRememberedDevice) {
    throw createRemoteUnauthorizedError()
  }

  appendSetCookieHeader(
    res,
    createRemoteRememberDeviceCookie(
      rotatedRememberedDevice.cookieValue,
      rotatedRememberedDevice.expiresAtMs,
      nowMs,
    ),
  )
  return issueRemoteReadonlySession(res, remoteSessions, req, nowMs, {
    rememberedDeviceId: rotatedRememberedDevice.id,
  })
}
