import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { McpHostRuntime, createMcpRuntimeError } from './mcp/runtime.mjs'
import { GLOBAL_ENV_PATH, loadGlobalEnvFile } from './env.mjs'
import {
  batchRebindPaths,
  ensureFileEntries,
  queryDuplicateFiles,
  detectAssets,
  createDetectAssetsJob,
  getDetectAssetsJob,
  cancelDetectAssetsJob,
  listDetectAssetsJobItems,
  assignFaces,
  bindAnnotationTag,
  callVisionInference,
  clusterPendingFaces,
  listRecycleItems,
  moveFilesToRecycle,
  createPersonFromFaces,
  getFileTags,
  readFileContentByAbsolutePath,
  readFileTextPreview,
  getFaceCrop,
  ignoreFaces,
  ingestClassificationResult,
  listAssetFaces,
  listPeople,
  listReviewFaces,
  listTagOptions,
  mergePeople,
  queryFilesByTags,
  requeueFaces,
  renamePerson,
  restoreRecycleItems,
  restoreIgnoredFaces,
  saveDetectedFaces,
  setAnnotationValue,
  suggestPeople,
  unassignFaces,
  unbindAnnotationTag,
  cleanupMissingFiles,
} from './data/core.mjs'
import { resolveRootPath } from './data/common.mjs'
import {
  ensureRemoteReadonlyAuthorized,
  formatRemoteAccessConfigSourceLog,
  getRemoteReadonlyCapabilities,
  getRemoteReadonlyFileTags,
  listRemoteReadonlyFiles,
  listRemoteReadonlyPeople,
  listRemoteReadonlyPersonFaces,
  listRemoteReadonlyRoots,
  listRemoteReadonlyTagOptions,
  loadRemoteReadonlyConfig,
  queryRemoteReadonlyFilesByTags,
  readRemoteReadonlyFaceCrop,
  readRemoteReadonlyThumbnailContent,
  readRemoteReadonlyTextPreview,
  resolveRemoteReadonlyFileResource,
} from './remote-readonly.mjs'
import {
  createRemoteRememberedDeviceStore,
  DEFAULT_REMOTE_REMEMBER_DEVICE_TTL_MS,
} from './remembered-devices.mjs'
import {
  createRemotePublishedRootsStore,
  createRemoteSharedFavoritesStore,
} from './remote-shared-state.mjs'

const DEFAULT_PORT = Number(process.env.FAUPLAY_GATEWAY_PORT || 3210)
const DEFAULT_HOST = '127.0.0.1'
const GATEWAY_VERSION = '0.2.0'
const MCP_PROTOCOL_VERSION = '2025-11-05'
const MCP_SESSION_HEADER = 'mcp-session-id'
const REMOTE_SESSION_COOKIE_NAME = '__Host-fauplay-remote-session'
const REMOTE_REMEMBER_DEVICE_COOKIE_NAME = '__Host-fauplay-remote-remember-device'
const PROJECT_ROOT = process.cwd()
const DEFAULT_MCP_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'src', 'config', 'mcp.json')
const GLOBAL_MCP_CONFIG_PATH = path.join(os.homedir(), '.fauplay', 'global', 'mcp.json')
const GLOBAL_SHORTCUTS_CONFIG_PATH = path.join(os.homedir(), '.fauplay', 'global', 'shortcuts.json')
const REMOTE_CONTENT_CACHE_CONTROL = 'private, no-store'
const REMOTE_DERIVATIVE_CACHE_CONTROL = 'private, max-age=300'
const REMOTE_SESSION_ABSOLUTE_TTL_MS = readPositiveIntegerEnv('FAUPLAY_REMOTE_SESSION_ABSOLUTE_TTL_MS', 12 * 60 * 60 * 1000)
const REMOTE_SESSION_IDLE_TTL_MS = readPositiveIntegerEnv('FAUPLAY_REMOTE_SESSION_IDLE_TTL_MS', 30 * 60 * 1000)
const REMOTE_REMEMBER_DEVICE_TTL_MS = DEFAULT_REMOTE_REMEMBER_DEVICE_TTL_MS
const REMOTE_LOGIN_FAILURE_WINDOW_MS = readPositiveIntegerEnv('FAUPLAY_REMOTE_LOGIN_FAILURE_WINDOW_MS', 10 * 60 * 1000)
const REMOTE_LOGIN_MAX_FAILURES = readPositiveIntegerEnv('FAUPLAY_REMOTE_LOGIN_MAX_FAILURES', 8)
const REMOTE_LOGIN_BLOCK_DURATION_MS = readPositiveIntegerEnv('FAUPLAY_REMOTE_LOGIN_BLOCK_DURATION_MS', 10 * 60 * 1000)
const REMOTE_MAX_RANGE_BYTES = readPositiveIntegerEnv('FAUPLAY_REMOTE_MAX_RANGE_BYTES', 16 * 1024 * 1024)
const REMEMBER_DEVICE_LABEL_MAX_LENGTH = 80

function resolveConfigPath(configPath) {
  if (typeof configPath !== 'string' || !configPath.trim()) {
    return configPath
  }
  return path.isAbsolute(configPath) ? configPath : path.resolve(PROJECT_ROOT, configPath)
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

async function readOptionalFileFingerprint(filePath) {
  try {
    const result = await stat(filePath)
    return `${result.size}:${Math.trunc(result.mtimeMs)}`
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return 'missing'
    }
    throw error
  }
}

