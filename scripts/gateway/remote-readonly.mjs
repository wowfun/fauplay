import { timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getFaceCrop,
  getFileTags,
  listAssetFaces,
  listPeople,
  listTagOptions,
  queryFilesByTags,
  readFileContentByAbsolutePath,
  readFileTextPreview,
} from './data/core.mjs'
import {
  isSkippableFsError,
  normalizeAbsolutePath,
  normalizeRelativePath,
  pathMatchesRoot,
  resolvePathWithinRoot,
  resolveRootPath,
  statPath,
} from './data/common.mjs'

const PROJECT_ROOT = process.cwd()
const HIDDEN_SYSTEM_DIRECTORIES = new Set(['.trash'])
const DEFAULT_REMOTE_ACCESS_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'src', 'config', 'remote-access.json')
const GLOBAL_REMOTE_ACCESS_CONFIG_PATH = path.join(os.homedir(), '.fauplay', 'global', 'remote-access.json')
const REMOTE_THUMBNAIL_CACHE_MAX_ENTRIES = 128
const REMOTE_FLATTEN_VIEW_MAX_FILES = readPositiveIntegerEnv('FAUPLAY_REMOTE_FLATTEN_VIEW_MAX_FILES', 5000)
const REMOTE_FLATTEN_VIEW_MAX_DIRECTORIES = readPositiveIntegerEnv('FAUPLAY_REMOTE_FLATTEN_VIEW_MAX_DIRECTORIES', 1000)
const REMOTE_THUMBNAIL_SOURCE_MAX_BYTES = readPositiveIntegerEnv('FAUPLAY_REMOTE_THUMBNAIL_SOURCE_MAX_BYTES', 32 * 1024 * 1024)
const PREVIEW_KIND_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
const PREVIEW_KIND_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'])
const PREVIEW_KIND_TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'xml',
  'csv',
  'log',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'py',
  'sh',
  'bash',
  'zsh',
  'ini',
  'conf',
  'toml',
  'sql',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'java',
  'go',
  'rs',
  'vue',
  'svelte',
])
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  ogg: 'video/ogg',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  csv: 'text/csv',
  log: 'text/plain',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  css: 'text/css',
  scss: 'text/x-scss',
  less: 'text/x-less',
  html: 'text/html',
  htm: 'text/html',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  ini: 'text/plain',
  conf: 'text/plain',
  toml: 'application/toml',
  sql: 'application/sql',
  c: 'text/x-c',
  cc: 'text/x-c++',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  hpp: 'text/x-c++',
  java: 'text/x-java-source',
  go: 'text/x-go',
  rs: 'text/x-rust',
}
const remoteThumbnailCache = new Map()

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

function getFileExtension(name) {
  return String(name || '').split('.').pop()?.toLowerCase() || ''
}

function getPreviewKind(name) {
  const ext = getFileExtension(name)
  if (PREVIEW_KIND_IMAGE_EXTS.has(ext)) return 'image'
  if (PREVIEW_KIND_VIDEO_EXTS.has(ext)) return 'video'
  if (PREVIEW_KIND_TEXT_EXTS.has(ext)) return 'text'
  return 'unsupported'
}

function getMimeType(name) {
  return MIME_BY_EXTENSION[getFileExtension(name)] || 'application/octet-stream'
}

function touchThumbnailCacheEntry(cacheKey, value) {
  if (remoteThumbnailCache.has(cacheKey)) {
    remoteThumbnailCache.delete(cacheKey)
  }
  remoteThumbnailCache.set(cacheKey, value)

  while (remoteThumbnailCache.size > REMOTE_THUMBNAIL_CACHE_MAX_ENTRIES) {
    const oldestKey = remoteThumbnailCache.keys().next().value
    if (!oldestKey) break
    remoteThumbnailCache.delete(oldestKey)
  }
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

async function directoryHasVisibleChildren(root, directoryPath) {
  const entries = await readDirectoryEntries(directoryPath, { allowSkip: true })
  if (!entries) {
    return false
  }
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue
    if (entry.isDirectory() && HIDDEN_SYSTEM_DIRECTORIES.has(entry.name)) {
      continue
    }
    const childPath = path.join(directoryPath, entry.name)
    try {
      const realPath = normalizeAbsolutePath(await fs.realpath(childPath))
      if (!pathMatchesRoot(root.realPath, realPath)) {
        continue
      }
    } catch {
      continue
    }
    return true
  }
  return false
}

async function readDirectoryEntries(directoryPath, { allowSkip = false } = {}) {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isSkippableFsError(error)) {
      if (allowSkip) {
        return null
      }
      throw createRemoteError(
        'REMOTE_DIRECTORY_UNAVAILABLE',
        'Remote directory is temporarily unavailable',
        422,
      )
    }
    throw error
  }
}

function createDirectoryTraversalBudget(flattenView) {
  if (!flattenView) return null
  return {
    remainingFiles: REMOTE_FLATTEN_VIEW_MAX_FILES,
    remainingDirectories: REMOTE_FLATTEN_VIEW_MAX_DIRECTORIES,
  }
}

function consumeTraversalBudget(budget, field, message) {
  if (!budget) return
  if (budget[field] <= 0) {
    throw createRemoteError('REMOTE_BUDGET_EXCEEDED', message, 422)
  }
  budget[field] -= 1
}

