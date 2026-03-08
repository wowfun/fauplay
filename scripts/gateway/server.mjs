import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { McpHostRuntime, createMcpRuntimeError } from './mcp/runtime.mjs'

const DEFAULT_PORT = Number(process.env.FAUPLAY_GATEWAY_PORT || 3210)
const DEFAULT_HOST = '127.0.0.1'
const GATEWAY_VERSION = '0.2.0'
const MCP_PROTOCOL_VERSION = '2025-11-05'
const MCP_SESSION_HEADER = 'mcp-session-id'
const DEFAULT_MCP_CONFIG_PATH = path.resolve(process.cwd(), '.fauplay', 'mcp.json')
const LOCAL_MCP_CONFIG_FILENAME = 'mcp.local.json'

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${MCP_SESSION_HEADER}`)
  res.setHeader('Access-Control-Expose-Headers', MCP_SESSION_HEADER)
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
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

function resolveCwd(configDir, cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return undefined
  return path.isAbsolute(cwd) ? cwd : path.resolve(configDir, cwd)
}

function toConfigObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
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

function resolveLocalMcpConfigPath(configPath) {
  return path.resolve(path.dirname(configPath), LOCAL_MCP_CONFIG_FILENAME)
}

function mergeMcpConfig(baseConfig, localConfig) {
  const base = toConfigObject(baseConfig)
  const local = toConfigObject(localConfig)

  const merged = {
    ...base,
    ...local,
  }

  const baseServers = toConfigObject(base.servers)
  const localServers = toConfigObject(local.servers)
  const hasServers = Object.keys(baseServers).length > 0 || Object.keys(localServers).length > 0

  if (hasServers) {
    merged.servers = {
      ...baseServers,
      ...localServers,
    }
  }

  return merged
}

async function loadMcpServersFromConfig(configPath) {
  const baseConfig = await readMcpConfigFile(configPath, { allowMissing: true })
  const localConfigPath = resolveLocalMcpConfigPath(configPath)
  const localConfig = await readMcpConfigFile(localConfigPath, { allowMissing: true })
  const parsed = mergeMcpConfig(baseConfig, localConfig)

  const servers = parsed.servers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return []
  }

  const configDir = path.dirname(configPath)
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
      cwd: resolveCwd(configDir, entry.cwd),
      env: toStringRecord(entry.env),
      callTimeoutMs: entry.callTimeoutMs,
      initTimeoutMs: entry.initTimeoutMs,
      restartWindowMs: entry.restartWindowMs,
      maxCrashesInWindow: entry.maxCrashesInWindow,
      restartCooldownMs: entry.restartCooldownMs,
    })
  }

  return serversToLoad
}

async function createMcpServerRegistry(configPath) {
  return loadMcpServersFromConfig(configPath)
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

export async function startGatewayServer(options = {}) {
  const host = options.host || DEFAULT_HOST
  const port = Number(options.port || DEFAULT_PORT)
  const configPath = typeof options.mcpConfigPath === 'string' && options.mcpConfigPath
    ? options.mcpConfigPath
    : DEFAULT_MCP_CONFIG_PATH
  const serverRegistry = await createMcpServerRegistry(configPath)

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

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const url = req.url || '/'

    if (req.method === 'GET' && url === '/v1/health') {
      sendJson(res, 200, {
        service: 'fauplay-local-gateway',
        version: GATEWAY_VERSION,
        status: 'ok',
      })
      return
    }

    if (req.method === 'POST' && url === '/v1/mcp') {
      let request = null
      let requestIsNotification = false
      let responseSessionId = null
      try {
        const payload = await readJsonBody(req)
        request = parseJsonRpcRequest(payload)
        requestIsNotification = request.id === undefined

        const requestSessionId = request.method === 'initialize' ? null : readSessionId(req)
        const { sessionId, result } = await handleMcpRequest(runtime, request, clientSessions, requestSessionId)
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

    sendJson(res, 404, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32601,
        message: 'Not found',
      },
    })
  })

  server.listen(port, host, () => {
    console.log(`Fauplay gateway listening on http://${host}:${port}`)
    console.log(`[gateway] MCP config: ${configPath}`)
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
