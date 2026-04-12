export type AccessProvider = 'local-browser' | 'remote-readonly'

export interface ActiveRemoteWorkspace {
  serviceOrigin: string
  serviceKey: string
  configRootId: string
  uiRootId: string
  rootLabel: string
}

const ACCESS_PROVIDER_STORAGE_KEY = 'fauplay:access-provider'
const REMOTE_WORKSPACE_STORAGE_KEY = 'fauplay:remote-access:workspace'
const REMOTE_SESSION_INVALIDATED_EVENT = 'fauplay:remote-session-invalidated'

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function getCurrentOrigin(): string {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return ''
  }
  return window.location.origin
}

export function isLoopbackOrigin(origin: string = getCurrentOrigin()): boolean {
  if (!origin) return false
  try {
    const hostname = new URL(origin).hostname.trim().replace(/^\[|\]$/g, '').toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

export function buildRemoteServiceKey(origin: string = getCurrentOrigin()): string {
  return `remote:${origin}`
}

export function toRemoteUiRootId(configRootId: string, origin: string = getCurrentOrigin()): string {
  return `${buildRemoteServiceKey(origin)}:root:${configRootId}`
}

export function fromRemoteUiRootId(uiRootId: string): string | null {
  const normalizedRootId = typeof uiRootId === 'string' ? uiRootId.trim() : ''
  if (!normalizedRootId) return null
  const parts = normalizedRootId.split(':root:')
  if (parts.length < 2) return null
  const configRootId = parts[1]?.trim()
  return configRootId || null
}

function parseRemoteWorkspace(raw: string | null): ActiveRemoteWorkspace | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const candidate = parsed as Partial<ActiveRemoteWorkspace>
    if (
      typeof candidate.serviceOrigin !== 'string'
      || typeof candidate.serviceKey !== 'string'
      || typeof candidate.configRootId !== 'string'
      || typeof candidate.uiRootId !== 'string'
      || typeof candidate.rootLabel !== 'string'
    ) {
      return null
    }
    return {
      serviceOrigin: candidate.serviceOrigin,
      serviceKey: candidate.serviceKey,
      configRootId: candidate.configRootId,
      uiRootId: candidate.uiRootId,
      rootLabel: candidate.rootLabel,
    }
  } catch {
    return null
  }
}

export function getStoredAccessProvider(): AccessProvider {
  if (!canUseSessionStorage()) return 'local-browser'
  const raw = window.sessionStorage.getItem(ACCESS_PROVIDER_STORAGE_KEY)
  return raw === 'remote-readonly' ? 'remote-readonly' : 'local-browser'
}

export function setStoredAccessProvider(provider: AccessProvider): void {
  if (!canUseSessionStorage()) return
  window.sessionStorage.setItem(ACCESS_PROVIDER_STORAGE_KEY, provider)
}

export function getActiveRemoteWorkspace(): ActiveRemoteWorkspace | null {
  if (!canUseSessionStorage()) return null
  return parseRemoteWorkspace(window.sessionStorage.getItem(REMOTE_WORKSPACE_STORAGE_KEY))
}

export function setActiveRemoteWorkspace(configRootId: string, rootLabel: string): ActiveRemoteWorkspace {
  const serviceOrigin = getCurrentOrigin()
  const nextWorkspace: ActiveRemoteWorkspace = {
    serviceOrigin,
    serviceKey: buildRemoteServiceKey(serviceOrigin),
    configRootId,
    uiRootId: toRemoteUiRootId(configRootId, serviceOrigin),
    rootLabel,
  }

  if (canUseSessionStorage()) {
    window.sessionStorage.setItem(REMOTE_WORKSPACE_STORAGE_KEY, JSON.stringify(nextWorkspace))
  }

  return nextWorkspace
}

export function clearRemoteWorkspace(): void {
  if (!canUseSessionStorage()) return
  window.sessionStorage.removeItem(REMOTE_WORKSPACE_STORAGE_KEY)
}

export function clearRemoteSession({ emitInvalidatedEvent = false }: { emitInvalidatedEvent?: boolean } = {}): void {
  if (canUseSessionStorage()) {
    window.sessionStorage.removeItem(REMOTE_WORKSPACE_STORAGE_KEY)
    window.sessionStorage.setItem(ACCESS_PROVIDER_STORAGE_KEY, 'local-browser')
  }

  if (emitInvalidatedEvent && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(REMOTE_SESSION_INVALIDATED_EVENT))
  }
}

export function isRemoteReadonlyProviderActive(): boolean {
  return getStoredAccessProvider() === 'remote-readonly' && Boolean(getActiveRemoteWorkspace())
}

export function getRemoteSessionInvalidatedEventName(): string {
  return REMOTE_SESSION_INVALIDATED_EVENT
}
