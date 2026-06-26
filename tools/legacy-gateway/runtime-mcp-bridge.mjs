import { createMcpRuntimeError } from './runtime-errors.mjs'

const DEFAULT_RUNTIME_BASE_URL = 'http://127.0.0.1:3211'
const MCP_ENDPOINT_PATH = '/v1/mcp'
const MCP_PROTOCOL_VERSION = '2025-11-05'
const MCP_SESSION_HEADER = 'mcp-session-id'
const DEFAULT_CALL_TIMEOUT_MS = 120000
const DEFAULT_INIT_TIMEOUT_MS = 5000

function normalizeBaseUrl(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return (normalized || DEFAULT_RUNTIME_BASE_URL).replace(/\/+$/, '')
}

function normalizeTimeoutMs(value, fallback) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : fallback
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function statusCodeForMcpCode(code) {
  if (code === 'MCP_INVALID_PARAMS' || code === 'MCP_INVALID_REQUEST') return 400
  if (code === 'MCP_METHOD_NOT_FOUND' || code === 'MCP_TOOL_NOT_FOUND') return 404
  if (code === 'MCP_SERVER_TIMEOUT') return 504
  if (code === 'MCP_SERVER_CRASHED') return 502
  return 500
}

function toRuntimeMcpError(errorObject) {
  const code = typeof errorObject?.data?.code === 'string'
    ? errorObject.data.code
    : 'MCP_RUNTIME_ERROR'
  const message = typeof errorObject?.message === 'string'
    ? errorObject.message
    : 'Runtime MCP request failed'
  return createMcpRuntimeError(code, message, statusCodeForMcpCode(code))
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function resolveRuntimeMcpBaseUrl(env = process.env) {
  return normalizeBaseUrl(
    env.FAUPLAY_RUNTIME_BASE_URL
    || env.VITE_FAUPLAY_RUNTIME_BASE_URL
  )
}

export function createRuntimeMcpBridge(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? resolveRuntimeMcpBaseUrl())
  const endpointUrl = `${baseUrl}${MCP_ENDPOINT_PATH}`
  const fetchImpl = options.fetch ?? fetch
  const callTimeoutMs = normalizeTimeoutMs(options.callTimeoutMs, DEFAULT_CALL_TIMEOUT_MS)
  const initTimeoutMs = normalizeTimeoutMs(options.initTimeoutMs, DEFAULT_INIT_TIMEOUT_MS)
  const clientInfo = options.clientInfo ?? {
    name: 'fauplay-legacy-gateway',
    version: '0.2.0',
  }
  let nextRequestId = 1
  let sessionId = null
  let initialized = false
  let initializingPromise = null

  function reset() {
    sessionId = null
    initialized = false
    initializingPromise = null
  }

  async function ensureInitialized() {
    if (initialized) return
    if (initializingPromise) {
      await initializingPromise
      return
    }

    initializingPromise = (async () => {
      await sendJsonRpcRequest('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo,
      }, initTimeoutMs)

      if (!sessionId) {
        throw createMcpRuntimeError(
          'MCP_RUNTIME_ERROR',
          `Missing ${MCP_SESSION_HEADER} in Runtime MCP initialize response`,
          502,
        )
      }

      await sendJsonRpcRequest('notifications/initialized', {}, initTimeoutMs, {
        notification: true,
      })
      initialized = true
    })()
      .catch((error) => {
        reset()
        throw error
      })
      .finally(() => {
        initializingPromise = null
      })

    await initializingPromise
  }

  async function sendJsonRpcRequest(method, params, timeoutMs, requestOptions = {}) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const notification = requestOptions.notification === true
    const payload = notification
      ? {
          jsonrpc: '2.0',
          method,
          params,
        }
      : {
          jsonrpc: '2.0',
          id: nextRequestId++,
          method,
          params,
        }
    const headers = {
      'Content-Type': 'application/json',
    }
    if (method !== 'initialize' && sessionId) {
      headers[MCP_SESSION_HEADER] = sessionId
    }

    try {
      const response = await fetchImpl(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const responseSessionId = response.headers.get(MCP_SESSION_HEADER)
      if (responseSessionId) {
        sessionId = responseSessionId
      }

      if (notification) {
        if (response.status === 204 || response.ok) {
          return {}
        }
        throw createMcpRuntimeError(
          'MCP_RUNTIME_ERROR',
          `Runtime MCP request failed: ${response.status}`,
          response.status,
        )
      }

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw createMcpRuntimeError(
          'MCP_RUNTIME_ERROR',
          `Runtime MCP request failed: ${response.status}`,
          response.status,
        )
      }
      if (body?.error) {
        throw toRuntimeMcpError(body.error)
      }
      return body?.result ?? {}
    } catch (error) {
      if (isAbortError(error)) {
        throw createMcpRuntimeError(
          'MCP_SERVER_TIMEOUT',
          `Runtime MCP request timed out after ${timeoutMs}ms`,
          504,
        )
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async function callTool(toolName, args) {
    if (typeof toolName !== 'string' || !toolName.trim()) {
      throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'tool name is required', 400)
    }
    await ensureInitialized()
    return sendJsonRpcRequest('tools/call', {
      name: toolName.trim(),
      arguments: isObjectRecord(args) ? args : {},
    }, callTimeoutMs)
  }

  return {
    callTool,
    reset,
    shutdown: async () => {
      reset()
    },
  }
}

export { createMcpRuntimeError }
