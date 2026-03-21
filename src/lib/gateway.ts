const GATEWAY_BASE_URL = 'http://127.0.0.1:3210'
const HEALTH_ENDPOINT = `${GATEWAY_BASE_URL}/v1/health`
const MCP_ENDPOINT = `${GATEWAY_BASE_URL}/v1/mcp`
const MCP_PROTOCOL_VERSION = '2025-11-05'
const MCP_SESSION_HEADER = 'mcp-session-id'
const DEFAULT_TOOL_TIMEOUT_MS = 5000
const ML_CLASSIFY_TOOL_TIMEOUT_MS = 120000
const VIDEO_SAME_DURATION_TIMEOUT_MS = 20000
const LOCAL_DATA_TOOL_TIMEOUT_MS = 120000
const MCP_CLIENT_INFO = {
  name: 'fauplay-web',
  version: '0.0.1',
}

export interface GatewayToolDescriptor {
  name: string
  title: string
  mutation: boolean
  scopes: string[]
  iconName?: string
  toolOptions: ToolOptionAnnotation[]
  toolActions: ToolActionAnnotation[]
}

export interface ToolOptionEnumValue {
  value: string
  label: string
}

export type ToolOptionType = 'boolean' | 'enum' | 'string'

export interface ToolOptionAnnotation {
  key: string
  label: string
  type: ToolOptionType
  defaultValue?: boolean | string
  description?: string
  values?: ToolOptionEnumValue[]
  sendToTool?: boolean
  argumentKey?: string
}

export interface ToolActionAnnotation {
  key: string
  label: string
  description?: string
  intent?: string
  arguments?: Record<string, unknown>
}

interface GatewayHealthResponse {
  status?: string
}

interface GatewayHttpErrorPayload {
  ok?: boolean
  error?: string
  code?: string
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
  annotations?: Record<string, unknown> & {
    title?: string
    mutation?: boolean
    icon?: string
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

class GatewayHttpError extends Error {
  code?: string
  status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'GatewayHttpError'
    this.code = code
    this.status = status
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

  if (toolName === 'media.searchSameDurationVideos') {
    return VIDEO_SAME_DURATION_TIMEOUT_MS
  }

  if (toolName === 'local.data' || toolName === 'meta.annotation') {
    return LOCAL_DATA_TOOL_TIMEOUT_MS
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toToolOptionAnnotations(annotations: GatewayRawToolDescriptor['annotations']): ToolOptionAnnotation[] {
  const raw = annotations?.toolOptions
  if (!Array.isArray(raw)) return []

  const options: ToolOptionAnnotation[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue

    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const type = item.type
    const description = typeof item.description === 'string' ? item.description : undefined

    if (!key || !label) continue
    if (type !== 'boolean' && type !== 'enum' && type !== 'string') continue
    const sendToTool = item.sendToTool === true
    const argumentKey = typeof item.argumentKey === 'string' && item.argumentKey.trim()
      ? item.argumentKey.trim()
      : undefined

    if (type === 'boolean') {
      const defaultValue = typeof item.defaultValue === 'boolean' ? item.defaultValue : undefined
      options.push({ key, label, type, defaultValue, description, sendToTool, argumentKey })
      continue
    }

    if (type === 'string') {
      const defaultValue = typeof item.defaultValue === 'string' ? item.defaultValue : undefined
      options.push({ key, label, type, defaultValue, description, sendToTool, argumentKey })
      continue
    }

    const rawValues = Array.isArray(item.values) ? item.values : []
    const values = rawValues.flatMap((rawValue) => {
      if (!isRecord(rawValue)) return []
      const value = typeof rawValue.value === 'string' ? rawValue.value : ''
      const valueLabel = typeof rawValue.label === 'string' ? rawValue.label : ''
      if (!value || !valueLabel) return []
      return [{ value, label: valueLabel }]
    })

    if (values.length === 0) continue

    const defaultValue = typeof item.defaultValue === 'string' && values.some((value) => value.value === item.defaultValue)
      ? item.defaultValue
      : undefined

    options.push({ key, label, type, defaultValue, description, values, sendToTool, argumentKey })
  }

  return options
}

function toToolActionAnnotations(annotations: GatewayRawToolDescriptor['annotations']): ToolActionAnnotation[] {
  const raw = annotations?.toolActions
  if (!Array.isArray(raw)) return []

  const actions: ToolActionAnnotation[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const description = typeof item.description === 'string' ? item.description : undefined
    const intent = typeof item.intent === 'string' ? item.intent : undefined
    const argumentsPayload = isRecord(item.arguments) ? item.arguments : undefined
    if (!key || !label) continue
    actions.push({ key, label, description, intent, arguments: argumentsPayload })
  }

  return actions
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
  const iconName = typeof tool?.annotations?.icon === 'string' && tool.annotations.icon.trim()
    ? tool.annotations.icon.trim()
    : undefined

  return {
    name,
    title,
    mutation,
    scopes,
    iconName,
    toolOptions: toToolOptionAnnotations(tool.annotations),
    toolActions: toToolActionAnnotations(tool.annotations),
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

export async function callGatewayHttp<T = ToolCallResult>(
  endpointPath: string,
  body: Record<string, unknown>,
  timeoutMs?: number,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST'
): Promise<T> {
  const effectiveTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TOOL_TIMEOUT_MS
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
  const endpoint = `${GATEWAY_BASE_URL}${normalizedPath}`
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), effectiveTimeoutMs)

  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const payload = (await response.json().catch(() => ({}))) as GatewayHttpErrorPayload & T

    if (!response.ok) {
      const message = typeof payload?.error === 'string'
        ? payload.error
        : `Gateway request failed: ${response.status}`
      const code = typeof payload?.code === 'string' ? payload.code : undefined
      throw new GatewayHttpError(message, code, response.status)
    }

    if (
      payload
      && typeof payload === 'object'
      && 'ok' in payload
      && payload.ok === false
    ) {
      const message = typeof payload.error === 'string' ? payload.error : 'Gateway request failed'
      const code = typeof payload.code === 'string' ? payload.code : undefined
      throw new GatewayHttpError(message, code, response.status)
    }

    return payload as T
  } catch (error) {
    if (isAbortError(error)) {
      throw createClientTimeoutError(effectiveTimeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
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