async function readDirectoryItemsRecursive(
  root,
  currentRelativePath,
  flattenView,
  traversalBudget = null,
  options = {},
) {
  const allowUnreadableDirectorySkip = options.allowUnreadableDirectorySkip === true
  const currentAbsolutePath = currentRelativePath
    ? resolvePathWithinRoot(root.path, currentRelativePath)
    : root.path
  const currentRealPath = await resolveRealPathWithinRoot(root, currentAbsolutePath)
  const statResult = await statPath(currentRealPath)
  if (!statResult.isDirectory()) {
    throw createRemoteError('REMOTE_NOT_DIRECTORY', 'path must point to a directory', 400)
  }

  const items = []
  const entries = await readDirectoryEntries(currentRealPath, {
    allowSkip: allowUnreadableDirectorySkip,
  })
  if (!entries) {
    return items
  }

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue
    if (entry.isDirectory() && HIDDEN_SYSTEM_DIRECTORIES.has(entry.name)) {
      continue
    }

    const absolutePath = path.join(currentRealPath, entry.name)
    let realPath = ''
    try {
      realPath = normalizeAbsolutePath(await fs.realpath(absolutePath))
    } catch {
      continue
    }
    if (!pathMatchesRoot(root.realPath, realPath)) {
      continue
    }

    const itemRelativePath = currentRelativePath
      ? `${currentRelativePath}/${entry.name}`
      : entry.name

    if (entry.isDirectory()) {
      if (!flattenView) {
        items.push({
          name: entry.name,
          path: itemRelativePath,
          kind: 'directory',
          isEmpty: !(await directoryHasVisibleChildren(root, realPath)),
        })
        continue
      }

      consumeTraversalBudget(
        traversalBudget,
        'remainingDirectories',
        'Remote directory traversal budget exceeded',
      )
      const nestedItems = await readDirectoryItemsRecursive(
        root,
        itemRelativePath,
        flattenView,
        traversalBudget,
        { allowUnreadableDirectorySkip: true },
      )
      items.push(...nestedItems)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    consumeTraversalBudget(
      traversalBudget,
      'remainingFiles',
      'Remote file traversal budget exceeded',
    )
    let fileStat = null
    try {
      fileStat = await statPath(realPath)
    } catch (error) {
      if (isSkippableFsError(error)) {
        continue
      }
      throw error
    }
    items.push({
      name: entry.name,
      path: itemRelativePath,
      kind: 'file',
      size: Number(fileStat.size) || 0,
      lastModifiedMs: Number.isFinite(Number(fileStat.mtimeMs)) ? Math.trunc(Number(fileStat.mtimeMs)) : 0,
      mimeType: getMimeType(entry.name),
      previewKind: getPreviewKind(entry.name),
    })
  }

  return items
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

function resolveRemoteRoot(remoteConfig, rootId) {
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

export async function listRemoteReadonlyFiles(remoteConfig, payload = {}) {
  const root = resolveRemoteRoot(remoteConfig, payload.rootId)
  const targetPath = normalizeOptionalRemotePath(payload.path, 'path')
  const flattenView = payload.flattenView === true
  const traversalBudget = createDirectoryTraversalBudget(flattenView)
  const items = await readDirectoryItemsRecursive(root, targetPath, flattenView, traversalBudget)
  return {
    ok: true,
    rootId: root.id,
    path: targetPath,
    flattenView,
    items,
  }
}

export async function readRemoteReadonlyTextPreview(remoteConfig, payload = {}) {
  const target = await resolveRemoteAbsolutePath(remoteConfig, payload.rootId, payload.relativePath)
  return readFileTextPreview({
    absolutePath: target.absolutePath,
    ...(typeof payload.sizeLimitBytes !== 'undefined' ? { sizeLimitBytes: payload.sizeLimitBytes } : {}),
  })
}

export async function readRemoteReadonlyFileContent(remoteConfig, query = {}) {
  const target = await resolveRemoteReadonlyFileResource(remoteConfig, query)
  return readFileContentByAbsolutePath({
    absolutePath: target.absolutePath,
  })
}

export async function readRemoteReadonlyThumbnailContent(remoteConfig, query = {}) {
  const target = await resolveRemoteReadonlyFileResource(remoteConfig, query)
  if (target.sizeBytes > REMOTE_THUMBNAIL_SOURCE_MAX_BYTES) {
    throw createRemoteError(
      'REMOTE_BUDGET_EXCEEDED',
      'Thumbnail source exceeds remote budget',
      422,
    )
  }
  const sizePreset = typeof query.sizePreset === 'string' && query.sizePreset.trim()
    ? query.sizePreset.trim()
    : 'auto'
  const cacheKey = [
    target.absolutePath,
    target.sizeBytes,
    target.lastModifiedMs,
    sizePreset,
  ].join(':')
  const cached = remoteThumbnailCache.get(cacheKey)
  if (cached) {
    touchThumbnailCacheEntry(cacheKey, cached)
    return cached
  }

  const body = await fs.readFile(target.absolutePath)
  const next = {
    body,
    contentType: target.contentType,
  }
  touchThumbnailCacheEntry(cacheKey, next)
  return next
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

export async function readRemoteReadonlyFaceCrop(remoteConfig, faceId, query = {}) {
  const root = resolveRemoteRoot(remoteConfig, query.rootId)
  return getFaceCrop({
    faceId,
    rootPath: root.path,
    ...(typeof query.size !== 'undefined' ? { size: query.size } : {}),
    ...(typeof query.padding !== 'undefined' ? { padding: query.padding } : {}),
  })
}
