/* global process */
import { execFile, execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { TextDecoder, promisify } from 'node:util'

const MCP_PROTOCOL_VERSION = '2025-11-05'
const SIDECAR_DIRNAME = '.fauplay'
const SIDECAR_FILENAME = '.annotations.v1.json'
const SCHEMA_VERSION = 1
const SAMPLE_CHUNK_BYTES = 64 * 1024
const HASH_HEX_128_LENGTH = 32
const SIMILAR_IMAGE_HAMMING_THRESHOLD = 8
const FINGERPRINT_CONCURRENCY = 4

const DEFAULT_ES_INSTANCE_NAME = '1.5a'
const DEFAULT_ES_MAX_CANDIDATES = 500
const MIN_ES_MAX_CANDIDATES = 1
const MAX_ES_MAX_CANDIDATES = 5000
const ES_SEARCH_MAX_BUFFER = 16 * 1024 * 1024

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tiff', 'tif',
])

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, 'config.json')
const LOCAL_CONFIG_PATH = path.resolve(__dirname, 'config.local.json')

const TOOL_DEFINITIONS = [
  {
    name: 'meta.annotation',
    description: '文件标注与指纹重绑',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        operation: {
          type: 'string',
          enum: ['setValue', 'refreshBindings', 'cleanupOrphans', 'findExactDuplicates', 'findSimilarImages'],
        },
        relativePath: { type: 'string' },
        relativePaths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        fieldKey: { type: 'string' },
        value: { type: 'string' },
        source: {
          type: 'string',
          enum: ['hotkey', 'click'],
        },
        confirm: { type: 'boolean' },
        exactEnabled: { type: 'boolean' },
        similarImageEnabled: { type: 'boolean' },
      },
      required: ['rootPath'],
      additionalProperties: false,
    },
    annotations: {
      title: '标注',
      mutation: true,
      icon: 'tags',
      scopes: ['file', 'workspace'],
      toolOptions: [
        {
          key: 'fingerprint.exact.enabled',
          label: '启用精确指纹',
          type: 'boolean',
          defaultValue: false,
          description: '开启后支持精确去重（SHA-256 全量哈希）',
          sendToTool: true,
          argumentKey: 'exactEnabled',
        },
        {
          key: 'fingerprint.similarImage.enabled',
          label: '启用图片相似指纹',
          type: 'boolean',
          defaultValue: false,
          description: '开启后支持图片相似候选',
          sendToTool: true,
          argumentKey: 'similarImageEnabled',
        },
      ],
      toolActions: [
        {
          key: 'refreshBindings',
          label: '刷新标注',
          description: '重算重绑并更新 active/orphan/conflict 状态',
          intent: 'primary',
          arguments: { operation: 'refreshBindings' },
        },
        {
          key: 'cleanupOrphansDryRun',
          label: '预演清理 orphan',
          description: '仅统计，不落盘删除',
          intent: 'outline',
          arguments: { operation: 'cleanupOrphans', confirm: false },
        },
        {
          key: 'cleanupOrphansCommit',
          label: '执行清理 orphan',
          description: '删除 orphan 标注记录',
          intent: 'accent',
          arguments: { operation: 'cleanupOrphans', confirm: true },
        },
        {
          key: 'findExactDuplicates',
          label: '查找精确重复',
          description: '按 exactFp 返回重复分组',
          intent: 'outline',
          arguments: { operation: 'findExactDuplicates' },
        },
        {
          key: 'findSimilarImages',
          label: '查找图片相似',
          description: '按 simFp 聚类返回相似候选',
          intent: 'outline',
          arguments: { operation: 'findSimilarImages' },
        },
      ],
    },
  },
]

function toJsonRpcError(code, message, dataCode) {
  const error = { code, message }
  if (dataCode) {
    error.data = { code: dataCode }
  }
  return error
}

function toErrorCode(error) {
  if (error?.code === 'MCP_INVALID_REQUEST') return error.code
  if (error?.code === 'MCP_METHOD_NOT_FOUND') return error.code
  if (error?.code === 'MCP_INVALID_PARAMS') return error.code
  if (error?.code === 'MCP_TOOL_NOT_FOUND') return error.code
  return 'MCP_TOOL_CALL_FAILED'
}

