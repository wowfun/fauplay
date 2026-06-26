import { timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readRuntimeDirectoryListing } from './remote-file-access.mjs'
import {
  getFileTags,
  listAssetFaces,
  listPeople,
  listTagOptions,
  queryFilesByTags,
} from './data/core.mjs'
import {
  normalizeAbsolutePath,
  normalizeRelativePath,
  pathMatchesRoot,
  resolvePathWithinRoot,
  resolveRootPath,
  statPath,
} from './data/common.mjs'
import { getMimeType, getPreviewKind } from './data/file-preview-kind.mjs'

const PROJECT_ROOT = process.cwd()
const DEFAULT_REMOTE_ACCESS_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'src', 'config', 'remote-access.json')
const GLOBAL_REMOTE_ACCESS_CONFIG_PATH = path.join(os.homedir(), '.fauplay', 'global', 'remote-access.json')
const REMOTE_THUMBNAIL_SOURCE_MAX_BYTES = readPositiveIntegerEnv('FAUPLAY_REMOTE_THUMBNAIL_SOURCE_MAX_BYTES', 32 * 1024 * 1024)
function createRemoteError(code, message, statusCode) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readRemoteAccessConfigFile(configPath, { allowMissing = false } = {}) {
  let raw = ''
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch (error) {
    if (allowMissing && error && typeof error === 'object' && error.code === 'ENOENT') {
      return null
    }
    throw createRemoteError('REMOTE_ACCESS_CONFIG_ERROR', `Failed to read remote-access config: ${configPath}`, 500)
  }

  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw createRemoteError('REMOTE_ACCESS_CONFIG_ERROR', `Invalid JSON in remote-access config: ${configPath}`, 500)
  }

  if (!isObjectRecord(parsed)) {
    throw createRemoteError('REMOTE_ACCESS_CONFIG_ERROR', `remote-access config root must be an object: ${configPath}`, 500)
  }

  return parsed
}

function mergeRemoteAccessConfig(baseConfig, overrideConfig) {
  const base = isObjectRecord(baseConfig) ? baseConfig : {}
  const override = isObjectRecord(overrideConfig) ? overrideConfig : {}
  return {
    ...base,
    ...override,
    roots: Array.isArray(override.roots)
      ? override.roots
      : (Array.isArray(base.roots) ? base.roots : []),
  }
}

function normalizeRemoteRootSource(value) {
  return value === 'local-browser-sync' ? 'local-browser-sync' : 'manual'
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

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveRealPathWithinRoot(root, targetPath) {
  let realPath = ''
  try {
    realPath = normalizeAbsolutePath(await fs.realpath(targetPath))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw createRemoteError('REMOTE_FILE_NOT_FOUND', 'Target path not found', 404)
    }
    throw error
  }

  if (!pathMatchesRoot(root.realPath, realPath)) {
    throw createRemoteError('REMOTE_PATH_OUT_OF_ROOT', 'Target path escapes remote root', 403)
  }
  return realPath
}

async function resolveRemoteRootEntries(configRoots) {
  const items = Array.isArray(configRoots) ? configRoots : []
  const seenIds = new Set()
  const roots = []

  for (const item of items) {
    if (!isObjectRecord(item)) {
      throw createRemoteError('REMOTE_ACCESS_CONFIG_ERROR', 'remote-access.roots[] must contain objects', 500)
    }

    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const rawPath = typeof item.path === 'string' ? item.path.trim() : ''
    if (!id || !label || !rawPath) {
      throw createRemoteError('REMOTE_ACCESS_CONFIG_ERROR', 'remote-access root entries require id, label and path', 500)
    }
    if (seenIds.has(id)) {
      throw createRemoteError('REMOTE_ACCESS_CONFIG_ERROR', `Duplicate remote-access root id: ${id}`, 500)
    }
    seenIds.add(id)

    const resolvedPath = resolveRootPath(rawPath)
    const rootExists = await fileExists(resolvedPath)
    if (!rootExists) {
      throw createRemoteError('REMOTE_ACCESS_CONFIG_ERROR', `Remote root path does not exist: ${resolvedPath}`, 500)
    }

    const statResult = await statPath(resolvedPath)
    if (!statResult.isDirectory()) {
      throw createRemoteError('REMOTE_ACCESS_CONFIG_ERROR', `Remote root path must be a directory: ${resolvedPath}`, 500)
    }

    const realPath = normalizeAbsolutePath(await fs.realpath(resolvedPath))
    roots.push({
      id,
      label,
      path: resolvedPath,
      realPath,
    })
  }

  return roots
}

