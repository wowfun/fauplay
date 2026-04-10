import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TextDecoder, promisify } from 'node:util'
import {
  execFileWithDrvfsRetry,
  openWithDrvfsRetry,
  statWithDrvfsRetry,
} from '../drvfs.mjs'

export const DB_DIRNAME = '.fauplay'
export const GLOBAL_CONFIG_DIRNAME = 'global'
export const DB_FILENAME = 'faudb.sqlite'
export const LEGACY_DB_FILENAME = 'faudb.global.sqlite'
export const SCHEMA_VERSION = 6
export const EMBEDDING_DIM = 512
const SAMPLE_CHUNK_BYTES = 64 * 1024
const HASH_HEX_128_LENGTH = 32
const ES_SEARCH_MAX_BUFFER = 16 * 1024 * 1024
const DEFAULT_ES_INSTANCE_NAME = '1.5a'
const DEFAULT_ES_MAX_CANDIDATES = 500
const MIN_ES_MAX_CANDIDATES = 1
const MAX_ES_MAX_CANDIDATES = 5000
const DEFAULT_LOCAL_DATA_CONFIG_PATH = path.resolve(process.cwd(), 'tools', 'mcp', 'local-data', 'config.json')
export const ANNOTATION_SOURCE = 'meta.annotation'
export const FACE_SOURCE = 'vision.face'
export const CLASSIFY_SOURCE = 'ml.classify'
export const UNANNOTATED_TAG_KEY = '__ANNOTATION_UNANNOTATED__'
export const FP_METHOD = 'b1'
export const GLOBAL_CONFIG_DIR = path.join(os.homedir(), DB_DIRNAME, GLOBAL_CONFIG_DIRNAME)
export const GLOBAL_DB_DIR = GLOBAL_CONFIG_DIR
export const GLOBAL_DB_PATH = path.join(GLOBAL_DB_DIR, DB_FILENAME)
export const LEGACY_GLOBAL_DB_PATH = path.join(os.homedir(), DB_DIRNAME, LEGACY_DB_FILENAME)
const execFileAsync = promisify(execFile)

export function nowTs() {
  return Date.now()
}

function isWindowsPath(input) {
  return typeof input === 'string' && /^[a-zA-Z]:[\\/]/.test(input)
}

export function normalizeAbsolutePath(input) {
  return path.resolve(input).replace(/\\/g, '/')
}

export function resolveRootPath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('rootPath is required')
  }

  const raw = input.trim()
  if (isWindowsPath(raw) && process.platform !== 'win32') {
    try {
      const converted = execFileSync('wslpath', ['-u', raw], { encoding: 'utf8' }).trim()
      if (converted) {
        return normalizeAbsolutePath(converted)
      }
    } catch {
      throw new Error('rootPath windows path cannot be resolved in current runtime')
    }
  }

  if (!path.isAbsolute(raw)) {
    throw new Error('rootPath must be an absolute path')
  }

  return normalizeAbsolutePath(raw)
}

export function resolveOptionalRootPath(input) {
  if (typeof input !== 'string' || !input.trim()) return null
  return resolveRootPath(input)
}

export function normalizeRelativePath(input, fieldName = 'relativePath') {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`${fieldName} contains invalid value`)
  }

  const normalized = input.replace(/\\/g, '/').split('/').filter(Boolean)
  if (normalized.length === 0) {
    throw new Error(`${fieldName} contains empty path`)
  }

  for (const segment of normalized) {
    if (segment === '.' || segment === '..') {
      throw new Error(`${fieldName} contains unsafe segments`)
    }
    if (segment.includes('\0')) {
      throw new Error(`${fieldName} contains invalid characters`)
    }
  }

  return normalized.join('/')
}

export function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function resolvePathWithinRoot(rootPath, relativePath) {
  const target = normalizeAbsolutePath(path.resolve(rootPath, ...relativePath.split('/')))
  const relative = path.relative(rootPath, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('relativePath escapes rootPath')
  }
  return target
}

export function toRelativePathWithinRoot(rootPath, absolutePath) {
  const target = normalizeAbsolutePath(absolutePath)
  const relative = path.relative(rootPath, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }
  return relative.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

export function pathMatchesRoot(rootPath, absolutePath) {
  if (!rootPath) return true
  return absolutePath === rootPath || absolutePath.startsWith(`${rootPath}/`)
}

export function toDisplayPath(rootPath, absolutePath) {
  if (!rootPath) return absolutePath
  return toRelativePathWithinRoot(rootPath, absolutePath) ?? absolutePath
}

export function buildPathScopeClause(columnName, rootPath) {
  if (!rootPath) {
    return {
      sql: '1 = 1',
      params: [],
    }
  }

  return {
    sql: `(${columnName} = ? OR ${columnName} LIKE ?)`,
    params: [rootPath, `${rootPath}/%`],
  }
}

export function readMappingPathField(mapping, primaryKey, fallbackKey) {
  if (!isObjectRecord(mapping)) return ''
  const primary = mapping[primaryKey]
  if (typeof primary === 'string' && primary.trim()) return primary
  if (fallbackKey) {
    const fallback = mapping[fallbackKey]
    if (typeof fallback === 'string' && fallback.trim()) return fallback
  }
  return ''
}

export function parseInteger(value, defaultValue) {
  const next = Number(value)
  if (!Number.isFinite(next) || !Number.isInteger(next)) {
    return defaultValue
  }
  return next
}

export function parseFiniteNumber(value, defaultValue = 0) {
  const next = Number(value)
  if (!Number.isFinite(next)) {
    return defaultValue
  }
  return next
}

function clampInt(value, min, max, defaultValue) {
  if (!Number.isInteger(value)) return defaultValue
  return Math.min(Math.max(value, min), max)
}

function asConfigObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }
  return input
}

