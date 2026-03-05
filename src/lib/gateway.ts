const GATEWAY_BASE_URL = 'http://127.0.0.1:3210'
const HEALTH_ENDPOINT = `${GATEWAY_BASE_URL}/v1/health`
const MCP_ENDPOINT = `${GATEWAY_BASE_URL}/v1/mcp`
const MCP_PROTOCOL_VERSION = '2025-11-05'
const MCP_SESSION_HEADER = 'mcp-session-id'
const DEFAULT_TOOL_TIMEOUT_MS = 5000
const ML_CLASSIFY_TOOL_TIMEOUT_MS = 120000
const MCP_CLIENT_INFO = {
  name: 'fauplay-web',
  version: '0.0.1',
}

export interface GatewayToolDescriptor {
  name: string
  title: string
  mutation: boolean
  scopes: string[]
  icon: 'reveal' | 'openDefault' | 'default'
}

interface GatewayHealthResponse {
  status?: string
}

interface JsonRpcErrorData {
  code?: string
}

interface JsonRpcErrorObject {
  code?: number
  message?: string
  data?: JsonRpcErrorData
}

interface JsonRpcResponse<T> {
  jsonrpc?: string
  id?: number | string | null
  result?: T
  error?: JsonRpcErrorObject
}

interface InitializeResult {
  protocolVersion?: string
  capabilities?: Record<string, unknown>
  serverInfo?: {
    name?: string
    version?: string
  }
}

interface GatewayToolsListResult {
  tools?: GatewayRawToolDescriptor[]
}

interface GatewayRawToolDescriptor {
  name?: string
  title?: string
  mutation?: boolean
  scopes?: string[]
  annotations?: {
    title?: string
    mutation?: boolean
    scopes?: string[]
  }
}

export interface GatewayCapabilitiesSnapshot {
  online: boolean
  tools: GatewayToolDescriptor[]
}

export type ToolCallResult = Record<string, unknown> | unknown[] | string | number | boolean | null

class GatewayMcpError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'GatewayMcpError'
    this.code = code
  }
}

let mcpInitialized = false
let mcpInitializingPromise: Promise<void> | null = null
let mcpSessionId: string | null = null
let mcpSessionIdCandidate: string | null = null

function createRequestId(): number {
  return Date.now() + Math.floor(Math.random() * 1000)
}

function resetMcpInitialization() {
  mcpInitialized = false
  mcpInitializingPromise = null
  mcpSessionId = null
  mcpSessionIdCandidate = null
}