function toJsonRpcMappedError(error) {
  if (error?.code === 'MCP_INVALID_REQUEST') {
    return toJsonRpcError(-32600, error.message || 'Invalid Request', 'MCP_INVALID_REQUEST')
  }
  if (error?.code === 'MCP_METHOD_NOT_FOUND') {
    return toJsonRpcError(-32601, error.message || 'Method not found', 'MCP_METHOD_NOT_FOUND')
  }
  if (error?.code === 'MCP_INVALID_PARAMS') {
    return toJsonRpcError(-32602, error.message || 'Invalid params', 'MCP_INVALID_PARAMS')
  }
  if (error?.code === 'MCP_TOOL_NOT_FOUND') {
    return toJsonRpcError(-32601, error.message || 'Tool not found', 'MCP_TOOL_NOT_FOUND')
  }

  return toJsonRpcError(
    -32000,
    error instanceof Error ? error.message : 'Server error',
    toErrorCode(error)
  )
}

function writeJsonRpc(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function toInvalidParamsError(message) {
  const error = new Error(message)
  error.code = 'MCP_INVALID_PARAMS'
  return error
}

function parseJsonRpcRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Invalid JSON-RPC request payload')
    error.code = 'MCP_INVALID_REQUEST'
    throw error
  }
  if (payload.jsonrpc !== '2.0') {
    const error = new Error('jsonrpc must be "2.0"')
    error.code = 'MCP_INVALID_REQUEST'
    throw error
  }
  if (typeof payload.method !== 'string' || !payload.method) {
    const error = new Error('method is required')
    error.code = 'MCP_INVALID_REQUEST'
    throw error
  }

  return {
    id: payload.id,
    method: payload.method,
    params: payload.params && typeof payload.params === 'object' ? payload.params : {},
  }
}

function isWindowsPath(input) {
  return typeof input === 'string' && /^[a-zA-Z]:[\\/]/.test(input)
}

async function resolveRootPath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw toInvalidParamsError('rootPath is required')
  }

  const raw = input.trim()
  if (isWindowsPath(raw)) {
    try {
      return execFileSync('wslpath', ['-u', raw], { encoding: 'utf8' }).trim()
    } catch {
      throw toInvalidParamsError('rootPath windows path cannot be resolved in current runtime')
    }
  }

  if (!path.isAbsolute(raw)) {
    throw toInvalidParamsError('rootPath must be an absolute path')
  }

  return raw
}

function normalizeRelativePath(input, fieldName = 'relativePath') {
  if (typeof input !== 'string' || !input.trim()) {
    throw toInvalidParamsError(`${fieldName} contains invalid value`)
  }

  const normalized = input.replace(/\\/g, '/').split('/').filter(Boolean)
  if (normalized.length === 0) {
    throw toInvalidParamsError(`${fieldName} contains empty path`)
  }

  for (const segment of normalized) {
    if (segment === '..' || segment === '.') {
      throw toInvalidParamsError(`${fieldName} contains unsafe segments`)
    }
    if (segment.includes('\0')) {
      throw toInvalidParamsError(`${fieldName} contains invalid characters`)
    }
  }

  return normalized.join('/')
}

function resolvePathWithinRoot(rootPath, relativePath) {
  const target = path.resolve(rootPath, ...relativePath.split('/'))
  const relative = path.relative(rootPath, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw toInvalidParamsError('relativePath escapes rootPath')
  }
  return target
}

function toRelativePathWithinRoot(rootPath, absolutePath) {
  const target = path.resolve(absolutePath)
  const relative = path.relative(rootPath, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }
  const normalized = relative.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  return normalized || null
}

function parseBoolean(value, defaultValue = false, fieldName = 'boolean') {
  if (typeof value === 'undefined') return defaultValue
  if (typeof value !== 'boolean') {
    throw toInvalidParamsError(`${fieldName} must be boolean`)
  }
  return value
}

function parseOperation(value) {
  if (typeof value === 'undefined') return 'refreshBindings'
  if (value === 'setValue' || value === 'refreshBindings' || value === 'cleanupOrphans' || value === 'findExactDuplicates' || value === 'findSimilarImages') {
    return value
  }
  throw toInvalidParamsError('operation is invalid')
}

