import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { McpHostRuntime, createMcpRuntimeError } from './mcp/runtime.mjs'
import { GLOBAL_ENV_PATH, loadGlobalEnvFile } from './env.mjs'
import {
  parseByteRangeHeader,
  sendFileStreamResponse,
} from './file-stream-response.mjs'
import {
  findHttpGatewayRoute,
  handleHttpGatewayRoute,
  throwHttpGatewayRouteNotFound,
} from './http-routes.mjs'
import {
  createMcpServerRegistry,
  DEFAULT_MCP_CONFIG_PATH,
  formatMcpConfigSourceLog,
  resolveConfigPath,
} from './mcp-config.mjs'
import {
  clearRemoteReadonlyLoginFailures,
  clearRemoteReadonlySession,
  clearRemoteReadonlySessionsByRememberedDeviceIds,
  clearRemoteRememberedDevice,
  createRemoteBudgetExceededError,
  ensureLoopbackAdminRequest,
  ensureRemoteReadonlyLoginAllowed,
  ensureRemoteReadonlySessionAuthorized,
  issueRemoteReadonlySession,
  issueRemoteRememberedDevice,
  normalizeRememberedDeviceLabel,
  readRemoteReadonlyClientId,
  registerRemoteReadonlyLoginFailure,
  REMOTE_REMEMBER_DEVICE_TTL_MS,
} from './remote-sessions.mjs'
import {
  batchRebindPaths,
  readFileContentByAbsolutePath,
  getFaceCrop,
  ingestClassificationResult,
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
const REMOTE_CONTENT_CACHE_CONTROL = 'private, no-store'
const REMOTE_DERIVATIVE_CACHE_CONTROL = 'private, max-age=300'
const REMOTE_MAX_RANGE_BYTES = readPositiveIntegerEnv('FAUPLAY_REMOTE_MAX_RANGE_BYTES', 16 * 1024 * 1024)

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

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
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
