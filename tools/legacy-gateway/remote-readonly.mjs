import { execFileSync } from 'node:child_process'
import path from 'node:path'
import {
  listRuntimeAssetFaces,
  listRuntimePeople,
  queryRuntimeFileAnnotations,
  readRuntimeRemoteAccessConfig,
  readRuntimeFileAnnotation,
  readRuntimeRemoteSharedFavorites,
  readRuntimeTagOptions,
  removeRuntimeRemoteSharedFavorite,
  upsertRuntimeRemoteSharedFavorite,
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

function normalizeRelativePath(input, fieldName = 'relativePath') {
  if (typeof input !== 'string' || !input.trim()) {
    throw createRemoteError('REMOTE_INVALID_PARAMS', `${fieldName} contains invalid value`, 400)
  }

  const normalized = input.replace(/\\/g, '/').split('/').filter(Boolean)
  if (normalized.length === 0) {
    throw createRemoteError('REMOTE_INVALID_PARAMS', `${fieldName} contains empty path`, 400)
  }

  for (const segment of normalized) {
    if (segment === '.' || segment === '..') {
      throw createRemoteError('REMOTE_INVALID_PARAMS', `${fieldName} contains unsafe segments`, 400)
    }
    if (segment.includes('\0')) {
      throw createRemoteError('REMOTE_INVALID_PARAMS', `${fieldName} contains invalid characters`, 400)
    }
  }

  return normalized.join('/')
}

function normalizeOptionalRemotePath(value, fieldName = 'relativePath') {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  return normalizeRelativePath(trimmed, fieldName)
}

function normalizeRemoteFavoritePath(value) {
  if (typeof value !== 'string') {
    throw createRemoteError('REMOTE_INVALID_PARAMS', 'path must be a string', 400)
  }
  return normalizeOptionalRemotePath(value, 'path')
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

function toRemoteReadonlyFavorite(item, allowedRootIds) {
  if (!isObjectRecord(item)) return null
  const rootId = typeof item.rootId === 'string' ? item.rootId.trim() : ''
  if (!rootId || !allowedRootIds.has(rootId)) return null
  const pathSource = typeof item.path === 'string' ? item.path : ''
  let normalizedPath = ''
  try {
    normalizedPath = normalizeOptionalRemotePath(pathSource, 'path')
  } catch {
    return null
  }
  const favoritedAtMs = toFiniteNumber(item.favoritedAtMs)
  if (typeof favoritedAtMs !== 'number') return null
  return {
    rootId,
    path: normalizedPath,
    favoritedAtMs,
  }
}

function remoteReadonlyRootIdSet(remoteConfig) {
  return new Set(
    remoteConfig.roots
      .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
      .filter(Boolean),
  )
}

export async function listRemoteReadonlyFavorites(remoteConfig, runtimeBaseUrl) {
  const allowedRootIds = remoteReadonlyRootIdSet(remoteConfig)
  const result = await readRuntimeRemoteSharedFavorites(runtimeBaseUrl)
  return Array.isArray(result?.items)
    ? result.items.map((item) => toRemoteReadonlyFavorite(item, allowedRootIds)).filter(Boolean)
    : []
}

export async function upsertRemoteReadonlyFavorite(remoteConfig, payload = {}, runtimeBaseUrl) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const normalizedPath = normalizeRemoteFavoritePath(payload.path)
  const result = await upsertRuntimeRemoteSharedFavorite(runtimeBaseUrl, {
    rootId: root.id,
    path: normalizedPath,
    favoritedAtMs: Date.now(),
  })
  const item = toRemoteReadonlyFavorite(result?.item, new Set([root.id]))
  if (!item) {
    throw createRemoteError('REMOTE_RUNTIME_RESPONSE_ERROR', 'Runtime returned an invalid Favorite Folder', 502)
  }
  return item
}

export async function removeRemoteReadonlyFavorite(remoteConfig, payload = {}, runtimeBaseUrl) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const normalizedPath = normalizeRemoteFavoritePath(payload.path)
  await removeRuntimeRemoteSharedFavorite(runtimeBaseUrl, {
    rootId: root.id,
    path: normalizedPath,
  })
}

function toFiniteNumber(value) {
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

function toRemoteReadonlyTagRecord(tag) {
  if (!isObjectRecord(tag)) return null
  const result = {}
  if (typeof tag.id === 'string' || typeof tag.id === 'number') {
    result.id = tag.id
  }
  if (typeof tag.key === 'string') {
    result.key = tag.key
  }
  if (typeof tag.value === 'string') {
    result.value = tag.value
  }
  if (typeof tag.source === 'string') {
    result.source = tag.source
  }
  const appliedAt = toFiniteNumber(tag.appliedAt)
  if (typeof appliedAt === 'number') {
    result.appliedAt = appliedAt
  }
  const updatedAt = toFiniteNumber(tag.updatedAt)
  if (typeof updatedAt === 'number') {
    result.updatedAt = updatedAt
  }
  if (tag.score === null) {
    result.score = null
  } else {
    const score = toFiniteNumber(tag.score)
    if (typeof score === 'number') {
      result.score = score
    }
  }
  return result
}

function toRemoteReadonlyFileTagView(file) {
  if (!isObjectRecord(file)) return null
  const relativePathSource = typeof file.relativePath === 'string' && file.relativePath.trim()
    ? file.relativePath
    : (typeof file.rootRelativePath === 'string' ? file.rootRelativePath : '')
  const relativePath = normalizeOptionalRemotePath(relativePathSource, 'relativePath')
  const result = {
    relativePath,
    tags: Array.isArray(file.tags)
      ? file.tags.map(toRemoteReadonlyTagRecord).filter(Boolean)
      : [],
  }
  if (typeof file.assetId === 'string' && file.assetId.trim()) {
    result.assetId = file.assetId.trim()
  }
  const updatedAt = toFiniteNumber(file.updatedAt)
  if (typeof updatedAt === 'number') {
    result.updatedAt = updatedAt
  }
  return result
}

function toRemoteReadonlyTagQueryResult(result) {
  const items = Array.isArray(result?.items)
    ? result.items.map(toRemoteReadonlyFileTagView).filter(Boolean)
    : []
  return {
    ...result,
    items,
  }
}

function toRemoteReadonlyFileTagResult(result) {
  const file = toRemoteReadonlyFileTagView(result?.file)
  return {
    ...result,
    file,
  }
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

export async function listRemoteReadonlyTagOptions(remoteConfig, payload = {}, runtimeBaseUrl) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  return readRuntimeTagOptions(runtimeBaseUrl, {
    rootPath: root.path,
  })
}

export async function queryRemoteReadonlyFilesByTags(remoteConfig, payload = {}, runtimeBaseUrl) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const result = await queryRuntimeFileAnnotations(runtimeBaseUrl, {
    rootPath: root.path,
    includeTagKeys: payload.includeTagKeys,
    excludeTagKeys: payload.excludeTagKeys,
    includeMatchMode: payload.includeMatchMode,
    page: payload.page,
    size: payload.size,
  })
  return toRemoteReadonlyTagQueryResult(result)
}

export async function getRemoteReadonlyFileTags(remoteConfig, payload = {}, runtimeBaseUrl) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const normalizedRelativePath = normalizeRelativePath(payload.relativePath, 'relativePath')
  const result = await readRuntimeFileAnnotation(runtimeBaseUrl, {
    rootPath: root.path,
    relativePath: normalizedRelativePath,
  })
  return toRemoteReadonlyFileTagResult(result)
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
