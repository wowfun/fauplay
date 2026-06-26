import { execFileSync } from 'node:child_process'
import path from 'node:path'
import {
  listRuntimeAssetFaces,
  listRuntimePeople,
  readRuntimeRemoteAccessConfig,
} from './remote-file-access.mjs'

const REMOTE_READONLY_HOST_PATH_FIELDS = new Set([
  'absolutePath',
  'rootPath',
  'rootAbsolutePath',
  'sourceAbsolutePath',
])

function createRemoteError(code, message, statusCode) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isWindowsPath(input) {
  return typeof input === 'string' && /^[a-zA-Z]:[\\/]/.test(input)
}

function normalizeAbsolutePath(input) {
  return path.resolve(input).replace(/\\/g, '/')
}

function resolveRootPath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw createRemoteError('REMOTE_INVALID_PARAMS', 'rootPath is required', 400)
  }

  const raw = input.trim()
  if (isWindowsPath(raw) && process.platform !== 'win32') {
    try {
      const converted = execFileSync('wslpath', ['-u', raw], { encoding: 'utf8' }).trim()
      if (converted) {
        return normalizeAbsolutePath(converted)
      }
    } catch {
      throw createRemoteError(
        'REMOTE_INVALID_PARAMS',
        'rootPath windows path cannot be resolved in current runtime',
        400,
      )
    }
  }

  if (!path.isAbsolute(raw)) {
    throw createRemoteError('REMOTE_INVALID_PARAMS', 'rootPath must be an absolute path', 400)
  }

  return normalizeAbsolutePath(raw)
}

function toRemoteReadonlyConfigSource(item) {
  if (!isObjectRecord(item)) return null
  const label = typeof item.label === 'string' ? item.label.trim() : ''
  const sourcePath = typeof item.path === 'string' ? item.path.trim() : ''
  if (!label || !sourcePath) return null
  return {
    label,
    path: sourcePath,
    loaded: item.loaded === true,
  }
}

function toRemoteReadonlyRoot(item) {
  if (!isObjectRecord(item)) return null
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const label = typeof item.label === 'string' ? item.label.trim() : ''
  const rawPath = typeof item.path === 'string' ? item.path.trim() : ''
  const rawRealPath = typeof item.realPath === 'string' ? item.realPath.trim() : ''
  if (!id || !label || !rawPath || !rawRealPath) return null
  return {
    id,
    label,
    path: resolveRootPath(rawPath),
    realPath: resolveRootPath(rawRealPath),
  }
}

function toRemoteReadonlyConfig(result) {
  const roots = Array.isArray(result?.roots)
    ? result.roots.map(toRemoteReadonlyRoot).filter(Boolean)
    : []
  const configSources = Array.isArray(result?.configSources)
    ? result.configSources.map(toRemoteReadonlyConfigSource).filter(Boolean)
    : []
  return {
    enabled: result?.enabled === true,
    configured: result?.configured === true,
    authConfigured: result?.authConfigured === true,
    rootSource: result?.rootSource === 'local-browser-sync' ? 'local-browser-sync' : 'manual',
    roots,
    configSources,
    fingerprint: typeof result?.fingerprint === 'string' ? result.fingerprint : '',
  }
}

export async function loadRemoteReadonlyConfig(runtimeBaseUrl) {
  return toRemoteReadonlyConfig(await readRuntimeRemoteAccessConfig(runtimeBaseUrl))
}

export function formatRemoteAccessConfigSourceLog(source) {
  const suffix = source.loaded ? '' : ' (missing, skipped)'
  return `[gateway]   - ${source.label}: ${source.path}${suffix}`
}

export function getRemoteReadonlyCapabilities(remoteConfig) {
  return {
    enabled: remoteConfig.enabled === true,
    authMode: 'session-cookie',
    loginMode: 'bearer-token-exchange',
    readOnly: true,
  }
}

export function resolveRemoteRoot(remoteConfig, rootId) {
  const normalizedRootId = typeof rootId === 'string' ? rootId.trim() : ''
  if (!normalizedRootId) {
    throw createRemoteError('REMOTE_INVALID_PARAMS', 'rootId is required', 400)
  }
  const match = remoteConfig.roots.find((item) => item.id === normalizedRootId) ?? null
  if (!match) {
    throw createRemoteError('REMOTE_ROOT_NOT_FOUND', 'Unknown remote root', 404)
  }
  return match
}

function omitRemoteReadonlyHostPathFields(value) {
  if (!isObjectRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !REMOTE_READONLY_HOST_PATH_FIELDS.has(key)),
  )
}

function toRemoteReadonlyRuntimeItemsResult(result) {
  const safeResult = isObjectRecord(result) ? omitRemoteReadonlyHostPathFields(result) : {}
  const items = Array.isArray(result?.items)
    ? result.items
      .filter(isObjectRecord)
      .map(omitRemoteReadonlyHostPathFields)
    : []
  return {
    ...safeResult,
    items,
  }
}

export async function listRemoteReadonlyPeople(remoteConfig, payload = {}, runtimeBaseUrl) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const result = await listRuntimePeople(runtimeBaseUrl, {
    rootPath: root.path,
    query: payload.query,
    page: payload.page,
    size: payload.size,
  })
  return toRemoteReadonlyRuntimeItemsResult(result)
}

export async function listRemoteReadonlyPersonFaces(remoteConfig, payload = {}, runtimeBaseUrl) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const personId = typeof payload.personId === 'string' ? payload.personId.trim() : ''
  if (!personId) {
    throw createRemoteError('REMOTE_INVALID_PARAMS', 'personId is required', 400)
  }
  const result = await listRuntimeAssetFaces(runtimeBaseUrl, {
    rootPath: root.path,
    personId,
  })
  return toRemoteReadonlyRuntimeItemsResult(result)
}