export function isSkippableFsError(error) {
  if (!error || typeof error !== 'object') return false
  const code = error.code
  return code === 'EIO'
    || code === 'EACCES'
    || code === 'EPERM'
    || code === 'ENOENT'
    || code === 'ENOTDIR'
    || code === 'EISDIR'
}

export async function statPath(targetPath, options) {
  return statWithDrvfsRetry(targetPath, options)
}

export function toFileMtimeMs(statResult) {
  const value = Math.trunc(Number(statResult?.mtimeMs))
  return Number.isFinite(value) && value >= 0 ? value : 0
}

export function snapshotMatches(statResult, fileSizeBytes, fileMtimeMs) {
  if (!Number.isFinite(fileSizeBytes) || !Number.isFinite(fileMtimeMs)) {
    return false
  }
  return Number(statResult.size) === Number(fileSizeBytes)
    && toFileMtimeMs(statResult) === Number(fileMtimeMs)
}

async function readJsonFileSafe(filePath, required) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (!required && error && typeof error === 'object' && error.code === 'ENOENT') {
      return {}
    }
    throw new Error(`failed to load config: ${filePath}`)
  }
}

function resolveConfigPathValue(layers, key) {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index]
    if (!layer || !isObjectRecord(layer.config)) continue
    const raw = layer.config[key]
    if (typeof raw !== 'string' || !raw.trim()) continue
    const value = raw.trim()
    if (path.isAbsolute(value) || isWindowsPath(value)) {
      return value
    }
    return normalizeAbsolutePath(path.resolve(path.dirname(layer.path), value))
  }
  return ''
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function migrateLegacyGlobalDb() {
  await fs.mkdir(GLOBAL_DB_DIR, { recursive: true })

  if (await pathExists(GLOBAL_DB_PATH)) {
    return
  }
  if (!(await pathExists(LEGACY_GLOBAL_DB_PATH))) {
    return
  }

  try {
    await fs.rename(LEGACY_GLOBAL_DB_PATH, GLOBAL_DB_PATH)
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'EXDEV') {
      throw error
    }
    await fs.copyFile(LEGACY_GLOBAL_DB_PATH, GLOBAL_DB_PATH)
    await fs.unlink(LEGACY_GLOBAL_DB_PATH)
  }
}

export async function loadEsSearchConfig() {
  const baseConfig = asConfigObject(await readJsonFileSafe(DEFAULT_LOCAL_DATA_CONFIG_PATH, true))
  const layers = [{ path: DEFAULT_LOCAL_DATA_CONFIG_PATH, config: baseConfig }]
  const esPath = resolveConfigPathValue(layers, 'esPath')

  if (!esPath) {
    throw new Error('config.esPath is required')
  }

  return {
    esPath,
    instanceName: typeof baseConfig.instanceName === 'string' && baseConfig.instanceName.trim()
      ? baseConfig.instanceName.trim()
      : DEFAULT_ES_INSTANCE_NAME,
    maxCandidates: clampInt(
      Number(baseConfig.maxCandidates),
      MIN_ES_MAX_CANDIDATES,
      MAX_ES_MAX_CANDIDATES,
      DEFAULT_ES_MAX_CANDIDATES
    ),
  }
}

function decodeEsOutputBuffer(buffer) {
  const utf8Text = buffer.toString('utf8')
  if (!utf8Text.includes('\uFFFD')) {
    return utf8Text
  }

  try {
    const gbkText = new TextDecoder('gbk').decode(buffer)
    const utf8ReplacementCount = (utf8Text.match(/\uFFFD/g) || []).length
    const gbkReplacementCount = (gbkText.match(/\uFFFD/g) || []).length
    return gbkReplacementCount <= utf8ReplacementCount ? gbkText : utf8Text
  } catch {
    return utf8Text
  }
}

function parseEsCandidateWindowsPaths(stdoutText) {
  const windowsPaths = []
  const lines = stdoutText.split(/\r?\n/)

  for (const line of lines) {
    if (!line.trim()) continue

    const matchWithSize = line.match(/^\s*[0-9,]+\s+"(.+)"\s*$/)
    if (matchWithSize && matchWithSize[1]) {
      windowsPaths.push(matchWithSize[1])
      continue
    }

    const matchPathOnly = line.match(/^\s*"(.+)"\s*$/)
    if (matchPathOnly && matchPathOnly[1]) {
      windowsPaths.push(matchPathOnly[1])
    }
  }

  return windowsPaths
}

