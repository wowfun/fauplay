/* global process */
import { execFile, execFileSync, spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { TextDecoder } from 'node:util'

const MCP_PROTOCOL_VERSION = '2025-11-05'
const SERVER_NAME = 'fauplay-video-same-duration'
const SERVER_VERSION = '0.1.0'
const DEFAULT_INSTANCE_NAME = '1.5a'
const DEFAULT_TOLERANCE_MS = 500
const DEFAULT_MAX_RESULTS = 200
const MIN_MAX_RESULTS = 1
const MAX_MAX_RESULTS = 5000
const MAX_TOLERANCE_MS = 60 * 60 * 1000
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg', 'ts'])
const TABLE_COLUMNS = ['duration', 'size', 'path', 'openAction']

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, 'config.json')
const LOCAL_CONFIG_PATH = path.resolve(__dirname, 'config.local.json')

const TOOL_DEFINITIONS = [
  {
    name: 'media.searchSameDurationVideos',
    description: '搜索与当前视频相同时长的视频',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        relativePath: { type: 'string' },
        operation: {
          type: 'string',
          enum: ['search', 'openPath', 'openEverything'],
        },
        searchScope: {
          type: 'string',
          enum: ['global', 'root'],
        },
        absolutePath: { type: 'string' },
      },
      required: ['rootPath'],
      additionalProperties: false,
    },
    annotations: {
      title: '相同时长视频',
      mutation: false,
      icon: 'clock-3',
      scopes: ['file'],
      toolOptions: [
        {
          key: 'preview.continuousCall.enabled',
          label: '持续调用',
          type: 'boolean',
          defaultValue: false,
          description: '切换预览文件后自动触发相同时长搜索',
        },
        {
          key: 'search.scope',
          label: '搜索范围',
          type: 'enum',
          defaultValue: 'global',
          values: [
            { value: 'global', label: '全局' },
            { value: 'root', label: '当前根目录' },
          ],
          description: '全局或当前根目录',
          sendToTool: true,
          argumentKey: 'searchScope',
        },
      ],
      toolActions: [
        {
          key: 'openEverything',
          label: 'Everything 搜索',
          description: '使用 Everything 打开等价搜索',
          intent: 'primary',
          arguments: { operation: 'openEverything' },
        },
      ],
    },
  },
]

function isWindowsPath(input) {
  return typeof input === 'string' && /^[a-zA-Z]:[\\/]/.test(input)
}

function toInvalidParamsError(message) {
  const error = new Error(message)
  error.code = 'MCP_INVALID_PARAMS'
  return error
}

function toToolCallError(message) {
  const error = new Error(message)
  error.code = 'MCP_TOOL_CALL_FAILED'
  return error
}

function toJsonRpcError(code, message, dataCode) {
  const error = { code, message }
  if (dataCode) {
    error.data = { code: dataCode }
  }
  return error
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
    error?.code || 'MCP_TOOL_CALL_FAILED'
  )
}

function writeJsonRpc(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
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

async function readJsonFileSafe(filePath, required) {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch (error) {
    if (!required && error && typeof error === 'object' && error.code === 'ENOENT') {
      return {}
    }
    throw toToolCallError(`Failed to load config: ${filePath}`)
  }
}

function asConfigObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }
  return input
}

function clampInt(value, min, max, defaultValue) {
  if (!Number.isInteger(value)) return defaultValue
  return Math.min(Math.max(value, min), max)
}

async function loadConfig() {
  const baseConfig = asConfigObject(await readJsonFileSafe(DEFAULT_CONFIG_PATH, true))
  const localConfig = asConfigObject(await readJsonFileSafe(LOCAL_CONFIG_PATH, false))
  const merged = { ...baseConfig, ...localConfig }

  if (typeof merged.esPath !== 'string' || !merged.esPath.trim()) {
    throw toToolCallError('config.esPath is required')
  }
  if (typeof merged.everythingPath !== 'string' || !merged.everythingPath.trim()) {
    throw toToolCallError('config.everythingPath is required')
  }

  return {
    esPath: merged.esPath.trim(),
    everythingPath: merged.everythingPath.trim(),
    instanceName: typeof merged.instanceName === 'string' && merged.instanceName.trim()
      ? merged.instanceName.trim()
      : DEFAULT_INSTANCE_NAME,
    toleranceMs: clampInt(
      Number(merged.toleranceMs),
      0,
      MAX_TOLERANCE_MS,
      DEFAULT_TOLERANCE_MS
    ),
    maxResults: clampInt(
      Number(merged.maxResults),
      MIN_MAX_RESULTS,
      MAX_MAX_RESULTS,
      DEFAULT_MAX_RESULTS
    ),
  }
}

