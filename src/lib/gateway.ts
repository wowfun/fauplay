import {
  clearRemoteSession,
  fromRemoteUiRootId,
  getActiveRemoteWorkspace,
  getCurrentOrigin,
  isRemoteReadonlyProviderActive,
} from '@/lib/accessState'
import type { FileItem, TextPreviewPayload } from '@/types'

const LOCAL_GATEWAY_BASE_URL_CONFIG = (import.meta.env.VITE_LOCAL_GATEWAY_BASE_URL as string | undefined)?.trim() || 'http://127.0.0.1:3210'
const HEALTH_ENDPOINT_PATH = '/v1/health'
const MCP_ENDPOINT_PATH = '/v1/mcp'
const GLOBAL_SHORTCUTS_CONFIG_ENDPOINT_PATH = '/v1/config/shortcuts'
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

interface FaceCropUrlOptions {
  size?: number
  padding?: number
  rootId?: string
}

interface AbsoluteFileUrlOptions {
  sizePreset?: string
}

interface RemoteFileUrlOptions {
  sizePreset?: string
}

export interface RemoteRootEntry {
  id: string
  label: string
}

export interface RemoteFavoriteEntry {
  rootId: string
  path: string
  favoritedAtMs: number
}

export interface LocalPublishedRootSyncEntry {
  label: string
  absolutePath: string
  favoritePaths: string[]
}

export interface RemoteCapabilitiesSnapshot {
  enabled: boolean
  authMode: 'session-cookie'
  loginMode: 'bearer-token-exchange'
  readOnly: true
}

export interface RememberedDeviceAdminEntry {
  id: string
  label: string
  autoLabel: string
  userAgentSummary: string
  createdAtMs: number
  lastUsedAtMs: number
  expiresAtMs: number
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
  visible?: boolean
}

interface GatewayHealthResponse {
  status?: string
}

interface GatewayGlobalShortcutConfigResponse {
  ok?: boolean
  loaded?: boolean
  path?: string
  config?: unknown
}

interface GatewayHttpErrorPayload {
  ok?: boolean
  error?: string
  code?: string
}

interface SameOriginRequestOptions {
  clearSessionOnUnauthorized?: boolean
  headers?: Record<string, string>
}

interface RemoteSessionCreateOptions {
  rememberDevice?: boolean
  rememberDeviceLabel?: string
  timeoutMs?: number
}

interface RemoteSessionClearOptions {
  forgetDevice?: boolean
  timeoutMs?: number
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

export interface GlobalShortcutConfigSnapshot {
  loaded: boolean
  path: string
  config: unknown | null
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

function getSameOriginGatewayBaseUrl(): string {
  return getCurrentOrigin()
}

function getLocalGatewayBaseUrl(): string {
  if (LOCAL_GATEWAY_BASE_URL_CONFIG === '/' || LOCAL_GATEWAY_BASE_URL_CONFIG === 'same-origin') {
    return getCurrentOrigin()
  }
  return LOCAL_GATEWAY_BASE_URL_CONFIG
}

function buildLocalGatewayUrl(endpointPath: string): string {
  const normalizedPath = normalizeEndpointPath(endpointPath)
  return new URL(normalizedPath, `${getLocalGatewayBaseUrl().replace(/\/+$/, '')}/`).toString()
}

function createRemoteUnauthorizedError(status?: number): GatewayHttpError {
  return new GatewayHttpError('远程会话已失效，请重新连接', 'REMOTE_UNAUTHORIZED', status)
}

function clearRemoteSessionOnUnauthorized() {
  clearRemoteSession({ emitInvalidatedEvent: true })
}

function buildRemoteLoginHeaders(token: string): Record<string, string> {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new GatewayHttpError('远程 token 不能为空', 'REMOTE_TOKEN_REQUIRED', 400)
  }
  return {
    Authorization: `Bearer ${normalizedToken}`,
  }
}

function normalizeEndpointPath(endpointPath: string): string {
  return endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
}

function appendQueryString(baseUrl: string, query: URLSearchParams): string {
  const serialized = query.toString()
  return serialized ? `${baseUrl}?${serialized}` : baseUrl
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

    const response = await fetch(buildLocalGatewayUrl(MCP_ENDPOINT_PATH), {
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
    const visible = typeof item.visible === 'boolean' ? item.visible : undefined
    if (!key || !label) continue
    actions.push({ key, label, description, intent, arguments: argumentsPayload, visible })
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
  body: unknown = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'
): Promise<T> {
  const effectiveTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TOOL_TIMEOUT_MS
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
  const endpoint = buildLocalGatewayUrl(normalizedPath)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), effectiveTimeoutMs)

  try {
    const requestInit: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    }
    if (method !== 'GET') {
      requestInit.body = JSON.stringify(body)
    }

    const response = await fetch(endpoint, requestInit)

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

function handleRemoteUnauthorizedResponse(
  status: number,
  { clearSessionOnUnauthorized = true }: SameOriginRequestOptions = {}
): never {
  if (clearSessionOnUnauthorized) {
    clearRemoteSessionOnUnauthorized()
  }
  throw createRemoteUnauthorizedError(status)
}

async function callSameOriginRemoteHttp<T = ToolCallResult>(
  endpointPath: string,
  body: Record<string, unknown> = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' = 'POST',
  query?: URLSearchParams,
  options: SameOriginRequestOptions = {},
): Promise<T> {
  const effectiveTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TOOL_TIMEOUT_MS
  const normalizedPath = normalizeEndpointPath(endpointPath)
  const baseUrl = `${getSameOriginGatewayBaseUrl()}${normalizedPath}`
  const endpoint = query ? appendQueryString(baseUrl, query) : baseUrl
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), effectiveTimeoutMs)