function isImagePath(relativePath) {
  const ext = path.extname(relativePath).slice(1).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function nowTs() {
  return Date.now()
}

function toSidecarPath(rootPath) {
  return path.join(rootPath, SIDECAR_DIRNAME, SIDECAR_FILENAME)
}

function isSkippableFsError(error) {
  if (!error || typeof error !== 'object') return false
  const code = error.code
  return code === 'EIO'
    || code === 'EACCES'
    || code === 'EPERM'
    || code === 'ENOENT'
    || code === 'ENOTDIR'
    || code === 'EISDIR'
}

function sanitizeSnapshotNumber(value) {
  if (!Number.isFinite(value)) return null
  const next = Math.trunc(Number(value))
  if (next < 0) return null
  return next
}

function toFileMtimeMs(statResult) {
  const value = Math.trunc(Number(statResult?.mtimeMs))
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function createDefaultDb() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: 0,
    annotations: [],
  }
}

function sanitizeFieldValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof key !== 'string' || !key.trim()) continue
    if (typeof item !== 'string') continue
    result[key.trim()] = item
  }
  return result
}

function sanitizeFingerprints(value) {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  if (typeof value.bindingFp === 'string' && value.bindingFp) result.bindingFp = value.bindingFp
  if (typeof value.exactFp === 'string' && value.exactFp) result.exactFp = value.exactFp
  if (typeof value.simFp === 'string' && value.simFp) result.simFp = value.simFp
  return result
}

function sanitizeStatus(value) {
  if (value === 'active' || value === 'orphan' || value === 'conflict') return value
  return 'active'
}

function sanitizeOrphanReason(value) {
  if (value === 'missing_path' || value === 'ambiguous_rebind' || value === 'no_candidate' || value === 'search_unavailable') {
    return value
  }
  return null
}

function sanitizeDb(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createDefaultDb()
  }

  const annotations = Array.isArray(raw.annotations) ? raw.annotations : []
  const nextAnnotations = []

  for (const item of annotations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    if (typeof item.annotationId !== 'string' || !item.annotationId) continue
    if (typeof item.pathSnapshot !== 'string' || !item.pathSnapshot) continue

    try {
      nextAnnotations.push({
        annotationId: item.annotationId,
        pathSnapshot: normalizeRelativePath(item.pathSnapshot, 'pathSnapshot'),
        fieldValues: sanitizeFieldValues(item.fieldValues),
        fingerprints: sanitizeFingerprints(item.fingerprints),
        fileSizeBytes: sanitizeSnapshotNumber(item.fileSizeBytes),
        fileMtimeMs: sanitizeSnapshotNumber(item.fileMtimeMs),
        status: sanitizeStatus(item.status),
        orphanReason: sanitizeOrphanReason(item.orphanReason),
        updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : 0,
      })
    } catch {
      // ignore malformed records and keep parsing
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
    annotations: nextAnnotations,
  }
}

async function readAnnotationDb(rootPath) {
  const sidecarPath = toSidecarPath(rootPath)
  try {
    const raw = await fs.readFile(sidecarPath, 'utf8')
    const parsed = JSON.parse(raw)
    return sanitizeDb(parsed)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return createDefaultDb()
    }
    throw error
  }
}

async function writeAnnotationDb(rootPath, db) {
  const sidecarPath = toSidecarPath(rootPath)
  const nextDb = sanitizeDb(db)
  nextDb.updatedAt = nowTs()
  await fs.mkdir(path.dirname(sidecarPath), { recursive: true })
  await fs.writeFile(sidecarPath, `${JSON.stringify(nextDb, null, 2)}\n`, 'utf8')
  return nextDb
}

async function listFilesRecursively(rootPath) {
  const result = []

  async function walk(relativeDir) {
    const absDir = relativeDir ? resolvePathWithinRoot(rootPath, relativeDir) : rootPath
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch (error) {
      if (isSkippableFsError(error)) {
        if (!relativeDir) throw error
        return
      }
      throw error
    }

    for (const entry of entries) {
      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (childRelative === SIDECAR_DIRNAME || childRelative.startsWith(`${SIDECAR_DIRNAME}/`)) continue
      if (childRelative === SIDECAR_FILENAME || childRelative === '.fauplay.annotations.v1.json') continue
      if (childRelative === '.trash' || childRelative.startsWith('.trash/')) continue

      if (entry.isDirectory()) {
        await walk(childRelative)
        continue
      }
      if (!entry.isFile()) continue

      result.push(childRelative)
    }
  }

  await walk('')
  return result
}