async function toWindowsPath(targetPath) {
  if (isWindowsPath(targetPath)) return targetPath
  if (process.platform === 'win32') return targetPath
  const { stdout } = await execFileAsync('wslpath', ['-w', targetPath])
  return String(stdout).trim()
}

async function toUnixPath(targetPath) {
  if (!isWindowsPath(targetPath)) return targetPath
  if (process.platform === 'win32') return targetPath
  const { stdout } = await execFileAsync('wslpath', ['-u', targetPath])
  return normalizeAbsolutePath(String(stdout).trim())
}

export async function searchCandidatesBySizeMtime(rootPath, snapshot, config) {
  const rootWindowsPath = await toWindowsPath(rootPath)

  const args = []
  if (config.instanceName) {
    args.push('-instance', config.instanceName)
  }
  args.push('-path', rootWindowsPath)
  args.push('file:')
  args.push(`size:${snapshot.fileSizeBytes}`)
  args.push('-double-quote')
  args.push('-n', String(config.maxCandidates))
  args.push('-size')

  const result = await execFileWithDrvfsRetry(
    config.esPath,
    args,
    {
      encoding: 'buffer',
      maxBuffer: ES_SEARCH_MAX_BUFFER,
    },
    [rootPath]
  )

  const stdoutBuffer = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(String(result.stdout || ''), 'utf8')
  const stdoutText = decodeEsOutputBuffer(stdoutBuffer)
  const windowsPaths = parseEsCandidateWindowsPaths(stdoutText)

  const deduped = new Map()
  for (const windowsPath of windowsPaths) {
    let unixPath = ''
    try {
      unixPath = await toUnixPath(windowsPath)
    } catch {
      continue
    }

    const absolutePath = normalizeAbsolutePath(unixPath)
    if (!pathMatchesRoot(rootPath, absolutePath)) continue

    let candidateStat = null
    try {
      candidateStat = await statWithDrvfsRetry(absolutePath)
    } catch (error) {
      if (isSkippableFsError(error)) continue
      throw error
    }

    if (!candidateStat || !candidateStat.isFile()) continue
    if (!snapshotMatches(candidateStat, snapshot.fileSizeBytes, snapshot.fileMtimeMs)) continue

    deduped.set(absolutePath, {
      absolutePath,
      stat: candidateStat,
    })
  }

  return [...deduped.values()]
}

async function readSampleBytes(absPath, fileSize) {
  const handle = await openWithDrvfsRetry(absPath, 'r')
  try {
    if (fileSize <= SAMPLE_CHUNK_BYTES * 2) {
      const all = Buffer.allocUnsafe(Math.max(fileSize, 0))
      if (fileSize > 0) {
        await handle.read(all, 0, fileSize, 0)
      }
      return all
    }

    const head = Buffer.allocUnsafe(SAMPLE_CHUNK_BYTES)
    const tail = Buffer.allocUnsafe(SAMPLE_CHUNK_BYTES)
    await handle.read(head, 0, SAMPLE_CHUNK_BYTES, 0)
    await handle.read(tail, 0, SAMPLE_CHUNK_BYTES, Math.max(0, fileSize - SAMPLE_CHUNK_BYTES))
    return Buffer.concat([head, tail])
  } finally {
    await handle.close()
  }
}

async function sha256HexForFile(absPath) {
  const hash = createHash('sha256')
  const handle = await openWithDrvfsRetry(absPath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead <= 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

export async function computeFingerprintsForFile(absPath, options, providedStat = null) {
  const statResult = providedStat ?? await statWithDrvfsRetry(absPath)
  if (!statResult.isFile()) {
    throw new Error('target path must be a file')
  }

  const fileSize = Number(statResult.size)
  const sampleBytes = await readSampleBytes(absPath, fileSize)
  const sampleSha256 = createHash('sha256').update(sampleBytes).digest('hex')
  const fingerprint = sampleSha256.slice(0, HASH_HEX_128_LENGTH)

  const result = {
    size: fileSize,
    fpMethod: FP_METHOD,
    fingerprint,
    bindingFp: `${FP_METHOD}:${fileSize}:${fingerprint}`,
  }

  if (options.exactEnabled) {
    const exactSha = await sha256HexForFile(absPath)
    result.exactFp = `e1:${exactSha}`
  }

  if (options.similarImageEnabled) {
    const simHex = sampleSha256.slice(0, 16)
    result.simFp = `s1:${simHex}`
  }

  return result
}

export function buildTagKey(key, value) {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

export function toTagDto(row) {
  const appliedAt = Number(row.appliedAt ?? row.updatedAt ?? 0)
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    source: row.source,
    appliedAt,
    updatedAt: appliedAt,
    score: row.score === null || typeof row.score === 'undefined' ? null : Number(row.score),
  }
}