async function createRemoteReadonlyRuntimeFingerprint(configSources) {
  const parts = []
  for (const source of configSources) {
    parts.push(`${source.label}:${await readOptionalFileFingerprint(source.path)}`)
  }
  parts.push(`env:${await readOptionalFileFingerprint(GLOBAL_ENV_PATH)}`)
  return parts.join('|')
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${MCP_SESSION_HEADER}`)
  res.setHeader('Access-Control-Expose-Headers', MCP_SESSION_HEADER)
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function sendBinary(res, statusCode, body, contentType, options = {}) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', String(body.length))
  res.setHeader('Cache-Control', options.cacheControl || 'no-store')
  if (options.headers && typeof options.headers === 'object') {
    for (const [key, value] of Object.entries(options.headers)) {
      if (typeof value === 'string' && value) {
        res.setHeader(key, value)
      }
    }
  }
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    throw createMcpRuntimeError('MCP_PARSE_ERROR', 'Request body must be valid JSON', 400)
  }
}

function toStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string')
}

function toStringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const next = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      next[key] = item
    }
  }

  return Object.keys(next).length > 0 ? next : undefined
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeRememberedDeviceLabel(value, { required = false } = {}) {
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

function normalizeRemoteFavoritePath(value) {
  if (typeof value !== 'string') {
    throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'path must be a string', 400)
  }
  const trimmed = value.trim()
  if (!trimmed) return ''
  const segments = trimmed.replace(/\\/g, '/').split('/').filter(Boolean)
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.includes('\0')) {
      throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'path contains invalid value', 400)
    }
  }
  return segments.join('/')
}

function parseBatchRenameRebindMappings(toolResult) {
  if (!isObjectRecord(toolResult)) return []
  const items = Array.isArray(toolResult.items) ? toolResult.items : []
  const mappings = []
  for (const item of items) {
    if (!isObjectRecord(item)) continue
    if (item.ok !== true || item.skipped === true) continue
    const fromRelativePath = typeof item.relativePath === 'string' ? item.relativePath.trim() : ''
    const toRelativePath = typeof item.nextRelativePath === 'string' ? item.nextRelativePath.trim() : ''
    if (!fromRelativePath || !toRelativePath || fromRelativePath === toRelativePath) continue
    mappings.push({ fromRelativePath, toRelativePath })
  }
  return mappings
}

function appendPostProcessWarning(result, warning) {
  if (!isObjectRecord(result)) return result
  const previous = typeof result.postProcessWarning === 'string' ? result.postProcessWarning : ''
  result.postProcessWarning = previous ? `${previous}; ${warning}` : warning
  return result
}

function resolveCwd(projectDir, cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return undefined
  return path.isAbsolute(cwd) ? cwd : path.resolve(projectDir, cwd)
}

function toConfigObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function formatMcpConfigSourceLog(source) {
  const suffix = source.loaded ? '' : ' (missing, skipped)'
  return `[gateway]   - ${source.label}: ${source.path}${suffix}`
}

function formatShortcutConfigSourceLog(source) {
  let suffix = ''
  if (source.status === 'missing') {
    suffix = ' (missing, skipped)'
  } else if (source.status === 'invalid') {
    suffix = ' (invalid JSON)'
  } else if (source.status === 'unavailable') {
    suffix = ' (read failed)'
  }
  return `[gateway]   - ${source.label}: ${source.path}${suffix}`
}

async function readMcpConfigFile(configPath, { allowMissing = false } = {}) {
  let raw = ''
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    if (allowMissing && error && typeof error === 'object' && error.code === 'ENOENT') {
      return null
    }
    throw createMcpRuntimeError('MCP_CONFIG_ERROR', `Failed to read MCP config: ${configPath}`, 500)
  }

  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw createMcpRuntimeError('MCP_CONFIG_ERROR', `Invalid JSON in MCP config: ${configPath}`, 500)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createMcpRuntimeError('MCP_CONFIG_ERROR', `MCP config root must be an object: ${configPath}`, 500)
  }

  return parsed
}

async function readOptionalJsonFile(configPath) {
  let raw = ''
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {
        loaded: false,
        config: null,
      }
    }
    throw createMcpRuntimeError('CONFIG_READ_ERROR', `Failed to read config: ${configPath}`, 500)
  }

  try {
    return {
      loaded: true,
      config: JSON.parse(raw),
    }
  } catch {
    throw createMcpRuntimeError('CONFIG_JSON_INVALID', `Invalid JSON in config: ${configPath}`, 400)
  }
}

async function inspectShortcutConfigSource(configPath) {
  try {
    const result = await readOptionalJsonFile(configPath)
    return {
      label: 'global',
      path: configPath,
      status: result.loaded ? 'loaded' : 'missing',
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'CONFIG_JSON_INVALID') {
      return {
        label: 'global',
        path: configPath,
        status: 'invalid',
      }
    }
    return {
      label: 'global',
      path: configPath,
      status: 'unavailable',
    }
  }
}

function mergeMcpServerEntries(baseEntry, overrideEntry) {
  if (!baseEntry || typeof baseEntry !== 'object' || Array.isArray(baseEntry)) {
    return overrideEntry
  }
  if (!overrideEntry || typeof overrideEntry !== 'object' || Array.isArray(overrideEntry)) {
    return overrideEntry ?? baseEntry
  }
  return {
    ...baseEntry,
    ...overrideEntry,
  }
}

function mergeMcpConfig(baseConfig, overrideConfig) {
  const base = toConfigObject(baseConfig)
  const override = toConfigObject(overrideConfig)

  const merged = {
    ...base,
    ...override,
  }

  const baseServers = toConfigObject(base.servers)
  const overrideServers = toConfigObject(override.servers)
  const hasServers = Object.keys(baseServers).length > 0 || Object.keys(overrideServers).length > 0

  if (hasServers) {
    const mergedServers = {}
    const serverNames = new Set([...Object.keys(baseServers), ...Object.keys(overrideServers)])
    for (const name of serverNames) {
      mergedServers[name] = mergeMcpServerEntries(baseServers[name], overrideServers[name])
    }
    merged.servers = mergedServers
  }

  return merged
}

async function loadMcpServersFromConfig(configPath, { useGlobalConfig = true } = {}) {
  const resolvedConfigPath = resolveConfigPath(configPath)
  const configSources = []
  const baseConfig = await readMcpConfigFile(resolvedConfigPath)
  configSources.push({
    label: useGlobalConfig ? 'default' : 'custom',
    path: resolvedConfigPath,
    loaded: true,
  })
  const globalConfig = useGlobalConfig
    ? await readMcpConfigFile(GLOBAL_MCP_CONFIG_PATH, { allowMissing: true })
    : null
  if (useGlobalConfig) {
    configSources.push({
      label: 'global',
      path: GLOBAL_MCP_CONFIG_PATH,
      loaded: Boolean(globalConfig),
    })
  }
  const parsed = mergeMcpConfig(baseConfig, globalConfig)

  const servers = parsed.servers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return {
      serverRegistry: [],
      configSources,
    }
  }

  const serversToLoad = []

  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }
    if (entry.disabled === true) {
      continue
    }

    const type = typeof entry.type === 'string' && entry.type ? entry.type : 'stdio'
    if (type !== 'stdio') {
      console.warn(`[gateway] Skip MCP server "${name}": unsupported type "${type}"`)
      continue
    }

    const command = typeof entry.command === 'string' ? entry.command.trim() : ''
    if (!command) {
      console.warn(`[gateway] Skip MCP server "${name}": missing command`)
      continue
    }

    serversToLoad.push({
      transport: 'stdio',
      sourceLabel: name,
      command,
      args: toStringArray(entry.args),
      cwd: resolveCwd(PROJECT_ROOT, entry.cwd),
      env: toStringRecord(entry.env),
      callTimeoutMs: entry.callTimeoutMs,
      initTimeoutMs: entry.initTimeoutMs,
      restartWindowMs: entry.restartWindowMs,
      maxCrashesInWindow: entry.maxCrashesInWindow,
      restartCooldownMs: entry.restartCooldownMs,
    })
  }

  return {
    serverRegistry: serversToLoad,
    configSources,
  }
}

async function createMcpServerRegistry(configPath, options) {
  return loadMcpServersFromConfig(configPath, options)
}

function parseJsonRpcRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    throw createMcpRuntimeError('MCP_INVALID_REQUEST', 'Invalid JSON-RPC request payload', 400)
  }

  if (payload.jsonrpc !== '2.0') {
    throw createMcpRuntimeError('MCP_INVALID_REQUEST', 'jsonrpc must be "2.0"', 400)
  }

  const method = payload.method
  if (typeof method !== 'string' || !method) {
    throw createMcpRuntimeError('MCP_INVALID_REQUEST', 'method is required', 400)
  }

  return {
    id: payload.id,
    method,
    params: isObjectRecord(payload.params) ? payload.params : {},
  }
}

function readSessionId(req) {
  const raw = req.headers[MCP_SESSION_HEADER]
  if (Array.isArray(raw)) return raw[0] || null
  return typeof raw === 'string' && raw ? raw : null
}

function createRemoteUnauthorizedError() {
  const error = new Error('Unauthorized')
  error.code = 'REMOTE_UNAUTHORIZED'
  error.statusCode = 401
  return error
}

function createRemoteBudgetExceededError(message = 'Remote request exceeds configured budget') {
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

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function isLoopbackHostname(hostname) {
  const normalized = typeof hostname === 'string'
    ? hostname.trim().replace(/^\[|\]$/g, '').toLowerCase()
    : ''
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function isLoopbackAdminRequest(req, hostname) {
  if (!isLoopbackHostname(hostname)) {
    return false
  }
  const remoteAddress = typeof req.socket?.remoteAddress === 'string' ? req.socket.remoteAddress.trim() : ''
  if (!isLoopbackAddress(remoteAddress)) {
    return false
  }
  const forwardedFor = req.headers['x-forwarded-for']
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  if (typeof forwardedValue === 'string' && forwardedValue.trim()) {
    const firstHop = forwardedValue.split(',')[0]?.trim() || ''
    if (!isLoopbackAddress(firstHop)) {
      return false
    }
  }
  const originHeader = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
  if (typeof originHeader === 'string' && originHeader.trim()) {
    try {
      if (!isLoopbackHostname(new URL(originHeader).hostname)) {
        return false
      }
    } catch {
      return false
    }
  }
  const refererHeader = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer
  if (typeof refererHeader === 'string' && refererHeader.trim()) {
    try {
      if (!isLoopbackHostname(new URL(refererHeader).hostname)) {
        return false
      }
    } catch {
      return false
    }
  }
  return true
}

function ensureLoopbackAdminRequest(req, hostname, pathname) {
  if (!isLoopbackAdminRequest(req, hostname)) {
    throwHttpGatewayRouteNotFound(pathname)
  }
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

function clearRemoteReadonlySession(res, remoteSessions, req) {
  const sessionId = readRemoteReadonlySessionId(req)
  if (sessionId) {
    remoteSessions.delete(sessionId)
  }
  appendSetCookieHeader(res, createExpiredRemoteSessionCookie())
}

function clearRemoteReadonlySessionsByRememberedDeviceIds(remoteSessions, rememberedDeviceIds) {
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

async function clearRemoteRememberedDevice(res, remoteSessions, remoteRememberedDevices, req) {
  const cookieValue = readRemoteRememberDeviceCookie(req)
  if (cookieValue) {
    const revokedDeviceIds = await remoteRememberedDevices.revoke(cookieValue)
    clearRemoteReadonlySessionsByRememberedDeviceIds(remoteSessions, revokedDeviceIds)
  }
  appendSetCookieHeader(res, createExpiredRemoteRememberDeviceCookie())
}

function readRemoteReadonlyClientId(req) {
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

function ensureRemoteReadonlyLoginAllowed(remoteLoginAttempts, clientId, nowMs = Date.now()) {
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

function registerRemoteReadonlyLoginFailure(remoteLoginAttempts, clientId, nowMs = Date.now()) {
  const nextState = pruneRemoteReadonlyLoginFailures(remoteLoginAttempts.get(clientId), nowMs)
  nextState.failures.push(nowMs)
  if (nextState.failures.length >= REMOTE_LOGIN_MAX_FAILURES) {
    nextState.blockedUntilMs = nowMs + REMOTE_LOGIN_BLOCK_DURATION_MS
  }
  remoteLoginAttempts.set(clientId, nextState)
}

function clearRemoteReadonlyLoginFailures(remoteLoginAttempts, clientId) {
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

function issueRemoteReadonlySession(res, remoteSessions, req, nowMs = Date.now(), options = {}) {
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

async function issueRemoteRememberedDevice(res, remoteSessions, remoteRememberedDevices, req, nowMs = Date.now(), options = {}) {
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

async function ensureRemoteReadonlySessionAuthorized(
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

async function sendRemoteReadonlyError(res, remoteSessions, remoteRememberedDevices, req, error) {
  const statusCode = resolveErrorStatusCode(error)
  if (statusCode === 401) {
    clearRemoteReadonlySession(res, remoteSessions, req)
    await clearRemoteRememberedDevice(res, remoteSessions, remoteRememberedDevices, req)
  }
  sendJson(res, statusCode, toHttpErrorBody(error))
}

function toJsonRpcError(error) {
  if (error?.code === 'MCP_PARSE_ERROR') {
    return {
      code: -32700,
      message: error.message || 'Parse error',
      data: { code: 'MCP_PARSE_ERROR' },
    }
  }

  if (error?.code === 'MCP_INVALID_REQUEST') {
    return {
      code: -32600,
      message: error.message || 'Invalid Request',
      data: { code: 'MCP_INVALID_REQUEST' },
    }
  }

  if (error?.code === 'MCP_METHOD_NOT_FOUND') {
    return {
      code: -32601,
      message: error.message || 'Method not found',
      data: { code: 'MCP_METHOD_NOT_FOUND' },
    }
  }

  if (error?.code === 'MCP_INVALID_PARAMS') {
    return {
      code: -32602,
      message: error.message || 'Invalid params',
      data: { code: 'MCP_INVALID_PARAMS' },
    }
  }

  return {
    code: -32000,
    message: error instanceof Error ? error.message : 'Server error',
    data: {
      code: error?.code || 'MCP_RUNTIME_ERROR',
    },
  }
}

function resolveErrorStatusCode(error) {
  const explicit = Number(error?.statusCode)
  if (Number.isInteger(explicit) && explicit >= 100 && explicit <= 599) {
    return explicit
  }

  if (error?.code === 'SQLITE_CONSTRAINT') return 409
  if (error?.code === 'MCP_TOOL_NOT_FOUND') return 404
  if (error?.code === 'MCP_INVALID_PARAMS') return 400
  if (error?.code === 'MCP_SERVER_TIMEOUT') return 504
  if (error?.code === 'MCP_SERVER_CRASHED') return 502

  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  if (message.includes('required') || message.includes('invalid') || message.includes('must')) return 400
  if (message.includes('not found')) return 404
  return 500
}

function toHttpErrorBody(error) {
  const message = error instanceof Error ? error.message : 'Gateway request failed'
  const code = typeof error?.code === 'string' ? error.code : 'GATEWAY_HTTP_ERROR'
  return {
    ok: false,
    error: message,
    code,
  }
}

function throwHttpGatewayRouteNotFound(pathname) {
  throw createMcpRuntimeError('MCP_METHOD_NOT_FOUND', `Not found: ${pathname}`, 404)
}

function throwHttpGatewayRouteOffline(pathname) {
  throw createMcpRuntimeError(
    'MCP_METHOD_NOT_FOUND',
    `Endpoint offline: ${pathname}`,
    404,
  )
}

function createExactHttpGatewayRoute(method, pathname, handler) {
  return {
    method,
    matches(candidatePathname) {
      return candidatePathname === pathname
    },
    handler,
  }
}

function createPrefixHttpGatewayRoute(method, prefix, handler) {
  return {
    method,
    matches(candidatePathname) {
      return candidatePathname.startsWith(prefix)
    },
    handler,
  }
}

function parseFaceScanJobPath(pathname) {
  const prefix = '/v1/faces/detect-assets/jobs/'
  if (!pathname.startsWith(prefix)) {
    throwHttpGatewayRouteNotFound(pathname)
  }
  const suffix = pathname.slice(prefix.length)
  const parts = suffix.split('/').filter(Boolean)
  if (parts.length > 2) {
    throwHttpGatewayRouteNotFound(pathname)
  }
  const jobId = parts.length > 0 ? decodeURIComponent(parts[0]) : ''
  if (!jobId) {
    throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'jobId is required', 400)
  }
  return {
    jobId,
    action: parts[1] || '',
  }
}

const httpGatewayRoutes = [
  createExactHttpGatewayRoute('POST', '/v1/data/tags/file', ({ payload }) => getFileTags(payload)),
  createExactHttpGatewayRoute('POST', '/v1/data/tags/options', ({ payload }) => listTagOptions(payload)),
  createExactHttpGatewayRoute('POST', '/v1/data/tags/query', ({ payload }) => queryFilesByTags(payload)),
  createExactHttpGatewayRoute('PUT', '/v1/file-annotations', ({ payload }) => setAnnotationValue(payload)),
  createExactHttpGatewayRoute('POST', '/v1/file-annotations/tags/bind', ({ payload }) => bindAnnotationTag(payload)),
  createExactHttpGatewayRoute('POST', '/v1/file-annotations/tags/unbind', ({ payload }) => unbindAnnotationTag(payload)),
  createExactHttpGatewayRoute('PATCH', '/v1/files/relative-paths', ({ payload }) => batchRebindPaths(payload)),
  createExactHttpGatewayRoute('POST', '/v1/files/indexes', ({ payload }) => ensureFileEntries(payload)),
  createExactHttpGatewayRoute('POST', '/v1/files/duplicates/query', ({ payload }) => queryDuplicateFiles(payload)),
  createExactHttpGatewayRoute('POST', '/v1/files/missing/cleanups', ({ payload }) => cleanupMissingFiles(payload)),
  createExactHttpGatewayRoute('POST', '/v1/files/text-preview', ({ payload }) => readFileTextPreview(payload)),
  createExactHttpGatewayRoute('POST', '/v1/recycle/items/move', ({ payload }) => moveFilesToRecycle(payload)),
  createExactHttpGatewayRoute('POST', '/v1/recycle/items/list', ({ payload }) => listRecycleItems(payload)),
  createExactHttpGatewayRoute('POST', '/v1/recycle/items/restore', ({ payload }) => restoreRecycleItems(payload)),
  createExactHttpGatewayRoute('POST', '/v1/file-bindings/reconciliations', ({ pathname }) => {
    throwHttpGatewayRouteOffline(pathname)
  }),
  createExactHttpGatewayRoute('POST', '/v1/file-bindings/cleanups', ({ pathname }) => {
    throwHttpGatewayRouteOffline(pathname)
  }),
  createExactHttpGatewayRoute('POST', '/v1/faces/detect-asset', async ({ runtime, payload }) => {
    const inferred = await callVisionInference(runtime, payload)
    const persisted = await saveDetectedFaces({
      rootPath: inferred.rootPath,
      relativePath: inferred.relativePath,
      facePayloads: inferred.faces,
    })
    const runCluster = payload?.runCluster === true
    const hasVideoFaces = persisted.faces.some((face) => face?.mediaType === 'video')
    const cluster = runCluster && persisted.created > 0
      ? await clusterPendingFaces({
        limit: persisted.created,
        assetId: persisted.assetId,
        minFaces: hasVideoFaces ? 3 : 1,
      })
      : null
    return {
      ...persisted,
      inferenceDetected: inferred.detected,
      ...(cluster ? { cluster } : {}),
    }
  }),
  createExactHttpGatewayRoute('POST', '/v1/faces/detect-assets', ({ runtime, payload }) => detectAssets(runtime, payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/detect-assets/jobs', ({ runtime, payload }) => createDetectAssetsJob(runtime, payload)),
  createPrefixHttpGatewayRoute('GET', '/v1/faces/detect-assets/jobs/', ({ pathname, requestUrl }) => {
    const { jobId, action } = parseFaceScanJobPath(pathname)
    if (!action) {
      return getDetectAssetsJob(jobId)
    }
    if (action === 'items') {
      return listDetectAssetsJobItems(jobId, {
        offset: requestUrl.searchParams.get('offset'),
        limit: requestUrl.searchParams.get('limit'),
      })
    }
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/faces/detect-assets/jobs/', ({ pathname }) => {
    const { jobId, action } = parseFaceScanJobPath(pathname)
    if (action === 'cancel') {
      return cancelDetectAssetsJob(jobId)
    }
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createExactHttpGatewayRoute('POST', '/v1/faces/cluster-pending', ({ payload }) => clusterPendingFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/list-people', ({ payload }) => listPeople(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/rename-person', ({ payload }) => renamePerson(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/merge-people', ({ payload }) => mergePeople(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/list-asset-faces', ({ payload }) => listAssetFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/list-review-faces', ({ payload }) => listReviewFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/suggest-people', ({ payload }) => suggestPeople(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/assign-faces', ({ payload }) => assignFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/create-person-from-faces', ({ payload }) => createPersonFromFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/unassign-faces', ({ payload }) => unassignFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/ignore-faces', ({ payload }) => ignoreFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/restore-ignored-faces', ({ payload }) => restoreIgnoredFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/requeue-faces', ({ payload }) => requeueFaces(payload)),
  createPrefixHttpGatewayRoute('POST', '/v1/local-data/', ({ pathname }) => {
    throwHttpGatewayRouteOffline(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/annotations/', ({ pathname }) => {
    throwHttpGatewayRouteOffline(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/data/tags/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/file-annotations/tags/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/files/duplicates/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/files/missing/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/file-bindings/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/faces/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/recycle/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
]

function findHttpGatewayRoute(method, pathname) {
  return httpGatewayRoutes.find((route) => route.method === method && route.matches(pathname)) ?? null
}

async function handleHttpGatewayRoute(runtime, method, pathname, payload, requestUrl) {
  const route = findHttpGatewayRoute(method, pathname)
  if (!route) {
    throwHttpGatewayRouteNotFound(pathname)
  }
  return route.handler({
    runtime,
    pathname,
    payload,
    requestUrl,
  })
}

function buildInitializeResult() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'fauplay-local-gateway',
      version: GATEWAY_VERSION,
    },
  }
}

async function postProcessClassificationToolCall(toolName, toolArgs, result) {
  if ((toolName !== 'ml.classifyImage' && toolName !== 'ml.classifyBatch') || !isObjectRecord(toolArgs)) {
    return
  }

  const rootPath = typeof toolArgs.rootPath === 'string' ? toolArgs.rootPath : ''
  if (!rootPath) return

  await ingestClassificationResult({
    rootPath,
    toolName,
    toolArgs,
    toolResult: result,
  })
}

async function postProcessBatchRenameToolCall(toolName, toolArgs, result) {
  if (toolName !== 'fs.batchRename' || !isObjectRecord(toolArgs) || !isObjectRecord(result)) {
    return
  }

  const confirm = toolArgs.confirm === true
  const renamed = Number(result.renamed ?? 0)

  if (!confirm || renamed <= 0) {
    return
  }

  const rootPath = typeof toolArgs.rootPath === 'string' ? toolArgs.rootPath.trim() : ''
  const mappings = parseBatchRenameRebindMappings(result)

  if (!rootPath) {
    appendPostProcessWarning(result, 'batchRebindPaths skipped: missing rootPath')
    return
  }

  if (mappings.length === 0) {
    return
  }

  try {
    const rebindResult = await batchRebindPaths({
      rootPath,
      mappings,
    })
    result.rebindResult = rebindResult
    if (Number(rebindResult?.failed ?? 0) > 0) {
      appendPostProcessWarning(
        result,
        `batchRebindPaths completed with ${rebindResult.failed} failed item(s)`,
      )
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    console.warn(`[gateway] fs.batchRename post-process batchRebindPaths failed: ${reason}`)
    appendPostProcessWarning(result, `batchRebindPaths failed: ${reason}`)
  }
}

async function postProcessToolCallResult(toolName, toolArgs, result) {
  await postProcessClassificationToolCall(toolName, toolArgs, result)
  await postProcessBatchRenameToolCall(toolName, toolArgs, result)
}

async function handleMcpRequest(runtime, request, sessions, sessionId) {
  if (request.method === 'initialize') {
    const nextSessionId = randomUUID()
    sessions.set(nextSessionId, {
      initialized: true,
      clientReady: false,
    })

    return {
      sessionId: nextSessionId,
      result: buildInitializeResult(),
    }
  }

  const state = sessionId ? sessions.get(sessionId) : null
  if (!state) {
    throw createMcpRuntimeError('MCP_INVALID_REQUEST', `Missing or invalid ${MCP_SESSION_HEADER} header`, 400)
  }

  if (request.method === 'tools/list') {
    if (!state.initialized || !state.clientReady) {
      throw createMcpRuntimeError('MCP_INVALID_REQUEST', 'Client must complete initialize lifecycle', 400)
    }
    return { sessionId, result: { tools: runtime.listTools() } }
  }

  if (request.method === 'tools/call') {
    if (!state.initialized || !state.clientReady) {
      throw createMcpRuntimeError('MCP_INVALID_REQUEST', 'Client must complete initialize lifecycle', 400)
    }

    const toolName = request.params?.name
    const toolArgs = request.params?.arguments

    if (typeof toolName !== 'string' || !toolName) {
      throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'params.name is required for tools/call', 400)
    }
    if (!isObjectRecord(toolArgs)) {
      throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'params.arguments must be an object', 400)
    }

    const result = await runtime.callTool(toolName, toolArgs)
    return { sessionId, result: result ?? {} }
  }

  if (request.method === 'notifications/initialized') {
    if (!state.initialized) {
      throw createMcpRuntimeError('MCP_INVALID_REQUEST', 'initialize is required before initialized notification', 400)
    }
    state.clientReady = true
    return { sessionId, result: null }
  }

  throw createMcpRuntimeError('MCP_METHOD_NOT_FOUND', `Unsupported MCP method: ${request.method}`, 404)
}

function parseByteRangeHeader(rangeHeader, totalSizeBytes) {
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

function sendRangeNotSatisfiable(res, totalSizeBytes, options = {}) {
  res.statusCode = 416
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Range', `bytes */${Math.max(0, totalSizeBytes)}`)
  res.setHeader('Cache-Control', options.cacheControl || 'no-store')
  if (typeof options.lastModifiedMs === 'number' && options.lastModifiedMs > 0) {
    res.setHeader('Last-Modified', new Date(options.lastModifiedMs).toUTCString())
  }
  res.end()
}

async function sendFileStreamResponse(
  req,
  res,
  absolutePath,
  contentType,
  totalSizeBytes,
  options = {},
) {
  const range = parseByteRangeHeader(req.headers.range, totalSizeBytes)
  if (range && range.invalid === true) {
    sendRangeNotSatisfiable(res, totalSizeBytes, options)
    return
  }

  const start = range ? range.start : 0
  const end = range ? range.end : Math.max(totalSizeBytes - 1, 0)
  const contentLength = totalSizeBytes === 0 ? 0 : Math.max(0, end - start + 1)
  const statusCode = range ? 206 : 200

  res.statusCode = statusCode
  res.setHeader('Content-Type', contentType)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Length', String(contentLength))
  res.setHeader('Cache-Control', options.cacheControl || 'no-store')
  if (typeof options.lastModifiedMs === 'number' && options.lastModifiedMs > 0) {
    res.setHeader('Last-Modified', new Date(options.lastModifiedMs).toUTCString())
  }
  if (range) {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSizeBytes}`)
  }

  if (totalSizeBytes === 0) {
    res.end()
    return
  }

  const stream = createReadStream(absolutePath, { start, end })
  await new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      stream.off('error', handleError)
      res.off('error', handleError)
      res.off('close', handleClose)
      res.off('finish', handleFinish)
    }

    const settle = (callback) => (value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }

    const handleError = settle(reject)
    const handleFinish = settle(resolve)
    const handleClose = settle(() => {
      stream.destroy()
      resolve()
    })

    stream.on('error', handleError)
    res.on('error', handleError)
    res.on('close', handleClose)
    res.on('finish', handleFinish)
    stream.pipe(res)
  })
}