function toGatewayMcpError(errorObj: JsonRpcErrorObject): GatewayMcpError {
  const message = typeof errorObj?.message === 'string' ? errorObj.message : 'Gateway MCP request failed'
  const internalCode = typeof errorObj?.data?.code === 'string' ? errorObj.data.code : undefined
  const jsonRpcCode = typeof errorObj?.code === 'number' ? `JSONRPC_${errorObj.code}` : undefined
  return new GatewayMcpError(message, internalCode || jsonRpcCode)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function createClientTimeoutError(timeoutMs: number): GatewayMcpError {
  const timeoutSec = Math.ceil(timeoutMs / 1000)
  return new GatewayMcpError(`Gateway request timed out after ${timeoutSec}s`, 'MCP_CLIENT_TIMEOUT')
}

function resolveToolTimeoutMs(toolName: string, timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs
  }

  if (toolName.startsWith('ml.classify')) {
    return ML_CLASSIFY_TOOL_TIMEOUT_MS
  }

  return DEFAULT_TOOL_TIMEOUT_MS
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Gateway request failed: ${response.status}`)
    }
    return response.json()
  } catch (error) {
    if (isAbortError(error)) {
      throw createClientTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function callGatewayMcp<T>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
  if (method !== 'initialize' && method !== 'notifications/initialized') {
    await ensureGatewayMcpInitialized(timeoutMs)
  }

  return callGatewayMcpRequest<T>(method, params, timeoutMs)
}

async function callGatewayMcpRequest<T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  options?: { notification?: boolean }
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const notification = options?.notification === true
    const payload = notification
      ? {
          jsonrpc: '2.0',
          method,
          params,
        }
      : {
          jsonrpc: '2.0',
          id: createRequestId(),
          method,
          params,
        }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (method !== 'initialize' && mcpSessionId) {
      headers[MCP_SESSION_HEADER] = mcpSessionId
    }

    const response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const responseSessionId = response.headers.get(MCP_SESSION_HEADER)
    if (responseSessionId) {
      mcpSessionIdCandidate = responseSessionId
    }

    if (notification) {
      if (response.status === 204) {
        return {} as T
      }
      if (!response.ok) {
        throw new GatewayMcpError(`Gateway request failed: ${response.status}`)
      }
      return {} as T
    }

    if (!response.ok) {
      throw new GatewayMcpError(`Gateway request failed: ${response.status}`)
    }

    const rpcResponse = (await response
      .json()
      .catch(() => ({}))) as JsonRpcResponse<T>

    if (rpcResponse?.error) {
      throw toGatewayMcpError(rpcResponse.error)
    }

    return (rpcResponse?.result ?? {}) as T
  } catch (error) {
    if (isAbortError(error)) {
      throw createClientTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function ensureGatewayMcpInitialized(timeoutMs: number): Promise<void> {
  if (mcpInitialized) return
  if (mcpInitializingPromise) {
    await mcpInitializingPromise
    return
  }

  mcpInitializingPromise = (async () => {
    const result = await callGatewayMcpRequest<InitializeResult>(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      },
      timeoutMs
    )

    if (!result || typeof result !== 'object') {
      throw new GatewayMcpError('Invalid initialize response')
    }

    const sessionId = responseSessionIdFromInitializeResult(result)
    if (!sessionId) {
      throw new GatewayMcpError(`Missing ${MCP_SESSION_HEADER} in initialize response`)
    }
    mcpSessionId = sessionId

    await callGatewayMcpRequest(
      'notifications/initialized',
      {},
      timeoutMs,
      { notification: true }
    )

    mcpInitialized = true
  })()
    .catch((error) => {
      resetMcpInitialization()
      throw error
    })
    .finally(() => {
      mcpInitializingPromise = null
    })

  await mcpInitializingPromise
}

function responseSessionIdFromInitializeResult(_result: InitializeResult): string | null {
  // Session id is read from the latest HTTP response header in callGatewayMcpRequest.
  // callGatewayMcpRequest stores it in mcpSessionIdCandidate for initialize only.
  return mcpSessionIdCandidate
}

function toToolDescriptor(tool: GatewayRawToolDescriptor): GatewayToolDescriptor | null {
  const name = typeof tool?.name === 'string' ? tool.name : ''
  if (!name) return null

  const title =
    typeof tool?.title === 'string'
      ? tool.title
      : typeof tool?.annotations?.title === 'string'
        ? tool.annotations.title
        : name

  const mutation =
    typeof tool?.mutation === 'boolean'
      ? tool.mutation
      : tool?.annotations?.mutation === true

  const scopes = Array.isArray(tool?.scopes)
    ? tool.scopes.filter((scope: unknown): scope is string => typeof scope === 'string')
    : Array.isArray(tool?.annotations?.scopes)
      ? tool.annotations.scopes.filter((scope: unknown): scope is string => typeof scope === 'string')
      : []

  const icon = name === 'system.reveal'
    ? 'reveal'
    : name === 'system.openDefault'
      ? 'openDefault'
      : 'default'

  return {
    name,
    title,
    mutation,
    scopes,
    icon,
  }
}

export async function listGatewayTools(timeoutMs: number = 2000): Promise<GatewayToolDescriptor[]> {
  const result = await callGatewayMcp<GatewayToolsListResult>('tools/list', {}, timeoutMs)
  const tools = Array.isArray(result?.tools) ? result.tools : []
  return tools
    .map((tool) => toToolDescriptor(tool))
    .filter((tool): tool is GatewayToolDescriptor => tool !== null)
}

export async function callGatewayTool<T = ToolCallResult>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  if (!toolName) {
    throw new GatewayMcpError('toolName is required', 'MCP_INVALID_PARAMS')
  }

  const effectiveTimeoutMs = resolveToolTimeoutMs(toolName, timeoutMs)
  return callGatewayMcp<T>('tools/call', { name: toolName, arguments: args }, effectiveTimeoutMs)
}

export async function loadGatewayCapabilities(timeoutMs: number = 2000): Promise<GatewayCapabilitiesSnapshot> {
  try {
    const health = (await fetchJsonWithTimeout(HEALTH_ENDPOINT, timeoutMs)) as GatewayHealthResponse
    if (health?.status !== 'ok') {
      resetMcpInitialization()
      return { online: false, tools: [] }
    }

    const tools = await listGatewayTools(timeoutMs)
    return { online: true, tools }
  } catch {
    resetMcpInitialization()
    return { online: false, tools: [] }
  }
}