function normalizeRelativePath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw toInvalidParamsError('relativePath is required')
  }

  const normalized = input.replace(/\\/g, '/').split('/').filter(Boolean)
  if (normalized.length === 0) {
    throw toInvalidParamsError('relativePath contains empty path')
  }

  for (const segment of normalized) {
    if (segment === '..' || segment === '.') {
      throw toInvalidParamsError('relativePath contains unsafe segments')
    }
    if (segment.includes('\0')) {
      throw toInvalidParamsError('relativePath contains invalid characters')
    }
  }

  return normalized.join('/')
}

function resolveRootPath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw toInvalidParamsError('rootPath is required')
  }

  const raw = input.trim()
  if (!path.isAbsolute(raw) && !isWindowsPath(raw)) {
    throw toInvalidParamsError('rootPath must be an absolute path')
  }

  if (isWindowsPath(raw) && process.platform !== 'win32') {
    try {
      return execFileSync('wslpath', ['-u', raw], { encoding: 'utf8' }).trim()
    } catch {
      throw toInvalidParamsError('rootPath windows path cannot be resolved in current runtime')
    }
  }

  return raw
}

function resolvePathWithinRoot(rootPath, relativePath) {
  const target = path.resolve(rootPath, ...relativePath.split('/'))
  const relative = path.relative(rootPath, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw toInvalidParamsError('relativePath escapes rootPath')
  }
  return target
}

function hasVideoExtension(relativePath) {
  const ext = path.extname(relativePath).slice(1).toLowerCase()
  return VIDEO_EXTENSIONS.has(ext)
}

async function toWindowsPath(targetPath) {
  if (isWindowsPath(targetPath)) return targetPath

  const { stdout } = await execFileAsync('wslpath', ['-w', targetPath])
  return stdout.trim()
}

function normalizeSearchScope(input) {
  if (typeof input === 'undefined') return 'global'
  if (input === 'global' || input === 'root') return input
  throw toInvalidParamsError('searchScope must be one of: global, root')
}

function normalizeOperation(input) {
  if (typeof input === 'undefined') return 'search'
  if (input === 'search' || input === 'openPath' || input === 'openEverything') {
    return input
  }
  throw toInvalidParamsError('operation must be one of: search, openPath, openEverything')
}

async function launchDetached(command, args, fallbackMessage) {
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'ignore',
        detached: true,
      })

      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve(undefined)
      })
    })
  } catch (error) {
    const message = `${error?.message || ''}\n${error?.stderr || ''}`
    const interopLikelyDisabled =
      message.includes('MZ') ||
      message.includes('No such device') ||
      message.includes('Syntax error: newline unexpected')

    if (interopLikelyDisabled) {
      throw toToolCallError(
        'WSL Windows interop seems disabled. Enable it in /etc/wsl.conf: [interop] enabled=true, then run "wsl --shutdown" from Windows and reopen WSL.'
      )
    }

    throw toToolCallError(message || fallbackMessage)
  }
}

