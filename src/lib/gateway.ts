import {
  fromRemoteUiRootId,
  getActiveRemoteWorkspace,
  isRemoteReadonlyProviderActive,
} from '@/lib/accessState'
import {
  GatewayHttpError,
  RuntimeMcpError,
  buildLocalRuntimeUrl,
  buildRemoteLoginHeaders,
  callLocalRuntimeHttp,
  callRemoteRuntimeHttp,
  callSameOriginRemoteHttp,
  fetchJsonWithTimeout,
  fetchSameOriginJsonWithTimeout,
  getLocalRuntimeBaseUrl,
  getSameOriginRuntimeBaseUrl,
  normalizeEndpointPath,
  type SameOriginRequestOptions,
  type ToolCallResult,
} from '@/lib/runtimeApi/http'
import {
  MCP_ENDPOINT_PATH,
  createRuntimeMcpClient,
} from '@/lib/runtimeApi/mcpClient'
import {
  parseRuntimeToolDescriptors,
  resolveRuntimeToolTimeoutMs,
  type RuntimeRawToolDescriptor,
  type RuntimeToolActionAnnotation,
  type RuntimeToolDescriptor,
  type RuntimeToolOptionAnnotation,
  type RuntimeToolOptionEnumValue,
  type RuntimeToolOptionType,
} from '@/lib/runtimeApi/toolDescriptors'
export type { ToolCallResult } from '@/lib/runtimeApi/http'
import type { FileItem, TextPreviewPayload } from '@/types'

const HEALTH_ENDPOINT_PATH = '/v1/health'
const buildLocalGatewayUrl = buildLocalRuntimeUrl
const getLocalGatewayBaseUrl = getLocalRuntimeBaseUrl
const getSameOriginGatewayBaseUrl = getSameOriginRuntimeBaseUrl

export const callGatewayHttp = callLocalRuntimeHttp
export const callRemoteGatewayHttp = callRemoteRuntimeHttp
const runtimeMcpClient = createRuntimeMcpClient({
  buildEndpointUrl: () => buildLocalGatewayUrl(MCP_ENDPOINT_PATH),
  fetch: (url, init) => fetch(url, init),
  startTimeout: (handler, timeoutMs) => window.setTimeout(handler, timeoutMs),
  clearTimeout: (timeoutId) => window.clearTimeout(timeoutId),
})

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

export type GatewayToolDescriptor = RuntimeToolDescriptor
export type ToolOptionEnumValue = RuntimeToolOptionEnumValue
export type ToolOptionType = RuntimeToolOptionType
export type ToolOptionAnnotation = RuntimeToolOptionAnnotation
export type ToolActionAnnotation = RuntimeToolActionAnnotation

interface GatewayHealthResponse {
  status?: string
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

interface GatewayToolsListResult {
  tools?: RuntimeRawToolDescriptor[]
}

export interface GatewayCapabilitiesSnapshot {
  online: boolean
  tools: GatewayToolDescriptor[]
}

function resetMcpInitialization() {
  runtimeMcpClient.reset()
}

export async function listGatewayTools(timeoutMs: number = 2000): Promise<GatewayToolDescriptor[]> {
  const result = await runtimeMcpClient.call<GatewayToolsListResult>('tools/list', {}, timeoutMs)
  return parseRuntimeToolDescriptors(result?.tools)
}

export async function callGatewayTool<T = ToolCallResult>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  if (!toolName) {
    throw new RuntimeMcpError('toolName is required', 'MCP_INVALID_PARAMS')
  }

  const effectiveTimeoutMs = resolveRuntimeToolTimeoutMs(toolName, timeoutMs)
  return runtimeMcpClient.call<T>('tools/call', { name: toolName, arguments: args }, effectiveTimeoutMs)
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