  try {
    const requestInit: RequestInit = {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    }
    if (method !== 'GET') {
      requestInit.body = JSON.stringify(body)
    }

    const response = await fetch(endpoint, requestInit)
    const payload = (await response.json().catch(() => ({}))) as GatewayHttpErrorPayload & T

    if (!response.ok) {
      if (response.status === 401) {
        handleRemoteUnauthorizedResponse(response.status, options)
      }
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

export async function callRemoteGatewayHttp<T = ToolCallResult>(
  endpointPath: string,
  body: Record<string, unknown> = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' = 'POST',
  query?: URLSearchParams
): Promise<T> {
  return callSameOriginRemoteHttp(endpointPath, body, timeoutMs, method, query)
}

function appendAbsolutePathQuery(endpointPath: string, absolutePath: string, options: AbsoluteFileUrlOptions = {}): string {
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
  const endpoint = new URL(buildLocalGatewayUrl(normalizedPath))
  endpoint.searchParams.set('absolutePath', absolutePath)
  if (typeof options.sizePreset === 'string' && options.sizePreset.trim()) {
    endpoint.searchParams.set('sizePreset', options.sizePreset.trim())
  }
  return endpoint.toString()
}

function appendRemoteFileQuery(
  endpointPath: string,
  rootId: string,
  relativePath: string,
  options: RemoteFileUrlOptions = {}
): string {
  const normalizedPath = normalizeEndpointPath(endpointPath)
  const endpoint = new URL(`${getSameOriginGatewayBaseUrl()}${normalizedPath}`)
  endpoint.searchParams.set('rootId', rootId)
  endpoint.searchParams.set('relativePath', relativePath)
  if (typeof options.sizePreset === 'string' && options.sizePreset.trim()) {
    endpoint.searchParams.set('sizePreset', options.sizePreset.trim())
  }
  return endpoint.toString()
}

export function buildGatewayFileContentUrl(absolutePath: string): string {
  return appendAbsolutePathQuery('/v1/files/content', absolutePath)
}

export function buildGatewayFileThumbnailUrl(absolutePath: string, options: AbsoluteFileUrlOptions = {}): string {
  return appendAbsolutePathQuery('/v1/files/thumbnail', absolutePath, options)
}

export function buildRemoteGatewayFileContentUrl(rootId: string, relativePath: string): string {
  return appendRemoteFileQuery('/v1/remote/files/content', rootId, relativePath)
}

export function buildRemoteGatewayFileThumbnailUrl(
  rootId: string,
  relativePath: string,
  options: RemoteFileUrlOptions = {}
): string {
  return appendRemoteFileQuery('/v1/remote/files/thumbnail', rootId, relativePath, options)
}

export async function loadGatewayTextPreview(
  absolutePath: string,
  sizeLimitBytes?: number
): Promise<TextPreviewPayload> {
  return callGatewayHttp('/v1/files/text-preview', {
    absolutePath,
    ...(typeof sizeLimitBytes === 'number' ? { sizeLimitBytes } : {}),
  })
}

export async function loadRemoteGatewayTextPreview(
  rootId: string,
  relativePath: string,
  sizeLimitBytes?: number
): Promise<TextPreviewPayload> {
  return callSameOriginRemoteHttp('/v1/remote/files/text-preview', {
    rootId,
    relativePath,
    ...(typeof sizeLimitBytes === 'number' ? { sizeLimitBytes } : {}),
  })
}

function getFileRemoteRootId(file: FileItem): string {
  return typeof file.remoteRootId === 'string' ? file.remoteRootId.trim() : ''
}

export function buildGatewayFileContentUrlForItem(file: FileItem): string | null {
  const remoteRootId = getFileRemoteRootId(file)
  if (remoteRootId) {
    return buildRemoteGatewayFileContentUrl(remoteRootId, file.path)
  }
  if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
    return buildGatewayFileContentUrl(file.absolutePath.trim())
  }
  return null
}

export function buildGatewayFileThumbnailUrlForItem(
  file: FileItem,
  options: AbsoluteFileUrlOptions = {}
): string | null {
  const remoteRootId = getFileRemoteRootId(file)
  if (remoteRootId) {
    return buildRemoteGatewayFileThumbnailUrl(remoteRootId, file.path, {
      sizePreset: options.sizePreset,
    })
  }
  if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
    return buildGatewayFileThumbnailUrl(file.absolutePath.trim(), options)
  }
  return null
}

export async function loadGatewayTextPreviewForItem(
  file: FileItem,
  sizeLimitBytes?: number
): Promise<TextPreviewPayload> {
  const remoteRootId = getFileRemoteRootId(file)
  if (remoteRootId) {
    return loadRemoteGatewayTextPreview(remoteRootId, file.path, sizeLimitBytes)
  }
  if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
    return loadGatewayTextPreview(file.absolutePath.trim(), sizeLimitBytes)
  }
  throw new GatewayHttpError('File preview is unavailable', 'FILE_PREVIEW_UNAVAILABLE')
}