async function sendFileContentBinaryResponse(res, absolutePath) {
  try {
    const result = await readFileContentByAbsolutePath({
      absolutePath,
    })
    sendBinary(res, 200, result.body, result.contentType)
  } catch (error) {
    sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
  }
}

export async function startGatewayServer(options = {}) {
  const host = options.host || DEFAULT_HOST
  const port = Number(options.port || DEFAULT_PORT)
  const hasCustomMcpConfig = typeof options.mcpConfigPath === 'string' && options.mcpConfigPath
  const configPath = hasCustomMcpConfig ? resolveConfigPath(options.mcpConfigPath) : DEFAULT_MCP_CONFIG_PATH
  const { serverRegistry, configSources } = await createMcpServerRegistry(configPath, {
    useGlobalConfig: !hasCustomMcpConfig,
  })
  const shortcutConfigSource = await inspectShortcutConfigSource(GLOBAL_SHORTCUTS_CONFIG_PATH)
  const remotePublishedRoots = createRemotePublishedRootsStore()
  const remoteSharedFavorites = createRemoteSharedFavoritesStore()
  let remoteReadonlyConfig = await loadRemoteReadonlyConfig()
  if (remoteReadonlyConfig.rootSource === 'local-browser-sync') {
    remoteReadonlyConfig.roots = await remotePublishedRoots.listResolvedRoots()
  }
  let remoteReadonlyConfigFingerprint = await createRemoteReadonlyRuntimeFingerprint(remoteReadonlyConfig.configSources)

  const runtime = new McpHostRuntime({
    serverRegistry,
    callTimeoutMs: Number(process.env.FAUPLAY_MCP_CALL_TIMEOUT_MS || 5000),
    initTimeoutMs: Number(process.env.FAUPLAY_MCP_INIT_TIMEOUT_MS || 2000),
    restartWindowMs: Number(process.env.FAUPLAY_MCP_RESTART_WINDOW_MS || 10000),
    maxCrashesInWindow: Number(process.env.FAUPLAY_MCP_MAX_CRASHES || 3),
    restartCooldownMs: Number(process.env.FAUPLAY_MCP_RESTART_COOLDOWN_MS || 15000),
  })

  await runtime.initialize()
  const clientSessions = new Map()
  const remoteReadonlySessions = new Map()
  const remoteReadonlyLoginAttempts = new Map()
  const remoteRememberedDevices = createRemoteRememberedDeviceStore({
    ttlMs: REMOTE_REMEMBER_DEVICE_TTL_MS,
  })

  const hydrateRemoteReadonlyRoots = async (config) => {
    if (config.rootSource === 'local-browser-sync') {
      config.roots = await remotePublishedRoots.listResolvedRoots()
    }
    return config
  }

  const refreshRemoteReadonlyConfigIfNeeded = async () => {
    const nextFingerprint = await createRemoteReadonlyRuntimeFingerprint(remoteReadonlyConfig.configSources)
    if (nextFingerprint === remoteReadonlyConfigFingerprint) {
      return hydrateRemoteReadonlyRoots(remoteReadonlyConfig)
    }

    remoteReadonlySessions.clear()
    remoteReadonlyLoginAttempts.clear()
    await remoteRememberedDevices.clearAll()
    delete process.env.FAUPLAY_REMOTE_ACCESS_TOKEN
    await loadGlobalEnvFile()
    remoteReadonlyConfig = await loadRemoteReadonlyConfig()
    await hydrateRemoteReadonlyRoots(remoteReadonlyConfig)
    remoteReadonlyConfigFingerprint = await createRemoteReadonlyRuntimeFingerprint(remoteReadonlyConfig.configSources)
    return remoteReadonlyConfig
  }

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res)
    const method = req.method || 'GET'

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    const pathname = requestUrl.pathname
    const requestHostname = requestUrl.hostname

    if (method === 'GET' && pathname === '/v1/health') {
      sendJson(res, 200, {
        service: 'fauplay-local-gateway',
        version: GATEWAY_VERSION,
        status: 'ok',
      })
      return
    }

    if (method === 'GET' && pathname === '/v1/config/shortcuts') {
      try {
        const result = await readOptionalJsonFile(GLOBAL_SHORTCUTS_CONFIG_PATH)
        sendJson(res, 200, {
          ok: true,
          loaded: result.loaded,
          path: GLOBAL_SHORTCUTS_CONFIG_PATH,
          ...(result.loaded ? { config: result.config } : {}),
        })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/admin/remembered-devices') {
      try {
        ensureLoopbackAdminRequest(req, requestHostname, pathname)
        await refreshRemoteReadonlyConfigIfNeeded()
        const items = await remoteRememberedDevices.list()
        sendJson(res, 200, { items })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/admin/remembered-devices/revoke-all') {
      try {
        ensureLoopbackAdminRequest(req, requestHostname, pathname)
        await refreshRemoteReadonlyConfigIfNeeded()
        const revokedDeviceIds = await remoteRememberedDevices.clearAll()
        clearRemoteReadonlySessionsByRememberedDeviceIds(remoteReadonlySessions, revokedDeviceIds)
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (pathname.startsWith('/v1/admin/remembered-devices/')) {
      if (method === 'PATCH') {
        try {
          ensureLoopbackAdminRequest(req, requestHostname, pathname)
          await refreshRemoteReadonlyConfigIfNeeded()
          const rawDeviceId = pathname.slice('/v1/admin/remembered-devices/'.length)
          let deviceId = ''
          try {
            deviceId = rawDeviceId ? decodeURIComponent(rawDeviceId).trim() : ''
          } catch {
            throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'deviceId must be valid', 400)
          }
          if (!deviceId || deviceId.includes('/')) {
            throwHttpGatewayRouteNotFound(pathname)
          }
          const payload = await readJsonBody(req)
          if (!isObjectRecord(payload)) {
            throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
          }
          const label = normalizeRememberedDeviceLabel(payload.label, { required: true })
          await remoteRememberedDevices.renameById(deviceId, label)
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
        }
        return
      }

      if (method === 'DELETE') {
        try {
          ensureLoopbackAdminRequest(req, requestHostname, pathname)
          await refreshRemoteReadonlyConfigIfNeeded()
          const rawDeviceId = pathname.slice('/v1/admin/remembered-devices/'.length)
          let deviceId = ''
          try {
            deviceId = rawDeviceId ? decodeURIComponent(rawDeviceId).trim() : ''
          } catch {
            throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'deviceId must be valid', 400)
          }
          if (!deviceId || deviceId.includes('/')) {
            throwHttpGatewayRouteNotFound(pathname)
          }
          const revokedDeviceIds = await remoteRememberedDevices.revokeById(deviceId)
          if (revokedDeviceIds.length === 0) {
            throwHttpGatewayRouteNotFound(pathname)
          }
          clearRemoteReadonlySessionsByRememberedDeviceIds(remoteReadonlySessions, revokedDeviceIds)
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
        }
        return
      }
    }

    if (method === 'POST' && pathname === '/v1/admin/remote-published-roots/sync-from-local-browser') {
      try {
        ensureLoopbackAdminRequest(req, requestHostname, pathname)
        await refreshRemoteReadonlyConfigIfNeeded()
        const payload = await readJsonBody(req)
        if (!Array.isArray(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON array', 400)
        }

        const nowMs = Date.now()
        const replaceResult = await remotePublishedRoots.replaceAll(payload, nowMs)
        if (replaceResult.removedRootIds.length > 0) {
          await remoteSharedFavorites.removeByRootIds(replaceResult.removedRootIds)
        }

        const favoriteSeeds = []
        for (const item of payload) {
          if (!isObjectRecord(item)) continue
          const absolutePath = typeof item.absolutePath === 'string' ? item.absolutePath.trim() : ''
          if (!absolutePath) continue
          let normalizedAbsolutePath = ''
          try {
            normalizedAbsolutePath = resolveRootPath(absolutePath)
          } catch {
            continue
          }
          const publishedRoot = replaceResult.itemsByAbsolutePath.get(normalizedAbsolutePath)
          if (!publishedRoot) continue
          const favoritePaths = Array.isArray(item.favoritePaths) ? item.favoritePaths : []
          for (const favoritePath of favoritePaths) {
            if (typeof favoritePath !== 'string') continue
            favoriteSeeds.push({
              rootId: publishedRoot.id,
              path: favoritePath,
              favoritedAtMs: nowMs,
            })
          }
        }
        await remoteSharedFavorites.upsertBatch(favoriteSeeds, nowMs)
        await hydrateRemoteReadonlyRoots(remoteReadonlyConfig)
        sendJson(res, 200, {
          ok: true,
          publishedRootCount: replaceResult.items.length,
        })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/capabilities') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        sendJson(res, 200, getRemoteReadonlyCapabilities(currentRemoteReadonlyConfig))
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/session/login') {
      const remoteClientId = readRemoteReadonlyClientId(req)
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        const rememberDevice = normalizeBoolean(payload.rememberDevice)
        const rememberDeviceLabel = rememberDevice
          ? normalizeRememberedDeviceLabel(payload.rememberDeviceLabel)
          : ''
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        const nowMs = Date.now()
        ensureRemoteReadonlyLoginAllowed(remoteReadonlyLoginAttempts, remoteClientId)
        ensureRemoteReadonlyAuthorized(currentRemoteReadonlyConfig, req.headers)
        clearRemoteReadonlyLoginFailures(remoteReadonlyLoginAttempts, remoteClientId)
        let rememberedDeviceId = null
        if (rememberDevice) {
          const rememberedDevice = await issueRemoteRememberedDevice(
            res,
            remoteReadonlySessions,
            remoteRememberedDevices,
            req,
            nowMs,
            { label: rememberDeviceLabel },
          )
          rememberedDeviceId = rememberedDevice.id
        } else {
          await clearRemoteRememberedDevice(res, remoteReadonlySessions, remoteRememberedDevices, req)
        }
        issueRemoteReadonlySession(res, remoteReadonlySessions, req, nowMs, { rememberedDeviceId })
        res.statusCode = 204
        res.end()
      } catch (error) {
        if (resolveErrorStatusCode(error) === 401) {
          registerRemoteReadonlyLoginFailure(remoteReadonlyLoginAttempts, remoteClientId)
        }
        clearRemoteReadonlySession(res, remoteReadonlySessions, req)
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/session/logout') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        clearRemoteReadonlySession(res, remoteReadonlySessions, req)
        if (normalizeBoolean(payload.forgetDevice)) {
          await clearRemoteRememberedDevice(res, remoteReadonlySessions, remoteRememberedDevices, req)
        }
        sendJson(res, 200, {
          ok: true,
        })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/roots') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        sendJson(res, 200, {
          ok: true,
          items: listRemoteReadonlyRoots(currentRemoteReadonlyConfig),
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/favorites') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const items = await remoteSharedFavorites.list({
          allowedRootIds: currentRemoteReadonlyConfig.roots.map((item) => item.id),
        })
        sendJson(res, 200, { ok: true, items })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/favorites/upsert') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        const rootId = typeof payload.rootId === 'string' ? payload.rootId.trim() : ''
        if (!rootId) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'rootId is required', 400)
        }
        if (!currentRemoteReadonlyConfig.roots.some((item) => item.id === rootId)) {
          const error = new Error('Unknown remote root')
          error.code = 'REMOTE_ROOT_NOT_FOUND'
          error.statusCode = 404
          throw error
        }
        const normalizedPath = normalizeRemoteFavoritePath(payload.path)
        const item = await remoteSharedFavorites.upsert(rootId, normalizedPath, Date.now())
        sendJson(res, 200, { ok: true, item })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/favorites/remove') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        const rootId = typeof payload.rootId === 'string' ? payload.rootId.trim() : ''
        if (!rootId) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'rootId is required', 400)
        }
        if (!currentRemoteReadonlyConfig.roots.some((item) => item.id === rootId)) {
          const error = new Error('Unknown remote root')
          error.code = 'REMOTE_ROOT_NOT_FOUND'
          error.statusCode = 404
          throw error
        }
        const normalizedPath = normalizeRemoteFavoritePath(payload.path)
        await remoteSharedFavorites.remove(rootId, normalizedPath)
        sendJson(res, 200, { ok: true })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname.startsWith('/v1/remote/faces/crops/')) {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const faceId = decodeURIComponent(pathname.slice('/v1/remote/faces/crops/'.length))
        const rootId = requestUrl.searchParams.get('rootId')
        const size = requestUrl.searchParams.get('size')
        const padding = requestUrl.searchParams.get('padding')
        const result = await readRemoteReadonlyFaceCrop(currentRemoteReadonlyConfig, faceId, {
          ...(rootId !== null ? { rootId } : {}),
          ...(size !== null ? { size } : {}),
          ...(padding !== null ? { padding } : {}),
        })
        sendBinary(res, 200, result.body, result.contentType, {
          cacheControl: REMOTE_DERIVATIVE_CACHE_CONTROL,
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/files/content') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const resource = await resolveRemoteReadonlyFileResource(currentRemoteReadonlyConfig, {
          rootId: requestUrl.searchParams.get('rootId'),
          relativePath: requestUrl.searchParams.get('relativePath'),
        })
        const requestedRange = parseByteRangeHeader(req.headers.range, resource.sizeBytes)
        if (
          requestedRange
          && requestedRange.invalid !== true
          && requestedRange.end - requestedRange.start + 1 > REMOTE_MAX_RANGE_BYTES
        ) {
          throw createRemoteBudgetExceededError('Requested media range exceeds remote budget')
        }
        await sendFileStreamResponse(
          req,
          res,
          resource.absolutePath,
          resource.contentType,
          resource.sizeBytes,
          {
            cacheControl: REMOTE_CONTENT_CACHE_CONTROL,
            lastModifiedMs: resource.lastModifiedMs,
          },
        )
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/files/thumbnail') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const result = await readRemoteReadonlyThumbnailContent(currentRemoteReadonlyConfig, {
          rootId: requestUrl.searchParams.get('rootId'),
          relativePath: requestUrl.searchParams.get('relativePath'),
          sizePreset: requestUrl.searchParams.get('sizePreset'),
        })
        sendBinary(res, 200, result.body, result.contentType, {
          cacheControl: REMOTE_DERIVATIVE_CACHE_CONTROL,
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname.startsWith('/v1/faces/crops/')) {
      try {
        const faceId = decodeURIComponent(pathname.slice('/v1/faces/crops/'.length))
        const size = requestUrl.searchParams.get('size')
        const padding = requestUrl.searchParams.get('padding')
        const result = await getFaceCrop({
          faceId,
          ...(size !== null ? { size } : {}),
          ...(padding !== null ? { padding } : {}),
        })
        sendBinary(res, 200, result.body, result.contentType)
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/files/content') {
      const absolutePath = requestUrl.searchParams.get('absolutePath')
      await sendFileContentBinaryResponse(res, absolutePath)
      return
    }

    if (method === 'GET' && pathname === '/v1/files/thumbnail') {
      const absolutePath = requestUrl.searchParams.get('absolutePath')
      await sendFileContentBinaryResponse(res, absolutePath)
      return
    }

    if (method === 'POST' && pathname === '/v1/mcp') {
      let request = null
      let requestIsNotification = false
      let responseSessionId = null
      try {
        const payload = await readJsonBody(req)
        request = parseJsonRpcRequest(payload)
        requestIsNotification = request.id === undefined

        const requestSessionId = request.method === 'initialize' ? null : readSessionId(req)
        const { sessionId, result } = await handleMcpRequest(runtime, request, clientSessions, requestSessionId)
        if (request.method === 'tools/call') {
          await postProcessToolCallResult(request.params?.name, request.params?.arguments, result)
        }
        responseSessionId = sessionId

        if (responseSessionId) {
          res.setHeader(MCP_SESSION_HEADER, responseSessionId)
        }

        if (requestIsNotification) {
          res.statusCode = 204
          res.end()
          return
        }

        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: result ?? {},
        })
      } catch (error) {
        if (responseSessionId) {
          res.setHeader(MCP_SESSION_HEADER, responseSessionId)
        }

        if (requestIsNotification) {
          res.statusCode = 204
          res.end()
          return
        }

        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: request?.id ?? null,
          error: toJsonRpcError(error),
        })
      }
      return
    }

    if (findHttpGatewayRoute(method, pathname)) {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }

        const result = await handleHttpGatewayRoute(runtime, method, pathname, payload, requestUrl)
        sendJson(res, 200, result ?? { ok: true })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/files/list') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await listRemoteReadonlyFiles(currentRemoteReadonlyConfig, payload))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/files/text-preview') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await readRemoteReadonlyTextPreview(currentRemoteReadonlyConfig, payload))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/options') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await listRemoteReadonlyTagOptions(currentRemoteReadonlyConfig, payload))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/query') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await queryRemoteReadonlyFilesByTags(currentRemoteReadonlyConfig, payload))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/file') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await getRemoteReadonlyFileTags(currentRemoteReadonlyConfig, payload))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/faces/list-people') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await listRemoteReadonlyPeople(currentRemoteReadonlyConfig, payload))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/faces/list-person-faces') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await listRemoteReadonlyPersonFaces(currentRemoteReadonlyConfig, payload))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    sendJson(res, 404, {
      ok: false,
      error: 'Not found',
      code: 'MCP_METHOD_NOT_FOUND',
    })
  })

  server.listen(port, host, () => {
    console.log(`Fauplay gateway listening on http://${host}:${port}`)
    console.log('[gateway] MCP config files:')
    for (const source of configSources) {
      console.log(formatMcpConfigSourceLog(source))
    }
    console.log('[gateway] Shortcuts config files:')
    console.log(formatShortcutConfigSourceLog(shortcutConfigSource))
    console.log('[gateway] Remote access config files:')
    for (const source of remoteReadonlyConfig.configSources) {
      console.log(formatRemoteAccessConfigSourceLog(source))
    }
    console.log(`[gateway] MCP servers loaded: ${serverRegistry.length}`)
  })

  const shutdown = async () => {
    server.close()
    await runtime.shutdown()
  }

  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })

  return server
}