async function readSampleBytes(absPath, fileSize) {
  const handle = await fs.open(absPath, 'r')
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
  const handle = await fs.open(absPath, 'r')
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

async function computeFingerprintsForFile(absPath, relativePath, options, providedStat = null) {
  const statResult = providedStat ?? await fs.stat(absPath)
  if (!statResult.isFile()) {
    throw toInvalidParamsError('target path must be a file')
  }

  const fileSize = Number(statResult.size)
  const sampleBytes = await readSampleBytes(absPath, fileSize)
  const sampleSha256 = createHash('sha256').update(sampleBytes).digest('hex')
  const sampleSha256_128 = sampleSha256.slice(0, HASH_HEX_128_LENGTH)

  const result = {
    bindingFp: `b1:${fileSize}:${sampleSha256_128}`,
  }

  if (options.exactEnabled) {
    const exactSha = await sha256HexForFile(absPath)
    result.exactFp = `e1:${exactSha}`
  }

  if (options.similarImageEnabled && isImagePath(relativePath)) {
    const simHex = sampleSha256.slice(0, 16)
    result.simFp = `s1:${simHex}`
  }

  return result
}

async function runWithConcurrency(items, worker, concurrency = FINGERPRINT_CONCURRENCY) {
  if (items.length === 0) return []
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array(items.length)
  let cursor = 0

  const runOne = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }

  const workers = []
  for (let i = 0; i < safeConcurrency; i += 1) {
    workers.push(runOne())
  }
  await Promise.all(workers)
  return results
}

async function buildFingerprintIndex(rootPath, options) {
  const relativePaths = await listFilesRecursively(rootPath)

  const entriesWithSkips = await runWithConcurrency(relativePaths, async (relativePath) => {
    try {
      const absPath = resolvePathWithinRoot(rootPath, relativePath)
      const fingerprints = await computeFingerprintsForFile(absPath, relativePath, options)
      return {
        relativePath,
        fingerprints,
      }
    } catch (error) {
      if (isSkippableFsError(error)) {
        return null
      }
      throw error
    }
  })
  const entries = entriesWithSkips.filter((item) => item !== null)

  const byPath = new Map()
  const byExact = new Map()
  const simItems = []

  for (const entry of entries) {
    byPath.set(entry.relativePath, entry)

    if (entry.fingerprints.exactFp) {
      const exactPaths = byExact.get(entry.fingerprints.exactFp) ?? []
      exactPaths.push(entry.relativePath)
      byExact.set(entry.fingerprints.exactFp, exactPaths)
    }

    if (entry.fingerprints.simFp) {
      simItems.push({
        relativePath: entry.relativePath,
        simFp: entry.fingerprints.simFp,
      })
    }
  }

  return {
    entries,
    byPath,
    byExact,
    simItems,
  }
}

function parseSimBits(simFp) {
  if (typeof simFp !== 'string' || !simFp.startsWith('s1:')) return null
  const hex = simFp.slice(3)
  if (!/^[0-9a-fA-F]{1,16}$/.test(hex)) return null
  return BigInt(`0x${hex}`)
}

function hammingDistance64(left, right) {
  let value = left ^ right
  let distance = 0
  while (value > 0n) {
    distance += Number(value & 1n)
    value >>= 1n
  }
  return distance
}

function groupSimilarImages(simItems) {
  const parent = simItems.map((_, index) => index)

  const find = (value) => {
    let root = value
    while (parent[root] !== root) {
      root = parent[root]
    }
    while (parent[value] !== value) {
      const next = parent[value]
      parent[value] = root
      value = next
    }
    return root
  }

  const unite = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return
    parent[rightRoot] = leftRoot
  }

  const bitsList = simItems.map((item) => parseSimBits(item.simFp))

  for (let i = 0; i < simItems.length; i += 1) {
    const leftBits = bitsList[i]
    if (leftBits === null) continue
    for (let j = i + 1; j < simItems.length; j += 1) {
      const rightBits = bitsList[j]
      if (rightBits === null) continue
      const distance = hammingDistance64(leftBits, rightBits)
      if (distance <= SIMILAR_IMAGE_HAMMING_THRESHOLD) {
        unite(i, j)
      }
    }
  }

  const groupsByRoot = new Map()
  for (let i = 0; i < simItems.length; i += 1) {
    const root = find(i)
    const group = groupsByRoot.get(root) ?? []
    group.push(simItems[i].relativePath)
    groupsByRoot.set(root, group)
  }

  const groups = []
  for (const paths of groupsByRoot.values()) {
    if (paths.length <= 1) continue
    groups.push(paths.sort((left, right) => left.localeCompare(right)))
  }

  groups.sort((left, right) => right.length - left.length)
  return groups
}

function normalizeFieldKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw toInvalidParamsError('fieldKey is required')
  }
  return value.trim()
}

function normalizeFieldValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw toInvalidParamsError('value is required')
  }
  return value.trim()
}

function chooseCandidateByFingerprint(db, key, value) {
  if (!value) return null
  const candidates = db.annotations.filter((item) => item.fingerprints?.[key] === value)
  if (candidates.length === 0) return null
  const active = candidates.find((item) => item.status === 'active')
  return active ?? candidates[0]
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

async function readJsonFileSafe(filePath, required) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (!required && error && typeof error === 'object' && error.code === 'ENOENT') {
      return {}
    }
    throw new Error(`Failed to load config: ${filePath}`)
  }
}

async function loadSearchConfig() {
  const baseConfig = asConfigObject(await readJsonFileSafe(DEFAULT_CONFIG_PATH, true))
  const localConfig = asConfigObject(await readJsonFileSafe(LOCAL_CONFIG_PATH, false))
  const merged = { ...baseConfig, ...localConfig }

  if (typeof merged.esPath !== 'string' || !merged.esPath.trim()) {
    throw new Error('config.esPath is required')
  }

  return {
    esPath: merged.esPath.trim(),
    instanceName: typeof merged.instanceName === 'string' && merged.instanceName.trim()
      ? merged.instanceName.trim()
      : DEFAULT_ES_INSTANCE_NAME,
    maxCandidates: clampInt(
      Number(merged.maxCandidates),
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

  const gbkText = new TextDecoder('gbk').decode(buffer)
  const utf8ReplacementCount = (utf8Text.match(/\uFFFD/g) || []).length
  const gbkReplacementCount = (gbkText.match(/\uFFFD/g) || []).length
  return gbkReplacementCount <= utf8ReplacementCount ? gbkText : utf8Text
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
  return stdout.trim()
}

async function toUnixPath(targetPath) {
  if (!isWindowsPath(targetPath)) return targetPath
  if (process.platform === 'win32') return targetPath
  const { stdout } = await execFileAsync('wslpath', ['-u', targetPath])
  return stdout.trim()
}

async function searchCandidatesBySizeMtime(rootPath, snapshot, config) {
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

  const result = await execFileAsync(config.esPath, args, {
    encoding: 'buffer',
    maxBuffer: ES_SEARCH_MAX_BUFFER,
  })

  const stdoutBuffer = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(String(result.stdout || ''), 'utf8')
  const stdoutText = decodeEsOutputBuffer(stdoutBuffer)
  const windowsPaths = parseEsCandidateWindowsPaths(stdoutText)

  const deduped = new Map()

  for (const windowsPath of windowsPaths) {
    let unixPath
    try {
      unixPath = await toUnixPath(windowsPath)
    } catch {
      continue
    }

    const relativePath = toRelativePathWithinRoot(rootPath, unixPath)
    if (!relativePath) continue

    let candidateStat
    try {
      const absPath = resolvePathWithinRoot(rootPath, relativePath)
      candidateStat = await fs.stat(absPath)
    } catch (error) {
      if (isSkippableFsError(error)) continue
      throw error
    }

    if (!candidateStat.isFile()) continue
    if (Number(candidateStat.size) !== snapshot.fileSizeBytes) continue
    if (toFileMtimeMs(candidateStat) !== snapshot.fileMtimeMs) continue

    deduped.set(relativePath, {
      relativePath,
      stat: candidateStat,
    })
  }

  return [...deduped.values()]
}

function snapshotMatches(statResult, fileSizeBytes, fileMtimeMs) {
  if (!Number.isFinite(fileSizeBytes) || !Number.isFinite(fileMtimeMs)) {
    return false
  }
  return Number(statResult.size) === fileSizeBytes && toFileMtimeMs(statResult) === fileMtimeMs
}

async function handleSetValue(rootPath, params) {
  const relativePath = normalizeRelativePath(params.relativePath, 'relativePath')
  const fieldKey = normalizeFieldKey(params.fieldKey)
  const value = normalizeFieldValue(params.value)
  const source = params.source === 'hotkey' ? 'hotkey' : 'click'
  const exactEnabled = parseBoolean(params.exactEnabled, false, 'exactEnabled')
  const similarImageEnabled = parseBoolean(params.similarImageEnabled, false, 'similarImageEnabled')

  const absPath = resolvePathWithinRoot(rootPath, relativePath)
  const fileStat = await fs.stat(absPath)
  if (!fileStat.isFile()) {
    throw toInvalidParamsError('target path must be a file')
  }

  const fingerprints = await computeFingerprintsForFile(absPath, relativePath, {
    exactEnabled,
    similarImageEnabled,
  }, fileStat)

  const db = await readAnnotationDb(rootPath)
  let target = db.annotations.find((item) => item.pathSnapshot === relativePath) ?? null

  if (!target) {
    target = chooseCandidateByFingerprint(db, 'bindingFp', fingerprints.bindingFp)
  }
  if (!target && fingerprints.exactFp) {
    target = chooseCandidateByFingerprint(db, 'exactFp', fingerprints.exactFp)
  }

  const timestamp = nowTs()

  if (!target) {
    target = {
      annotationId: randomUUID(),
      pathSnapshot: relativePath,
      fieldValues: {},
      fingerprints: {},
      fileSizeBytes: null,
      fileMtimeMs: null,
      status: 'active',
      orphanReason: null,
      updatedAt: timestamp,
    }
    db.annotations.push(target)
  }

  target.pathSnapshot = relativePath
  target.fieldValues = {
    ...(target.fieldValues ?? {}),
    [fieldKey]: value,
  }
  target.fingerprints = {
    ...(target.fingerprints ?? {}),
    ...fingerprints,
  }
  target.fileSizeBytes = Number(fileStat.size)
  target.fileMtimeMs = toFileMtimeMs(fileStat)
  target.status = 'active'
  target.orphanReason = null
  target.updatedAt = timestamp

  await writeAnnotationDb(rootPath, db)

  return {
    ok: true,
    annotationId: target.annotationId,
    relativePath,
    fieldKey,
    value,
    source,
  }
}

async function handleRefreshBindings(rootPath, params) {
  const exactEnabled = parseBoolean(params.exactEnabled, false, 'exactEnabled')
  const similarImageEnabled = parseBoolean(params.similarImageEnabled, false, 'similarImageEnabled')
  const db = await readAnnotationDb(rootPath)

  if (db.annotations.length === 0) {
    return {
      ok: true,
      total: 0,
      active: 0,
      orphan: 0,
      conflict: 0,
      rebound: 0,
    }
  }

  let activeCount = 0
  let orphanCount = 0
  let conflictCount = 0
  let reboundCount = 0
  const timestamp = nowTs()

  let cachedSearchConfig = null
  let searchConfigLoadFailed = false

  const ensureSearchConfig = async () => {
    if (searchConfigLoadFailed) return null
    if (cachedSearchConfig) return cachedSearchConfig
    try {
      cachedSearchConfig = await loadSearchConfig()
      return cachedSearchConfig
    } catch {
      searchConfigLoadFailed = true
      return null
    }
  }

  for (const item of db.annotations) {
    const previousPath = item.pathSnapshot
    const originalBinding = item.fingerprints?.bindingFp
    const recordedSize = sanitizeSnapshotNumber(item.fileSizeBytes)
    const recordedMtime = sanitizeSnapshotNumber(item.fileMtimeMs)

    let previousPathStat = null
    try {
      const previousAbsPath = resolvePathWithinRoot(rootPath, previousPath)
      const statResult = await fs.stat(previousAbsPath)
      if (statResult.isFile()) {
        previousPathStat = statResult
      }
    } catch (error) {
      if (!isSkippableFsError(error)) {
        throw error
      }
    }

    if (previousPathStat) {
      const currentSize = Number(previousPathStat.size)
      const currentMtime = toFileMtimeMs(previousPathStat)

      if (snapshotMatches(previousPathStat, recordedSize, recordedMtime)) {
        item.status = 'active'
        item.orphanReason = null
        item.updatedAt = timestamp
        activeCount += 1
        continue
      }

      if (recordedSize === null || recordedMtime === null) {
        item.fileSizeBytes = currentSize
        item.fileMtimeMs = currentMtime
        item.status = 'active'
        item.orphanReason = null
        item.updatedAt = timestamp
        activeCount += 1
        continue
      }
    }

    if (recordedSize === null || recordedMtime === null || typeof originalBinding !== 'string' || !originalBinding) {
      item.status = 'orphan'
      item.orphanReason = 'no_candidate'
      item.updatedAt = timestamp
      orphanCount += 1
      continue
    }

    const searchConfig = await ensureSearchConfig()
    if (!searchConfig) {
      item.status = 'orphan'
      item.orphanReason = 'search_unavailable'
      item.updatedAt = timestamp
      orphanCount += 1
      continue
    }

    let candidates
    try {
      candidates = await searchCandidatesBySizeMtime(rootPath, {
        fileSizeBytes: recordedSize,
        fileMtimeMs: recordedMtime,
      }, searchConfig)
    } catch {
      item.status = 'orphan'
      item.orphanReason = 'search_unavailable'
      item.updatedAt = timestamp
      orphanCount += 1
      continue
    }

    const matchedCandidates = []

    for (const candidate of candidates) {
      try {
        const candidateAbsPath = resolvePathWithinRoot(rootPath, candidate.relativePath)
        const candidateFingerprints = await computeFingerprintsForFile(candidateAbsPath, candidate.relativePath, {
          exactEnabled: false,
          similarImageEnabled: false,
        }, candidate.stat)

        if (candidateFingerprints.bindingFp === originalBinding) {
          matchedCandidates.push(candidate)
        }
      } catch (error) {
        if (isSkippableFsError(error)) {
          continue
        }
        throw error
      }
    }

    if (matchedCandidates.length === 1) {
      const [matched] = matchedCandidates
      item.pathSnapshot = matched.relativePath
      item.fileSizeBytes = Number(matched.stat.size)
      item.fileMtimeMs = toFileMtimeMs(matched.stat)

      const nextFingerprints = {
        ...(item.fingerprints ?? {}),
        bindingFp: originalBinding,
      }

      if (exactEnabled || (similarImageEnabled && isImagePath(matched.relativePath))) {
        try {
          const matchedAbsPath = resolvePathWithinRoot(rootPath, matched.relativePath)
          const resolvedFingerprints = await computeFingerprintsForFile(matchedAbsPath, matched.relativePath, {
            exactEnabled,
            similarImageEnabled,
          }, matched.stat)
          item.fingerprints = {
            ...nextFingerprints,
            ...resolvedFingerprints,
          }
        } catch (error) {
          if (!isSkippableFsError(error)) {
            throw error
          }
          item.fingerprints = nextFingerprints
        }
      } else {
        item.fingerprints = nextFingerprints
      }

      item.status = 'active'
      item.orphanReason = null
      item.updatedAt = timestamp
      activeCount += 1
      reboundCount += 1
      continue
    }

    if (matchedCandidates.length > 1) {
      item.status = 'conflict'
      item.orphanReason = 'ambiguous_rebind'
      item.updatedAt = timestamp
      conflictCount += 1
      continue
    }

    item.status = 'orphan'
    item.orphanReason = 'no_candidate'
    item.updatedAt = timestamp
    orphanCount += 1
  }

  await writeAnnotationDb(rootPath, db)

  return {
    ok: true,
    total: db.annotations.length,
    active: activeCount,
    orphan: orphanCount,
    conflict: conflictCount,
    rebound: reboundCount,
  }
}

async function handleCleanupOrphans(rootPath, params) {
  const confirm = parseBoolean(params.confirm, false, 'confirm')
  const db = await readAnnotationDb(rootPath)
  const totalOrphans = db.annotations.filter((item) => item.status === 'orphan').length

  if (!confirm) {
    return {
      ok: true,
      dryRun: true,
      totalOrphans,
      removed: 0,
    }
  }

  const nextAnnotations = db.annotations.filter((item) => item.status !== 'orphan')
  const removed = db.annotations.length - nextAnnotations.length
  db.annotations = nextAnnotations
  await writeAnnotationDb(rootPath, db)

  return {
    ok: true,
    dryRun: false,
    totalOrphans,
    removed,
  }
}

async function handleFindExactDuplicates(rootPath, params) {
  const exactEnabled = parseBoolean(params.exactEnabled, false, 'exactEnabled')
  if (!exactEnabled) {
    throw toInvalidParamsError('findExactDuplicates requires exactEnabled=true')
  }

  const index = await buildFingerprintIndex(rootPath, {
    exactEnabled: true,
    similarImageEnabled: false,
  })

  const groups = []
  for (const [exactFp, paths] of index.byExact.entries()) {
    if (paths.length <= 1) continue
    groups.push({
      exactFp,
      paths: [...paths].sort((left, right) => left.localeCompare(right)),
    })
  }

  groups.sort((left, right) => right.paths.length - left.paths.length)
  return {
    ok: true,
    groups,
  }
}

async function handleFindSimilarImages(rootPath, params) {
  const similarImageEnabled = parseBoolean(params.similarImageEnabled, false, 'similarImageEnabled')
  if (!similarImageEnabled) {
    throw toInvalidParamsError('findSimilarImages requires similarImageEnabled=true')
  }

  const index = await buildFingerprintIndex(rootPath, {
    exactEnabled: false,
    similarImageEnabled: true,
  })

  const groupedPaths = groupSimilarImages(index.simItems)
  const groups = groupedPaths.map((paths, indexItem) => ({
    simClusterId: `cluster-${indexItem + 1}`,
    paths,
  }))

  return {
    ok: true,
    groups,
  }
}

async function handleToolCall(params) {
  const rootPath = await resolveRootPath(params.rootPath)
  const operation = parseOperation(params.operation)

  if (operation === 'setValue') {
    return handleSetValue(rootPath, params)
  }
  if (operation === 'refreshBindings') {
    return handleRefreshBindings(rootPath, params)
  }
  if (operation === 'cleanupOrphans') {
    return handleCleanupOrphans(rootPath, params)
  }
  if (operation === 'findExactDuplicates') {
    return handleFindExactDuplicates(rootPath, params)
  }
  if (operation === 'findSimilarImages') {
    return handleFindSimilarImages(rootPath, params)
  }

  throw toInvalidParamsError('unsupported operation')
}

async function handleRequest(request) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'fauplay-metadata-annotation', version: '0.1.0' },
    }
  }

  if (request.method === 'notifications/initialized') {
    return null
  }

  if (request.method === 'tools/list') {
    return { tools: TOOL_DEFINITIONS }
  }

  if (request.method === 'tools/call') {
    const toolName = request.params?.name
    const args = request.params?.arguments
    if (typeof toolName !== 'string' || !toolName) {
      throw toInvalidParamsError('params.name is required for tools/call')
    }
    if (args !== undefined && (typeof args !== 'object' || Array.isArray(args))) {
      throw toInvalidParamsError('params.arguments must be an object')
    }
    if (toolName !== 'meta.annotation') {
      const error = new Error(`Unknown tool: ${toolName}`)
      error.code = 'MCP_TOOL_NOT_FOUND'
      throw error
    }

    return handleToolCall(args ?? {})
  }

  const error = new Error(`Unsupported method: ${request.method}`)
  error.code = 'MCP_METHOD_NOT_FOUND'
  throw error
}

function startServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  rl.on('line', async (line) => {
    if (!line.trim()) return

    let payload
    try {
      payload = JSON.parse(line)
    } catch {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: null,
        error: toJsonRpcError(-32700, 'Parse error', 'MCP_INVALID_REQUEST'),
      })
      return
    }

    let request
    try {
      request = parseJsonRpcRequest(payload)
    } catch (error) {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: payload?.id ?? null,
        error: toJsonRpcMappedError(error),
      })
      return
    }

    const isNotification = typeof request.id === 'undefined' || request.id === null

    try {
      const result = await handleRequest(request)
      if (!isNotification) {
        writeJsonRpc({
          jsonrpc: '2.0',
          id: request.id,
          result: result ?? {},
        })
      }
    } catch (error) {
      if (isNotification) return
      writeJsonRpc({
        jsonrpc: '2.0',
        id: request.id,
        error: toJsonRpcMappedError(error),
      })
    }
  })
}

startServer()
