import { resolveLocalRuntimeBaseUrl } from './baseUrl.ts'
import {
  RuntimeHttpError,
  RuntimeMcpError,
  createRuntimeRequestTimeoutError,
} from './errors.ts'
import {
  MCP_ENDPOINT_PATH,
  createRuntimeMcpClient,
  type RuntimeMcpClient,
} from './mcpClient.ts'
import {
  parseRuntimeToolDescriptors,
  resolveRuntimeToolTimeoutMs,
  type RuntimeRawToolDescriptor,
  type RuntimeToolDescriptor,
} from './toolDescriptors.ts'

export const RUNTIME_HEALTH_ENDPOINT_PATH = '/v1/health'

export type RuntimePluginToolCallResult = Record<string, unknown> | unknown[] | string | number | boolean | null

export interface RuntimeCapabilitiesSnapshot {
  online: boolean
  tools: RuntimeToolDescriptor[]
}

export interface RuntimePluginCapabilityClient {
  loadCapabilities(timeoutMs?: number): Promise<RuntimeCapabilitiesSnapshot>
  listTools(timeoutMs?: number): Promise<RuntimeToolDescriptor[]>
  callTool<T = RuntimePluginToolCallResult>(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>
  reset(): void
}

export interface RuntimePluginCapabilityClientOptions {
  buildRuntimeUrl?: (endpointPath: string) => string
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  createRequestId?: () => number
  startTimeout?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (timerId: ReturnType<typeof setTimeout>) => void
  mcpClient?: RuntimeMcpClient
}

interface RuntimeHealthResponse {
  status?: string
}

interface RuntimeToolsListResult {
  tools?: RuntimeRawToolDescriptor[]
}

interface RuntimeClientAdapter {
  buildRuntimeUrl: (endpointPath: string) => string
  fetch: (url: string, init: RequestInit) => Promise<Response>
  startTimeout: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timerId: ReturnType<typeof setTimeout>) => void
}

interface ViteRuntimeEnv {
  VITE_FAUPLAY_RUNTIME_BASE_URL?: string
}

export function createRuntimePluginCapabilityClient(
  options: RuntimePluginCapabilityClientOptions = {},
): RuntimePluginCapabilityClient {
  const adapter: RuntimeClientAdapter = {
    buildRuntimeUrl: options.buildRuntimeUrl ?? buildDefaultRuntimeUrl,
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    startTimeout: options.startTimeout ?? ((handler, timeoutMs) => setTimeout(handler, timeoutMs)),
    clearTimeout: options.clearTimeout ?? ((timerId) => clearTimeout(timerId)),
  }

  const mcpClient = options.mcpClient ?? createRuntimeMcpClient({
    buildEndpointUrl: () => adapter.buildRuntimeUrl(MCP_ENDPOINT_PATH),
    fetch: adapter.fetch,
    createRequestId: options.createRequestId,
    startTimeout: adapter.startTimeout,
    clearTimeout: adapter.clearTimeout,
  })

  async function listTools(timeoutMs: number = 2000): Promise<RuntimeToolDescriptor[]> {
    const result = await mcpClient.call<RuntimeToolsListResult>('tools/list', {}, timeoutMs)
    return parseRuntimeToolDescriptors(result?.tools)
  }

  async function callTool<T = RuntimePluginToolCallResult>(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    const normalizedToolName = toolName.trim()
    if (!normalizedToolName) {
      throw new RuntimeMcpError('toolName is required', 'MCP_INVALID_PARAMS')
    }

    const effectiveTimeoutMs = resolveRuntimeToolTimeoutMs(normalizedToolName, timeoutMs)
    return mcpClient.call<T>('tools/call', { name: normalizedToolName, arguments: args }, effectiveTimeoutMs)
  }

  async function loadCapabilities(timeoutMs: number = 2000): Promise<RuntimeCapabilitiesSnapshot> {
    try {
      const health = await fetchRuntimeJsonWithTimeout<RuntimeHealthResponse>(
        adapter.buildRuntimeUrl(RUNTIME_HEALTH_ENDPOINT_PATH),
        timeoutMs,
        adapter,
      )
      if (health.status !== 'ok') {
        mcpClient.reset()
        return { online: false, tools: [] }
      }

      return { online: true, tools: await listTools(timeoutMs) }
    } catch {
      mcpClient.reset()
      return { online: false, tools: [] }
    }
  }

  return {
    loadCapabilities,
    listTools,
    callTool,
    reset: () => mcpClient.reset(),
  }
}

const defaultRuntimePluginCapabilityClient = createRuntimePluginCapabilityClient()

export function resetRuntimePluginCapabilitySession(): void {
  defaultRuntimePluginCapabilityClient.reset()
}

export async function listRuntimePluginTools(timeoutMs?: number): Promise<RuntimeToolDescriptor[]> {
  return defaultRuntimePluginCapabilityClient.listTools(timeoutMs)
}

export async function callRuntimePluginTool<T = RuntimePluginToolCallResult>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> {
  return defaultRuntimePluginCapabilityClient.callTool<T>(toolName, args, timeoutMs)
}

export async function loadRuntimeCapabilities(timeoutMs?: number): Promise<RuntimeCapabilitiesSnapshot> {
  return defaultRuntimePluginCapabilityClient.loadCapabilities(timeoutMs)
}

async function fetchRuntimeJsonWithTimeout<T>(
  url: string,
  timeoutMs: number,
  adapter: RuntimeClientAdapter,
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = adapter.startTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await adapter.fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new RuntimeHttpError(`Runtime API request failed: ${response.status}`, undefined, response.status)
    }
    return (await response.json().catch(() => ({}))) as T
  } catch (error) {
    if (isAbortError(error)) {
      throw createRuntimeRequestTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    adapter.clearTimeout(timeoutId)
  }
}

function buildDefaultRuntimeUrl(endpointPath: string): string {
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
  const runtimeBaseUrl = resolveLocalRuntimeBaseUrl(getViteRuntimeEnv(), getBrowserOrigin)
  return new URL(normalizedPath, `${runtimeBaseUrl.replace(/\/+$/, '')}/`).toString()
}

function getViteRuntimeEnv(): ViteRuntimeEnv {
  const meta = import.meta as ImportMeta & { env?: ViteRuntimeEnv }
  return {
    VITE_FAUPLAY_RUNTIME_BASE_URL: meta.env?.VITE_FAUPLAY_RUNTIME_BASE_URL,
  }
}

function getBrowserOrigin(): string {
  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string') {
    return window.location.origin
  }
  return 'http://127.0.0.1:3211'
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
