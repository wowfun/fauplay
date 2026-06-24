import {
  RuntimeMcpError,
  createRuntimeRequestTimeoutError,
} from './errors.ts'

export const MCP_ENDPOINT_PATH = '/v1/mcp'
export const MCP_PROTOCOL_VERSION = '2025-11-05'
export const MCP_SESSION_HEADER = 'mcp-session-id'

export interface RuntimeMcpClientInfo {
  name: string
  version: string
}

export interface RuntimeMcpClient {
  call<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T>
  reset(): void
}

export interface RuntimeMcpClientOptions {
  buildEndpointUrl: () => string
  fetch: (url: string, init: RequestInit) => Promise<Response>
  clientInfo?: RuntimeMcpClientInfo
  createRequestId?: () => number
  startTimeout?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (timerId: ReturnType<typeof setTimeout>) => void
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

const DEFAULT_MCP_CLIENT_INFO = {
  name: 'fauplay-web',
  version: '0.0.1',
}

export function createRuntimeMcpClient(options: RuntimeMcpClientOptions): RuntimeMcpClient {
  let initialized = false
  let initializingPromise: Promise<void> | null = null
  let sessionId: string | null = null
  let sessionIdCandidate: string | null = null

  function reset() {
    initialized = false
    initializingPromise = null
    sessionId = null
    sessionIdCandidate = null
  }

  async function call<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    if (method !== 'initialize' && method !== 'notifications/initialized') {
      await ensureInitialized(timeoutMs)
    }

    return callRequest<T>(method, params, timeoutMs)
  }

  async function ensureInitialized(timeoutMs: number): Promise<void> {
    if (initialized) return
    if (initializingPromise) {
      await initializingPromise
      return
    }

    initializingPromise = (async () => {
      const result = await callRequest<InitializeResult>(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: options.clientInfo ?? DEFAULT_MCP_CLIENT_INFO,
        },
        timeoutMs,
      )

      if (!result || typeof result !== 'object') {
        throw new RuntimeMcpError('Invalid initialize response')
      }

      const nextSessionId = responseSessionIdFromInitializeResult(result)
      if (!nextSessionId) {
        throw new RuntimeMcpError(`Missing ${MCP_SESSION_HEADER} in initialize response`)
      }
      sessionId = nextSessionId

      await callRequest('notifications/initialized', {}, timeoutMs, { notification: true })

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

  function responseSessionIdFromInitializeResult(_result: InitializeResult): string | null {
    return sessionIdCandidate
  }

  async function callRequest<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    requestOptions: { notification?: boolean } = {},
  ): Promise<T> {
    const controller = new AbortController()
    const startTimeout = options.startTimeout ?? ((handler, delayMs) => setTimeout(handler, delayMs))
    const clearTimeoutFn = options.clearTimeout ?? clearTimeout
    const timeoutId = startTimeout(() => controller.abort(), timeoutMs)

    try {
      const notification = requestOptions.notification === true
      const payload = notification
        ? {
            jsonrpc: '2.0',
            method,
            params,
          }
        : {
            jsonrpc: '2.0',
            id: (options.createRequestId ?? createRequestId)(),
            method,
            params,
          }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (method !== 'initialize' && sessionId) {
        headers[MCP_SESSION_HEADER] = sessionId
      }

      const response = await options.fetch(options.buildEndpointUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const responseSessionId = response.headers.get(MCP_SESSION_HEADER)
      if (responseSessionId) {
        sessionIdCandidate = responseSessionId
      }

      if (notification) {
        if (response.status === 204) {
          return {} as T
        }
        if (!response.ok) {
          throw new RuntimeMcpError(`Runtime MCP request failed: ${response.status}`)
        }
        return {} as T
      }

      if (!response.ok) {
        throw new RuntimeMcpError(`Runtime MCP request failed: ${response.status}`)
      }

      const rpcResponse = (await response.json().catch(() => ({}))) as JsonRpcResponse<T>
      if (rpcResponse?.error) {
        throw toRuntimeMcpError(rpcResponse.error)
      }

      return (rpcResponse?.result ?? {}) as T
    } catch (error) {
      if (isAbortError(error)) {
        throw createRuntimeRequestTimeoutError(timeoutMs)
      }
      throw error
    } finally {
      clearTimeoutFn(timeoutId)
    }
  }

  return {
    call,
    reset,
  }
}

function createRequestId(): number {
  return Date.now() + Math.floor(Math.random() * 1000)
}

function toRuntimeMcpError(errorObj: JsonRpcErrorObject): RuntimeMcpError {
  const message = typeof errorObj?.message === 'string' ? errorObj.message : 'Runtime MCP request failed'
  const internalCode = typeof errorObj?.data?.code === 'string' ? errorObj.data.code : undefined
  const jsonRpcCode = typeof errorObj?.code === 'number' ? `JSONRPC_${errorObj.code}` : undefined
  return new RuntimeMcpError(message, internalCode || jsonRpcCode)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
