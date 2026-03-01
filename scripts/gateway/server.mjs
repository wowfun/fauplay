import http from 'node:http'
import { McpHostRuntime, createMcpRuntimeError } from './mcp/runtime.mjs'
import { createRevealMcpServer } from './plugins/reveal.mjs'

const DEFAULT_PORT = Number(process.env.FAUPLAY_GATEWAY_PORT || 3210)
const DEFAULT_HOST = '127.0.0.1'
const GATEWAY_VERSION = '0.2.0'

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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
    throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be valid JSON', 400)
  }
}

function parseExternalPluginAllowlist() {
  const raw = process.env.FAUPLAY_MCP_PLUGIN_ALLOWLIST_JSON
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((entry) => entry && typeof entry === 'object' && entry.transport === 'stdio')
      .map((entry) => ({
        pluginId: entry.id,
        name: entry.name,
        version: entry.version,
        transport: 'stdio',
        command: entry.command,
        args: Array.isArray(entry.args) ? entry.args : [],
        cwd: entry.cwd,
        env: entry.env,
        callTimeoutMs: entry.callTimeoutMs,
        initTimeoutMs: entry.initTimeoutMs,
        restartWindowMs: entry.restartWindowMs,
        maxCrashesInWindow: entry.maxCrashesInWindow,
        restartCooldownMs: entry.restartCooldownMs,
      }))
  } catch {
    return []
  }
}

function createPluginRegistry() {
  const builtinPlugins = [
    {
      pluginId: 'builtin.reveal',
      name: 'Builtin Reveal MCP Plugin',
      version: '0.2.0',
      transport: 'inproc',
      createServer: createRevealMcpServer,
    },
  ]

  const externalPlugins = parseExternalPluginAllowlist()
  return [...builtinPlugins, ...externalPlugins]
}

function parseJsonRpcRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Invalid JSON-RPC request payload', 400)
  }

  const method = payload.method
  if (typeof method !== 'string' || !method) {
    throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'method is required', 400)
  }

  return {
    jsonrpc: payload.jsonrpc,
    id: payload.id ?? null,
    method,
    params: payload.params && typeof payload.params === 'object' ? payload.params : {},
  }
}

function toErrorResponse(error) {
  return {
    statusCode: Number(error?.statusCode || 500),
    body: {
      ok: false,
      error: {
        code: error?.code || 'MCP_RUNTIME_ERROR',
        message: error instanceof Error ? error.message : 'MCP runtime error',
      },
    },
  }
}

async function handleMcpRequest(runtime, payload) {
  const request = parseJsonRpcRequest(payload)

  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: runtime.listTools(),
        plugins: runtime.listPlugins(),
      },
    }
  }

  if (request.method === 'tools/call') {
    const toolName = request.params?.name
    const toolArgs = request.params?.arguments && typeof request.params.arguments === 'object'
      ? request.params.arguments
      : {}

    if (typeof toolName !== 'string' || !toolName) {
      throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'params.name is required for tools/call', 400)
    }

    const result = await runtime.callTool(toolName, toolArgs)
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: result ?? {},
    }
  }

  throw createMcpRuntimeError('MCP_METHOD_NOT_FOUND', `Unsupported MCP method: ${request.method}`, 404)
}

export async function startGatewayServer(options = {}) {
  const host = options.host || DEFAULT_HOST
  const port = Number(options.port || DEFAULT_PORT)

  const runtime = new McpHostRuntime({
    pluginRegistry: createPluginRegistry(),
    callTimeoutMs: Number(process.env.FAUPLAY_MCP_CALL_TIMEOUT_MS || 5000),
    initTimeoutMs: Number(process.env.FAUPLAY_MCP_INIT_TIMEOUT_MS || 2000),
    restartWindowMs: Number(process.env.FAUPLAY_MCP_RESTART_WINDOW_MS || 10000),
    maxCrashesInWindow: Number(process.env.FAUPLAY_MCP_MAX_CRASHES || 3),
    restartCooldownMs: Number(process.env.FAUPLAY_MCP_RESTART_COOLDOWN_MS || 15000),
  })

  await runtime.initialize()

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res)

    if (req.method === 'OPTIONS') {
      sendJson(res, 204, { ok: true })
      return
    }

    const url = req.url || '/'

    if (req.method === 'GET' && url === '/v1/health') {
      sendJson(res, 200, {
        ok: true,
        data: {
          service: 'fauplay-local-gateway',
          version: GATEWAY_VERSION,
        },
      })
      return
    }

    if (req.method === 'POST' && url === '/v1/mcp') {
      try {
        const payload = await readJsonBody(req)
        const rpcResponse = await handleMcpRequest(runtime, payload)
        sendJson(res, 200, {
          ok: true,
          data: rpcResponse,
        })
      } catch (error) {
        const response = toErrorResponse(error)
        sendJson(res, response.statusCode, response.body)
      }
      return
    }

    sendJson(res, 404, {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Not found',
      },
    })
  })

  server.listen(port, host, () => {
    console.log(`Fauplay gateway listening on http://${host}:${port}`)
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
