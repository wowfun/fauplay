import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { McpHostRuntime, createMcpRuntimeError } from './mcp/runtime.mjs'
import {
  batchRebindPaths,
  ensureFileEntries,
  queryDuplicateFiles,
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

const DEFAULT_PORT = Number(process.env.FAUPLAY_GATEWAY_PORT || 3210)
const DEFAULT_HOST = '127.0.0.1'
const GATEWAY_VERSION = '0.2.0'
const MCP_PROTOCOL_VERSION = '2025-11-05'
const MCP_SESSION_HEADER = 'mcp-session-id'
const PROJECT_ROOT = process.cwd()
const DEFAULT_MCP_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'src', 'config', 'mcp.json')
const GLOBAL_MCP_CONFIG_PATH = path.join(os.homedir(), '.fauplay', 'global', 'mcp.json')
const GLOBAL_SHORTCUTS_CONFIG_PATH = path.join(os.homedir(), '.fauplay', 'global', 'shortcuts.json')

function resolveConfigPath(configPath) {
  if (typeof configPath !== 'string' || !configPath.trim()) {
    return configPath
  }
  return path.isAbsolute(configPath) ? configPath : path.resolve(PROJECT_ROOT, configPath)
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

function sendBinary(res, statusCode, body, contentType) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-store')
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
    return {
      ...persisted,
      inferenceDetected: inferred.detected,
    }
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

async function handleHttpGatewayRoute(runtime, method, pathname, payload) {
  const route = findHttpGatewayRoute(method, pathname)
  if (!route) {
    throwHttpGatewayRouteNotFound(pathname)
  }
  return route.handler({
    runtime,
    pathname,
    payload,
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

        const result = await handleHttpGatewayRoute(runtime, method, pathname, payload)
        sendJson(res, 200, result ?? { ok: true })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
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