export function buildGatewayFaceCropUrl(faceId: string, options: FaceCropUrlOptions = {}): string {
  const normalizedFaceId = String(faceId || '').trim()
  const remoteRootId = isRemoteReadonlyProviderActive()
    ? (
      (typeof options.rootId === 'string' && options.rootId.trim()
        ? (fromRemoteUiRootId(options.rootId) ?? options.rootId.trim())
        : getActiveRemoteWorkspace()?.configRootId)
      || ''
    )
    : ''

  const params = new URLSearchParams()
  if (remoteRootId) {
    params.set('rootId', remoteRootId)
  }
  if (typeof options.size === 'number' && Number.isFinite(options.size) && options.size > 0) {
    params.set('size', String(Math.trunc(options.size)))
  }
  if (typeof options.padding === 'number' && Number.isFinite(options.padding) && options.padding >= 0) {
    params.set('padding', String(options.padding))
  }

  if (!normalizedFaceId) {
    const baseUrl = isRemoteReadonlyProviderActive()
      ? getSameOriginGatewayBaseUrl()
      : getLocalGatewayBaseUrl()
    const path = isRemoteReadonlyProviderActive() ? '/v1/remote/faces/crops/invalid' : '/v1/faces/crops/invalid'
    const query = params.toString()
    return query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`
  }

  const query = params.toString()
  const endpoint = isRemoteReadonlyProviderActive()
    ? `${getSameOriginGatewayBaseUrl()}/v1/remote/faces/crops/${encodeURIComponent(normalizedFaceId)}`
    : buildLocalGatewayUrl(`/v1/faces/crops/${encodeURIComponent(normalizedFaceId)}`)
  return query ? `${endpoint}?${query}` : endpoint
}

export async function loadGatewayCapabilities(timeoutMs: number = 2000): Promise<GatewayCapabilitiesSnapshot> {
  try {
    const health = (await fetchJsonWithTimeout(buildLocalGatewayUrl(HEALTH_ENDPOINT_PATH), timeoutMs)) as GatewayHealthResponse
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

async function fetchSameOriginJsonWithTimeout(
  endpointPath: string,
  timeoutMs: number,
  options: SameOriginRequestOptions = {}
): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${getSameOriginGatewayBaseUrl()}${normalizeEndpointPath(endpointPath)}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: options.headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401) {
        handleRemoteUnauthorizedResponse(response.status, options)
      }
      throw new GatewayHttpError(`Gateway request failed: ${response.status}`, undefined, response.status)
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
export async function loadRemoteGatewayCapabilities(
  timeoutMs: number = 2000,
): Promise<RemoteCapabilitiesSnapshot> {
  const payload = (await fetchSameOriginJsonWithTimeout(
    '/v1/remote/capabilities',
    timeoutMs,
  )) as Partial<RemoteCapabilitiesSnapshot>
  return {
    enabled: payload.enabled === true,
    authMode: 'session-cookie',
    loginMode: 'bearer-token-exchange',
    readOnly: true,
  }
}

export async function createRemoteGatewaySession(
  token: string,
  options: RemoteSessionCreateOptions = {},
): Promise<void> {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 2000
  const rememberDeviceLabel = typeof options.rememberDeviceLabel === 'string'
    ? options.rememberDeviceLabel.trim()
    : ''
  await callSameOriginRemoteHttp(
    '/v1/remote/session/login',
    {
      rememberDevice: options.rememberDevice === true,
      ...(options.rememberDevice === true && rememberDeviceLabel ? { rememberDeviceLabel } : {}),
    },
    timeoutMs,
    'POST',
    undefined,
    {
      headers: buildRemoteLoginHeaders(token),
      clearSessionOnUnauthorized: false,
    },
  )
}

export async function clearRemoteGatewaySession(
  options: RemoteSessionClearOptions = {},
): Promise<void> {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 2000
  await callSameOriginRemoteHttp(
    '/v1/remote/session/logout',
    {
      ...(options.forgetDevice === true ? { forgetDevice: true } : {}),
    },
    timeoutMs,
    'POST',
    undefined,
    {
      clearSessionOnUnauthorized: false,
    },
  )
}

export async function loadRemoteGatewayRoots(
  timeoutMs: number = 2000,
  options: SameOriginRequestOptions = {},
): Promise<RemoteRootEntry[]> {
  const payload = (await fetchSameOriginJsonWithTimeout(
    '/v1/remote/roots',
    timeoutMs,
    options,
  )) as { items?: Array<Partial<RemoteRootEntry>> }
  const items = Array.isArray(payload.items) ? payload.items : []
  return items.flatMap((item) => {
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    if (!id || !label) return []
    return [{ id, label }]
  })
}

export async function loadRemoteGatewayFavorites(
  timeoutMs: number = 2000,
): Promise<RemoteFavoriteEntry[]> {
  const payload = (await fetchSameOriginJsonWithTimeout(
    '/v1/remote/favorites',
    timeoutMs,
  )) as { items?: Array<Partial<RemoteFavoriteEntry>> }
  const items = Array.isArray(payload.items) ? payload.items : []
  return items.flatMap((item) => {
    const rootId = typeof item.rootId === 'string' ? item.rootId.trim() : ''
    const path = typeof item.path === 'string' ? item.path : ''
    const favoritedAtMs = Number(item.favoritedAtMs)
    if (!rootId || !Number.isFinite(favoritedAtMs)) {
      return []
    }
    return [{
      rootId,
      path,
      favoritedAtMs,
    }]
  })
}

export async function upsertRemoteGatewayFavorite(
  rootId: string,
  path: string,
  timeoutMs: number = 2000,
): Promise<void> {
  const normalizedRootId = rootId.trim()
  if (!normalizedRootId) {
    throw new GatewayHttpError('rootId 不能为空', 'REMOTE_ROOT_ID_REQUIRED', 400)
  }
  await callSameOriginRemoteHttp(
    '/v1/remote/favorites/upsert',
    {
      rootId: normalizedRootId,
      path,
    },
    timeoutMs,
    'POST',
  )
}

export async function removeRemoteGatewayFavorite(
  rootId: string,
  path: string,
  timeoutMs: number = 2000,
): Promise<void> {
  const normalizedRootId = rootId.trim()
  if (!normalizedRootId) {
    throw new GatewayHttpError('rootId 不能为空', 'REMOTE_ROOT_ID_REQUIRED', 400)
  }
  await callSameOriginRemoteHttp(
    '/v1/remote/favorites/remove',
    {
      rootId: normalizedRootId,
      path,
    },
    timeoutMs,
    'POST',
  )
}

export async function syncRemotePublishedRootsFromLocalBrowser(
  items: LocalPublishedRootSyncEntry[],
  timeoutMs: number = 2000,
): Promise<void> {
  const payload = Array.isArray(items)
    ? items.map((item) => ({
      label: item.label,
      absolutePath: item.absolutePath,
      favoritePaths: Array.isArray(item.favoritePaths) ? item.favoritePaths : [],
    }))
    : []
  await callGatewayHttp(
    '/v1/admin/remote-published-roots/sync-from-local-browser',
    payload,
    timeoutMs,
    'POST',
  )
}

export async function loadRememberedDevicesAdmin(
  timeoutMs: number = 2000,
): Promise<RememberedDeviceAdminEntry[]> {
  const payload = await callGatewayHttp<{ items?: Array<Partial<RememberedDeviceAdminEntry>> }>(
    '/v1/admin/remembered-devices',
    {},
    timeoutMs,
    'GET',
  )
  const items = Array.isArray(payload.items) ? payload.items : []
  return items.flatMap((item) => {
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const label = typeof item.label === 'string' ? item.label : ''
    const autoLabel = typeof item.autoLabel === 'string' ? item.autoLabel : ''
    const userAgentSummary = typeof item.userAgentSummary === 'string' ? item.userAgentSummary : ''
    const createdAtMs = Number(item.createdAtMs)
    const lastUsedAtMs = Number(item.lastUsedAtMs)
    const expiresAtMs = Number(item.expiresAtMs)
    if (
      !id
      || !autoLabel
      || !Number.isFinite(createdAtMs)
      || !Number.isFinite(lastUsedAtMs)
      || !Number.isFinite(expiresAtMs)
    ) {
      return []
    }
    return [{
      id,
      label,
      autoLabel,
      userAgentSummary,
      createdAtMs,
      lastUsedAtMs,
      expiresAtMs,
    }]
  })
}

export async function renameRememberedDeviceAdmin(
  deviceId: string,
  label: string,
  timeoutMs: number = 2000,
): Promise<void> {
  const normalizedDeviceId = deviceId.trim()
  if (!normalizedDeviceId) {
    throw new GatewayHttpError('设备 ID 不能为空', 'REMEMBERED_DEVICE_ID_REQUIRED', 400)
  }
  await callGatewayHttp(
    `/v1/admin/remembered-devices/${encodeURIComponent(normalizedDeviceId)}`,
    { label },
    timeoutMs,
    'PATCH',
  )
}

export async function revokeRememberedDeviceAdmin(
  deviceId: string,
  timeoutMs: number = 2000,
): Promise<void> {
  const normalizedDeviceId = deviceId.trim()
  if (!normalizedDeviceId) {
    throw new GatewayHttpError('设备 ID 不能为空', 'REMEMBERED_DEVICE_ID_REQUIRED', 400)
  }
  await callGatewayHttp(
    `/v1/admin/remembered-devices/${encodeURIComponent(normalizedDeviceId)}`,
    {},
    timeoutMs,
    'DELETE',
  )
}

export async function revokeAllRememberedDevicesAdmin(
  timeoutMs: number = 2000,
): Promise<void> {
  await callGatewayHttp('/v1/admin/remembered-devices/revoke-all', {}, timeoutMs, 'POST')
}

export async function loadGlobalShortcutConfig(timeoutMs: number = 2000): Promise<GlobalShortcutConfigSnapshot> {
  const payload = (await fetchJsonWithTimeout(
    buildLocalGatewayUrl(GLOBAL_SHORTCUTS_CONFIG_ENDPOINT_PATH),
    timeoutMs
  )) as GatewayGlobalShortcutConfigResponse

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid global shortcuts config response')
  }

  const path = typeof payload.path === 'string' && payload.path.trim()
    ? payload.path
    : '~/.fauplay/global/shortcuts.json'

  return {
    loaded: payload.loaded === true,
    path,
    config: payload.loaded === true ? (payload.config ?? null) : null,
  }
}