function formatDurationToken(totalSeconds) {
  const normalized = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const seconds = normalized % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDurationLabel(totalSeconds) {
  const normalized = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const seconds = normalized % 60
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function buildLengthTerms(targetDurationMs, toleranceMs) {
  const lowerSeconds = Math.max(0, Math.floor((targetDurationMs - toleranceMs) / 1000))
  const upperSeconds = Math.max(0, Math.floor((targetDurationMs + toleranceMs) / 1000))
  if (lowerSeconds === upperSeconds) {
    return [`length:${formatDurationToken(lowerSeconds)}`]
  }

  return [
    `length:>=${formatDurationToken(lowerSeconds)}`,
    `length:<=${formatDurationToken(upperSeconds)}`,
  ]
}

function buildEverythingSearchText({ searchScope, rootWindowsPath, lengthTerms }) {
  const parts = []
  if (searchScope === 'root') {
    parts.push(`"${rootWindowsPath}"`)
  }
  parts.push('video:')
  parts.push(...lengthTerms)
  return parts.join(' ')
}

async function toUnixPath(targetPath) {
  if (!isWindowsPath(targetPath)) return targetPath
  const { stdout } = await execFileAsync('wslpath', ['-u', targetPath])
  return stdout.trim()
}

async function probeVideoDurationMs(rawPath) {
  try {
    const absolutePath = await toUnixPath(rawPath)
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      absolutePath,
    ])
    const durationFloat = Number(stdout.trim())
    if (!Number.isFinite(durationFloat) || durationFloat < 0) {
      throw new Error('invalid ffprobe duration')
    }
    return Math.max(0, Math.round(durationFloat * 1000))
  } catch (error) {
    throw toToolCallError(`Failed to probe video duration: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}

function parseEsRows(stdout, { targetWindowsPath }) {
  const rows = []
  const normalizedTarget = targetWindowsPath.toLowerCase()
  const lines = stdout.split(/\r?\n/)

  for (const line of lines) {
    if (!line.trim()) continue
    const match = line.match(/^\s*([0-9:]+)\s+([0-9,]+)\s+"(.+)"\s*$/)
    if (!match) continue

    const duration = match[1]
    const size = match[2]
    const absolutePath = match[3]
    if (!absolutePath) continue
    if (absolutePath.toLowerCase() === normalizedTarget) continue

    rows.push({
      duration,
      size,
      path: absolutePath,
    })
  }

  return rows
}

async function filterRowsByDurationTolerance(rows, params) {
  const { targetDurationMs, toleranceMs, maxResults } = params
  const filteredRows = []

  for (const row of rows) {
    let candidateDurationMs = 0
    try {
      candidateDurationMs = await probeVideoDurationMs(row.path)
    } catch {
      continue
    }
    if (Math.abs(candidateDurationMs - targetDurationMs) > toleranceMs) continue

    filteredRows.push({
      ...row,
      openAction: {
        type: 'tool-call',
        label: '打开',
        execution: 'silent',
        arguments: {
          operation: 'openPath',
          absolutePath: row.path,
        },
      },
    })

    if (filteredRows.length >= maxResults) {
      break
    }
  }

  return filteredRows
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

async function runEsSearch({
  config,
  searchScope,
  rootWindowsPath,
  targetWindowsPath,
  lengthTerms,
  targetDurationMs,
}) {
  const args = []
  if (config.instanceName) {
    args.push('-instance', config.instanceName)
  }
  if (searchScope === 'root') {
    args.push('-p', rootWindowsPath)
  }
  args.push('video:')
  args.push(...lengthTerms)
  args.push('-double-quote')
  args.push('-sort', 'size-descending')
  args.push('-n', String(config.maxResults))
  args.push('-length', '-size')

  let result
  try {
    result = await execFileAsync(config.esPath, args, {
      encoding: 'buffer',
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (error) {
    throw toToolCallError(`ES search failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  }

  const stdoutBuffer = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(String(result.stdout || ''), 'utf8')
  const stdoutText = decodeEsOutputBuffer(stdoutBuffer)

  const rows = parseEsRows(stdoutText, {
    targetWindowsPath,
  })

  return filterRowsByDurationTolerance(rows, {
    targetDurationMs,
    toleranceMs: config.toleranceMs,
    maxResults: config.maxResults,
  })
}

async function handleSearch(args, config) {
  const rootPath = resolveRootPath(args.rootPath)
  const relativePath = normalizeRelativePath(args.relativePath)
  const searchScope = normalizeSearchScope(args.searchScope)
  if (!hasVideoExtension(relativePath)) {
    throw toInvalidParamsError('relativePath must point to a video file')
  }

  const absolutePath = resolvePathWithinRoot(rootPath, relativePath)
  const targetDurationMs = await probeVideoDurationMs(absolutePath)
  const targetSeconds = Math.floor(targetDurationMs / 1000)
  const rootWindowsPath = await toWindowsPath(rootPath)
  const targetWindowsPath = await toWindowsPath(absolutePath)
  const lengthTerms = buildLengthTerms(targetDurationMs, config.toleranceMs)
  const rows = await runEsSearch({
    config,
    searchScope,
    rootWindowsPath,
    targetWindowsPath,
    lengthTerms,
    targetDurationMs,
  })

  return {
    ok: true,
    searchScope,
    targetDuration: formatDurationLabel(targetSeconds),
    targetDurationMs,
    toleranceMs: config.toleranceMs,
    resultsTable: {
      columns: TABLE_COLUMNS,
      rows,
    },
    count: rows.length,
    query: {
      terms: ['video:', ...lengthTerms],
    },
  }
}

async function handleOpenPath(args) {
  if (typeof args.absolutePath !== 'string' || !args.absolutePath.trim()) {
    throw toInvalidParamsError('absolutePath is required for openPath operation')
  }
  const windowsPath = await toWindowsPath(args.absolutePath.trim())
  await launchDetached('explorer.exe', [windowsPath], 'Failed to open target path')
  return { ok: true }
}

async function handleOpenEverything(args, config) {
  const rootPath = resolveRootPath(args.rootPath)
  const relativePath = normalizeRelativePath(args.relativePath)
  const searchScope = normalizeSearchScope(args.searchScope)
  if (!hasVideoExtension(relativePath)) {
    throw toInvalidParamsError('relativePath must point to a video file')
  }

  const absolutePath = resolvePathWithinRoot(rootPath, relativePath)
  const targetDurationMs = await probeVideoDurationMs(absolutePath)
  const rootWindowsPath = await toWindowsPath(rootPath)
  const lengthTerms = buildLengthTerms(targetDurationMs, config.toleranceMs)
  const searchText = buildEverythingSearchText({
    searchScope,
    rootWindowsPath,
    lengthTerms,
  })

  await launchDetached(config.everythingPath, ['-sort', 'size-descending', '-s', searchText], 'Failed to launch Everything')

  return {
    ok: true,
    searchScope,
    searchText,
  }
}

async function handleToolCall(args, config) {
  const operation = normalizeOperation(args.operation)
  if (operation === 'search') {
    return handleSearch(args, config)
  }
  if (operation === 'openPath') {
    return handleOpenPath(args)
  }
  if (operation === 'openEverything') {
    return handleOpenEverything(args, config)
  }
  throw toInvalidParamsError('Unsupported operation')
}

async function handleRequest(request, config) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
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

    if (toolName === 'media.searchSameDurationVideos') {
      return handleToolCall(args || {}, config)
    }

    const error = new Error(`Unsupported tool: ${toolName}`)
    error.code = 'MCP_TOOL_NOT_FOUND'
    throw error
  }

  const error = new Error(`Unsupported MCP method: ${request.method}`)
  error.code = 'MCP_METHOD_NOT_FOUND'
  throw error
}

const config = await loadConfig()
const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

rl.on('line', async (line) => {
  let requestId = null
  let isNotification = false

  try {
    const payload = JSON.parse(line)
    const request = parseJsonRpcRequest(payload)
    requestId = request.id ?? null
    isNotification = request.id === undefined

    const result = await handleRequest(request, config)
    if (isNotification) return

    writeJsonRpc({
      jsonrpc: '2.0',
      id: requestId,
      result: result ?? {},
    })
  } catch (error) {
    if (isNotification) return

    if (error instanceof SyntaxError) {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: null,
        error: toJsonRpcError(-32700, 'Parse error', 'MCP_PARSE_ERROR'),
      })
      return
    }

    writeJsonRpc({
      jsonrpc: '2.0',
      id: requestId,
      error: toJsonRpcMappedError(error),
    })
  }
})