function readBearerToken(headers) {
  const raw = headers?.authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header !== 'string') return ''
  const trimmed = header.trim()
  if (!trimmed.startsWith('Bearer ')) return ''
  return trimmed.slice('Bearer '.length).trim()
}

function isTokenMatch(expected, received) {
  if (!expected || !received) return false
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

function stripAbsolutePathFromTagQueryResult(result) {
  const items = Array.isArray(result?.items) ? result.items : []
  return {
    ...result,
    items: items.map((item) => ({
      assetId: item.assetId,
      relativePath: item.relativePath,
      tags: Array.isArray(item.tags) ? item.tags : [],
      updatedAt: item.updatedAt,
    })),
  }
}

export async function loadRemoteReadonlyConfig() {
  const defaultConfig = await readRemoteAccessConfigFile(DEFAULT_REMOTE_ACCESS_CONFIG_PATH)
  const globalConfig = await readRemoteAccessConfigFile(GLOBAL_REMOTE_ACCESS_CONFIG_PATH, { allowMissing: true })
  const configSources = [
    {
      label: 'default',
      path: DEFAULT_REMOTE_ACCESS_CONFIG_PATH,
      loaded: true,
    },
    {
      label: 'global',
      path: GLOBAL_REMOTE_ACCESS_CONFIG_PATH,
      loaded: Boolean(globalConfig),
    },
  ]

  const merged = mergeRemoteAccessConfig(defaultConfig, globalConfig)
  const rootSource = normalizeRemoteRootSource(merged.rootSource)
  const token = typeof process.env.FAUPLAY_REMOTE_ACCESS_TOKEN === 'string'
    ? process.env.FAUPLAY_REMOTE_ACCESS_TOKEN.trim()
    : ''
  const roots = rootSource === 'manual'
    ? await resolveRemoteRootEntries(merged.roots)
    : []
  return {
    enabled: merged.enabled === true && Boolean(token),
    configured: merged.enabled === true,
    authConfigured: Boolean(token),
    token,
    rootSource,
    roots,
    configSources,
  }
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

export function ensureRemoteReadonlyAuthorized(remoteConfig, headers) {
  if (remoteConfig.enabled !== true || !remoteConfig.token) {
    throw createRemoteError('REMOTE_UNAUTHORIZED', 'Unauthorized', 401)
  }

  const receivedToken = readBearerToken(headers)
  if (!isTokenMatch(remoteConfig.token, receivedToken)) {
    throw createRemoteError('REMOTE_UNAUTHORIZED', 'Unauthorized', 401)
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

async function resolveRemoteAbsolutePath(remoteConfig, rootId, relativePath, fieldName = 'relativePath') {
  const root = resolveRemoteRoot(remoteConfig, rootId)
  const normalizedRelativePath = normalizeOptionalRemotePath(relativePath, fieldName)
  const candidatePath = normalizedRelativePath
    ? resolvePathWithinRoot(root.path, normalizedRelativePath)
    : root.path
  const realPath = await resolveRealPathWithinRoot(root, candidatePath)
  return {
    root,
    relativePath: normalizedRelativePath,
    absolutePath: realPath,
  }
}

export async function resolveRemoteReadonlyFileResource(remoteConfig, query = {}) {
  const target = await resolveRemoteAbsolutePath(remoteConfig, query.rootId, query.relativePath)
  const statResult = await statPath(target.absolutePath)
  if (!statResult.isFile()) {
    throw createRemoteError('REMOTE_NOT_FILE', 'relativePath must point to a file', 400)
  }

  return {
    ...target,
    contentType: getMimeType(path.basename(target.absolutePath)),
    sizeBytes: Number(statResult.size) || 0,
    lastModifiedMs: Number.isFinite(Number(statResult.mtimeMs)) ? Math.trunc(Number(statResult.mtimeMs)) : 0,
  }
}

export function listRemoteReadonlyRoots(remoteConfig) {
  return remoteConfig.roots.map((item) => ({
    id: item.id,
    label: item.label,
  }))
}

function toFiniteNumber(value) {
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

function toRemoteReadonlyListingItems(runtimeListing) {
  const entries = Array.isArray(runtimeListing?.entries) ? runtimeListing.entries : []
  return entries.flatMap((entry) => {
    if (!isObjectRecord(entry)) return []
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const rootRelativePath = typeof entry.rootRelativePath === 'string'
      ? normalizeOptionalRemotePath(entry.rootRelativePath, 'rootRelativePath')
      : ''
    const kind = entry.kind === 'directory' ? 'directory' : entry.kind === 'file' ? 'file' : null
    if (!name || !rootRelativePath || !kind) return []

    const item = {
      name,
      path: rootRelativePath,
      kind,
      displayPath: rootRelativePath,
    }
    if (kind === 'directory') {
      if (typeof entry.isEmpty === 'boolean') {
        item.isEmpty = entry.isEmpty
      }
      const entryCount = toFiniteNumber(entry.entryCount)
      if (typeof entryCount === 'number') {
        item.entryCount = entryCount
      }
      return [item]
    }

    const size = toFiniteNumber(entry.size)
    if (typeof size === 'number') {
      item.size = size
    }
    const lastModifiedMs = toFiniteNumber(entry.lastModifiedMs)
    if (typeof lastModifiedMs === 'number') {
      item.lastModifiedMs = lastModifiedMs
    }
    item.mimeType = getMimeType(name)
    item.previewKind = getPreviewKind(name)
    return [item]
  })
}

export async function listRemoteReadonlyFiles(remoteConfig, payload = {}, runtimeBaseUrl) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const targetPath = normalizeOptionalRemotePath(payload.path, 'path')
  const flattenView = payload.flattenView === true
  const runtimeListing = await readRuntimeDirectoryListing(runtimeBaseUrl, {
    rootPath: root.path,
    rootRelativePath: targetPath,
    flattened: flattenView,
  })
  return {
    ok: true,
    rootId: root.id,
    path: targetPath,
    flattenView,
    items: toRemoteReadonlyListingItems(runtimeListing),
    isTruncated: runtimeListing?.isTruncated === true,
    nextOffset: toFiniteNumber(runtimeListing?.nextOffset) ?? null,
  }
}

export async function resolveRemoteReadonlyThumbnailResource(remoteConfig, query = {}) {
  const target = await resolveRemoteReadonlyFileResource(remoteConfig, query)
  if (target.sizeBytes > REMOTE_THUMBNAIL_SOURCE_MAX_BYTES) {
    throw createRemoteError(
      'REMOTE_BUDGET_EXCEEDED',
      'Thumbnail source exceeds remote budget',
      422,
    )
  }
  return target
}

export async function listRemoteReadonlyTagOptions(remoteConfig, payload = {}) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  return listTagOptions({
    rootPath: root.path,
  })
}

export async function queryRemoteReadonlyFilesByTags(remoteConfig, payload = {}) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const result = await queryFilesByTags({
    rootPath: root.path,
    includeTagKeys: payload.includeTagKeys,
    excludeTagKeys: payload.excludeTagKeys,
    includeMatchMode: payload.includeMatchMode,
    page: payload.page,
    size: payload.size,
  })
  return stripAbsolutePathFromTagQueryResult(result)
}

export async function getRemoteReadonlyFileTags(remoteConfig, payload = {}) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const normalizedRelativePath = normalizeRelativePath(payload.relativePath, 'relativePath')
  const result = await getFileTags({
    rootPath: root.path,
    relativePath: normalizedRelativePath,
  })
  if (!result?.file) {
    return result
  }
  return {
    ...result,
    file: {
      assetId: result.file.assetId,
      relativePath: result.file.relativePath,
      tags: Array.isArray(result.file.tags) ? result.file.tags : [],
    },
  }
}

export async function listRemoteReadonlyPeople(remoteConfig, payload = {}) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  return listPeople({
    rootPath: root.path,
    scope: 'root',
    query: payload.query,
    page: payload.page,
    size: payload.size,
  })
}

export async function listRemoteReadonlyPersonFaces(remoteConfig, payload = {}) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const personId = typeof payload.personId === 'string' ? payload.personId.trim() : ''
  if (!personId) {
    throw createRemoteError('REMOTE_INVALID_PARAMS', 'personId is required', 400)
  }
  return listAssetFaces({
    rootPath: root.path,
    scope: 'root',
    personId,
  })
}
