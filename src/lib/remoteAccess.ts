import {
  callLocalRuntimeHttp,
  callSameOriginRemoteHttp,
} from './runtimeApi/http.ts'
import { RuntimeHttpError } from './runtimeApi/errors.ts'

export interface SameOriginRequestOptions {
  clearSessionOnUnauthorized?: boolean
  headers?: Record<string, string>
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

export interface RemoteAccessCapabilitiesSnapshot {
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

export type RemoteAccessHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RemoteAccessRequest {
  method: RemoteAccessHttpMethod
  body?: unknown
  timeoutMs: number
  headers?: Record<string, string>
  clearSessionOnUnauthorized?: boolean
}

export interface RemoteAccessClient {
  callRemoteAccessHttp<T = unknown>(
    endpointPath: string,
    body?: Record<string, unknown>,
    timeoutMs?: number,
    method?: 'GET' | 'POST',
  ): Promise<T>
  loadCapabilities(timeoutMs?: number): Promise<RemoteAccessCapabilitiesSnapshot>
  createSession(token: string, options?: RemoteSessionCreateOptions): Promise<void>
  clearSession(options?: RemoteSessionClearOptions): Promise<void>
  loadRoots(timeoutMs?: number, options?: SameOriginRequestOptions): Promise<RemoteRootEntry[]>
  loadFavorites(timeoutMs?: number): Promise<RemoteFavoriteEntry[]>
  upsertFavorite(rootId: string, path: string, timeoutMs?: number): Promise<void>
  removeFavorite(rootId: string, path: string, timeoutMs?: number): Promise<void>
  syncPublishedRootsFromLocalBrowser(items: LocalPublishedRootSyncEntry[], timeoutMs?: number): Promise<void>
  loadRememberedDevicesAdmin(timeoutMs?: number): Promise<RememberedDeviceAdminEntry[]>
  renameRememberedDeviceAdmin(deviceId: string, label: string, timeoutMs?: number): Promise<void>
  revokeRememberedDeviceAdmin(deviceId: string, timeoutMs?: number): Promise<void>
  revokeAllRememberedDevicesAdmin(timeoutMs?: number): Promise<void>
}

export interface RemoteAccessClientOptions {
  sameOriginRequest?: (endpointPath: string, request: RemoteAccessRequest) => Promise<unknown>
  localRuntimeRequest?: (endpointPath: string, request: RemoteAccessRequest) => Promise<unknown>
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

export function createRemoteAccessClient(options: RemoteAccessClientOptions = {}): RemoteAccessClient {
  const sameOriginRequest = options.sameOriginRequest ?? defaultSameOriginRequest
  const localRuntimeRequest = options.localRuntimeRequest ?? defaultLocalRuntimeRequest

  async function callRemoteAccessHttp<T = unknown>(
    endpointPath: string,
    body: Record<string, unknown> = {},
    timeoutMs: number = 2000,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<T> {
    return sameOriginRequest(endpointPath, { method, body, timeoutMs }) as Promise<T>
  }

  async function loadCapabilities(timeoutMs: number = 2000): Promise<RemoteAccessCapabilitiesSnapshot> {
    const payload = await sameOriginRequest('/v1/remote/capabilities', {
      method: 'GET',
      timeoutMs,
    }) as Partial<RemoteAccessCapabilitiesSnapshot>

    return {
      enabled: payload.enabled === true,
      authMode: 'session-cookie',
      loginMode: 'bearer-token-exchange',
      readOnly: true,
    }
  }

  async function createSession(token: string, requestOptions: RemoteSessionCreateOptions = {}): Promise<void> {
    const timeoutMs = typeof requestOptions.timeoutMs === 'number' ? requestOptions.timeoutMs : 2000
    const rememberDeviceLabel = typeof requestOptions.rememberDeviceLabel === 'string'
      ? requestOptions.rememberDeviceLabel.trim()
      : ''
    await sameOriginRequest('/v1/remote/session/login', {
      method: 'POST',
      body: {
        rememberDevice: requestOptions.rememberDevice === true,
        ...(requestOptions.rememberDevice === true && rememberDeviceLabel ? { rememberDeviceLabel } : {}),
      },
      timeoutMs,
      headers: buildRemoteLoginHeaders(token),
      clearSessionOnUnauthorized: false,
    })
  }

  async function clearSession(requestOptions: RemoteSessionClearOptions = {}): Promise<void> {
    const timeoutMs = typeof requestOptions.timeoutMs === 'number' ? requestOptions.timeoutMs : 2000
    await sameOriginRequest('/v1/remote/session/logout', {
      method: 'POST',
      body: {
        ...(requestOptions.forgetDevice === true ? { forgetDevice: true } : {}),
      },
      timeoutMs,
      clearSessionOnUnauthorized: false,
    })
  }

  async function loadRoots(
    timeoutMs: number = 2000,
    requestOptions: SameOriginRequestOptions = {},
  ): Promise<RemoteRootEntry[]> {
    const payload = await sameOriginRequest('/v1/remote/roots', {
      method: 'GET',
      timeoutMs,
      ...requestOptions,
    }) as { items?: Array<Partial<RemoteRootEntry>> }
    const items = Array.isArray(payload.items) ? payload.items : []
    return items.flatMap((item) => {
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const label = typeof item.label === 'string' ? item.label.trim() : ''
      if (!id || !label) return []
      return [{ id, label }]
    })
  }

  async function loadFavorites(timeoutMs: number = 2000): Promise<RemoteFavoriteEntry[]> {
    const payload = await sameOriginRequest('/v1/remote/favorites', {
      method: 'GET',
      timeoutMs,
    }) as { items?: Array<Partial<RemoteFavoriteEntry>> }
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

  async function upsertFavorite(rootId: string, path: string, timeoutMs: number = 2000): Promise<void> {
    const normalizedRootId = rootId.trim()
    if (!normalizedRootId) {
      throw new RuntimeHttpError('rootId 不能为空', 'REMOTE_ROOT_ID_REQUIRED', 400)
    }
    await sameOriginRequest('/v1/remote/favorites/upsert', {
      method: 'POST',
      body: {
        rootId: normalizedRootId,
        path,
      },
      timeoutMs,
    })
  }

  async function removeFavorite(rootId: string, path: string, timeoutMs: number = 2000): Promise<void> {
    const normalizedRootId = rootId.trim()
    if (!normalizedRootId) {
      throw new RuntimeHttpError('rootId 不能为空', 'REMOTE_ROOT_ID_REQUIRED', 400)
    }
    await sameOriginRequest('/v1/remote/favorites/remove', {
      method: 'POST',
      body: {
        rootId: normalizedRootId,
        path,
      },
      timeoutMs,
    })
  }

  async function syncPublishedRootsFromLocalBrowser(
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
    await localRuntimeRequest('/v1/admin/remote-published-roots/sync-from-local-browser', {
      method: 'POST',
      body: payload,
      timeoutMs,
    })
  }

  async function loadRememberedDevicesAdmin(timeoutMs: number = 2000): Promise<RememberedDeviceAdminEntry[]> {
    const payload = await localRuntimeRequest('/v1/admin/remembered-devices', {
      method: 'GET',
      body: {},
      timeoutMs,
    }) as { items?: Array<Partial<RememberedDeviceAdminEntry>> }
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

  async function renameRememberedDeviceAdmin(
    deviceId: string,
    label: string,
    timeoutMs: number = 2000,
  ): Promise<void> {
    const normalizedDeviceId = deviceId.trim()
    if (!normalizedDeviceId) {
      throw new RuntimeHttpError('设备 ID 不能为空', 'REMEMBERED_DEVICE_ID_REQUIRED', 400)
    }
    await localRuntimeRequest(`/v1/admin/remembered-devices/${encodeURIComponent(normalizedDeviceId)}`, {
      method: 'PATCH',
      body: { label },
      timeoutMs,
    })
  }

  async function revokeRememberedDeviceAdmin(deviceId: string, timeoutMs: number = 2000): Promise<void> {
    const normalizedDeviceId = deviceId.trim()
    if (!normalizedDeviceId) {
      throw new RuntimeHttpError('设备 ID 不能为空', 'REMEMBERED_DEVICE_ID_REQUIRED', 400)
    }
    await localRuntimeRequest(`/v1/admin/remembered-devices/${encodeURIComponent(normalizedDeviceId)}`, {
      method: 'DELETE',
      body: {},
      timeoutMs,
    })
  }

  async function revokeAllRememberedDevicesAdmin(timeoutMs: number = 2000): Promise<void> {
    await localRuntimeRequest('/v1/admin/remembered-devices/revoke-all', {
      method: 'POST',
      body: {},
      timeoutMs,
    })
  }

  return {
    callRemoteAccessHttp,
    loadCapabilities,
    createSession,
    clearSession,
    loadRoots,
    loadFavorites,
    upsertFavorite,
    removeFavorite,
    syncPublishedRootsFromLocalBrowser,
    loadRememberedDevicesAdmin,
    renameRememberedDeviceAdmin,
    revokeRememberedDeviceAdmin,
    revokeAllRememberedDevicesAdmin,
  }
}

const defaultRemoteAccessClient = createRemoteAccessClient()

export function callRemoteAccessHttp<T = unknown>(
  endpointPath: string,
  body: Record<string, unknown> = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
  return defaultRemoteAccessClient.callRemoteAccessHttp<T>(endpointPath, body, timeoutMs, method)
}

export function loadRemoteAccessCapabilities(timeoutMs?: number): Promise<RemoteAccessCapabilitiesSnapshot> {
  return defaultRemoteAccessClient.loadCapabilities(timeoutMs)
}

export function createRemoteAccessSession(
  token: string,
  options?: RemoteSessionCreateOptions,
): Promise<void> {
  return defaultRemoteAccessClient.createSession(token, options)
}

export function clearRemoteAccessSession(options?: RemoteSessionClearOptions): Promise<void> {
  return defaultRemoteAccessClient.clearSession(options)
}

export function loadRemoteAccessRoots(
  timeoutMs?: number,
  options?: SameOriginRequestOptions,
): Promise<RemoteRootEntry[]> {
  return defaultRemoteAccessClient.loadRoots(timeoutMs, options)
}

export function loadRemoteAccessFavorites(timeoutMs?: number): Promise<RemoteFavoriteEntry[]> {
  return defaultRemoteAccessClient.loadFavorites(timeoutMs)
}

export function upsertRemoteAccessFavorite(rootId: string, path: string, timeoutMs?: number): Promise<void> {
  return defaultRemoteAccessClient.upsertFavorite(rootId, path, timeoutMs)
}

export function removeRemoteAccessFavorite(rootId: string, path: string, timeoutMs?: number): Promise<void> {
  return defaultRemoteAccessClient.removeFavorite(rootId, path, timeoutMs)
}

export function syncRemotePublishedRootsFromLocalBrowser(
  items: LocalPublishedRootSyncEntry[],
  timeoutMs?: number,
): Promise<void> {
  return defaultRemoteAccessClient.syncPublishedRootsFromLocalBrowser(items, timeoutMs)
}

export function loadRememberedDevicesAdmin(timeoutMs?: number): Promise<RememberedDeviceAdminEntry[]> {
  return defaultRemoteAccessClient.loadRememberedDevicesAdmin(timeoutMs)
}

export function renameRememberedDeviceAdmin(
  deviceId: string,
  label: string,
  timeoutMs?: number,
): Promise<void> {
  return defaultRemoteAccessClient.renameRememberedDeviceAdmin(deviceId, label, timeoutMs)
}

export function revokeRememberedDeviceAdmin(deviceId: string, timeoutMs?: number): Promise<void> {
  return defaultRemoteAccessClient.revokeRememberedDeviceAdmin(deviceId, timeoutMs)
}

export function revokeAllRememberedDevicesAdmin(timeoutMs?: number): Promise<void> {
  return defaultRemoteAccessClient.revokeAllRememberedDevicesAdmin(timeoutMs)
}

function buildRemoteLoginHeaders(token: string): Record<string, string> {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new RuntimeHttpError('远程 token 不能为空', 'REMOTE_TOKEN_REQUIRED', 400)
  }
  return {
    Authorization: `Bearer ${normalizedToken}`,
  }
}

function defaultSameOriginRequest(endpointPath: string, request: RemoteAccessRequest): Promise<unknown> {
  return callSameOriginRemoteHttp(
    endpointPath,
    isRecord(request.body) ? request.body : {},
    request.timeoutMs,
    request.method === 'GET' ? 'GET' : 'POST',
    undefined,
    {
      ...(request.headers ? { headers: request.headers } : {}),
      ...(typeof request.clearSessionOnUnauthorized === 'boolean'
        ? { clearSessionOnUnauthorized: request.clearSessionOnUnauthorized }
        : {}),
    },
  )
}

function defaultLocalRuntimeRequest(endpointPath: string, request: RemoteAccessRequest): Promise<unknown> {
  return callLocalRuntimeHttp(
    endpointPath,
    request.body ?? {},
    request.timeoutMs,
    request.method,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
