const GATEWAY_BASE_URL = 'http://127.0.0.1:3210'
const HEALTH_ENDPOINT = `${GATEWAY_BASE_URL}/v1/health`
const MCP_ENDPOINT = `${GATEWAY_BASE_URL}/v1/mcp`

export interface GatewayToolDescriptor {
  name: string
  title: string
  mutation: boolean
  scopes: string[]
  icon: 'reveal' | 'openDefault' | 'default'
}

interface GatewayHealthResponse {
  ok?: boolean
}

interface GatewayEnvelope<T> {
  ok?: boolean
  data?: T
  error?: {
    code?: string
    message?: string
  }
}

interface JsonRpcSuccess<T> {
  jsonrpc?: string
  id?: number | string | null
  result?: T
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

class GatewayMcpError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'GatewayMcpError'
    this.code = code
  }
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
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function callGatewayMcp<T>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
      signal: controller.signal,
    })

    const envelope = (await response
      .json()
      .catch(() => ({ ok: false, error: { message: 'Invalid response' } }))) as GatewayEnvelope<JsonRpcSuccess<T>>

    if (!response.ok || envelope.ok !== true) {
      throw new GatewayMcpError(envelope.error?.message || 'Gateway MCP request failed', envelope.error?.code)
    }

    return (envelope.data?.result ?? {}) as T
  } finally {
    window.clearTimeout(timeoutId)
  }
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

export async function callGatewayTool<T = Record<string, unknown>>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number = 5000
): Promise<T> {
  if (!toolName) {
    throw new GatewayMcpError('toolName is required', 'MCP_INVALID_PARAMS')
  }

  return callGatewayMcp<T>('tools/call', { name: toolName, arguments: args }, timeoutMs)
}

export async function loadGatewayCapabilities(timeoutMs: number = 2000): Promise<GatewayCapabilitiesSnapshot> {
  try {
    const health = (await fetchJsonWithTimeout(HEALTH_ENDPOINT, timeoutMs)) as GatewayHealthResponse
    if (!health.ok) {
      return { online: false, tools: [] }
    }

    const tools = await listGatewayTools(timeoutMs)
    return { online: true, tools }
  } catch {
    return { online: false, tools: [] }
  }
}
