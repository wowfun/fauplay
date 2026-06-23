import { callRuntimeJson, isObject, RuntimeApiError } from './core'
import type {
  RuntimeGlobalShortcutConfigSnapshot,
  RuntimeHealthSnapshot,
  RuntimeLocalRootBinding,
  RuntimeLocalRootBindingsResponse,
  RuntimeLocalRootBindingUpsertRequest,
} from './types'

function parseRuntimeHealthSnapshot(payload: unknown): RuntimeHealthSnapshot {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime health response was invalid')
  }

  return {
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    runtime: typeof payload.runtime === 'string' ? payload.runtime : 'unknown',
  }
}

function parseRuntimeGlobalShortcutConfigSnapshot(payload: unknown): RuntimeGlobalShortcutConfigSnapshot {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime global shortcuts response was invalid')
  }

  const loaded = payload.loaded === true
  const path = typeof payload.path === 'string' && payload.path.trim()
    ? payload.path
    : 'Fauplay Runtime global shortcuts'

  return {
    loaded,
    path,
    config: loaded ? (payload.config ?? null) : null,
  }
}

function parseRuntimeLocalRootBinding(payload: unknown): RuntimeLocalRootBinding {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime Local Root Binding response was invalid')
  }

  const rootId = typeof payload.rootId === 'string' ? payload.rootId.trim() : ''
  const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath.trim() : ''
  if (!rootId || !rootPath) {
    throw new RuntimeApiError('Fauplay Runtime Local Root Binding response was invalid')
  }

  return {
    rootId,
    rootPath,
  }
}

function parseRuntimeLocalRootBindingsResponse(payload: unknown): RuntimeLocalRootBindingsResponse {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime Local Root Bindings response was invalid')
  }

  return {
    items: Array.isArray(payload.items)
      ? payload.items.map(parseRuntimeLocalRootBinding)
      : [],
  }
}

export async function loadRuntimeHealth(timeoutMs?: number): Promise<RuntimeHealthSnapshot> {
  const payload = await callRuntimeJson('/v1/health', timeoutMs)
  return parseRuntimeHealthSnapshot(payload)
}

export async function loadRuntimeGlobalShortcutConfig(
  timeoutMs?: number,
): Promise<RuntimeGlobalShortcutConfigSnapshot> {
  const payload = await callRuntimeJson('/v1/config/shortcuts', timeoutMs)
  return parseRuntimeGlobalShortcutConfigSnapshot(payload)
}

export async function listRuntimeLocalRootBindings(
  timeoutMs?: number,
): Promise<RuntimeLocalRootBindingsResponse> {
  const payload = await callRuntimeJson('/v1/local-root-bindings', timeoutMs)
  return parseRuntimeLocalRootBindingsResponse(payload)
}

export async function upsertRuntimeLocalRootBinding(
  request: RuntimeLocalRootBindingUpsertRequest,
  timeoutMs?: number,
): Promise<RuntimeLocalRootBinding> {
  const query = new URLSearchParams({
    rootId: request.rootId,
    rootPath: request.rootPath,
  })
  const payload = await callRuntimeJson(`/v1/local-root-bindings?${query.toString()}`, timeoutMs, 'PUT')
  return parseRuntimeLocalRootBinding(payload)
}
