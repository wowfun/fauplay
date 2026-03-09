/* global process */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const MCP_PROTOCOL_VERSION = '2025-11-05'
const DEFAULT_NAME_MASK = '[N]'
const DEFAULT_SEARCH_MODE = 'plain'
const DEFAULT_REGEX_FLAGS = 'g'
const REGEX_FLAG_OPTIONS = ['g', 'gi', 'gm', 'gim', 'gu', 'giu', 'gs', 'gis']

const TOOL_DEFINITIONS = [
  {
    name: 'fs.batchRename',
    description: '批量重命名（工作区）',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        relativePaths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        nameMask: { type: 'string' },
        findText: { type: 'string' },
        replaceText: { type: 'string' },
        searchMode: {
          type: 'string',
          enum: ['plain', 'regex'],
        },
        regexFlags: {
          type: 'string',
          enum: REGEX_FLAG_OPTIONS,
        },
        counterStart: {
          oneOf: [{ type: 'integer' }, { type: 'string' }],
        },
        counterStep: {
          oneOf: [{ type: 'integer' }, { type: 'string' }],
        },
        counterPad: {
          oneOf: [{ type: 'integer' }, { type: 'string' }],
        },
        confirm: { type: 'boolean' },
      },
      required: ['rootPath', 'relativePaths'],
      additionalProperties: false,
    },
    annotations: {
      title: '批量重命名',
      mutation: true,
      icon: 'replace-all',
      scopes: ['workspace'],
      toolOptions: [
        {
          key: 'nameMask',
          label: '命名掩码',
          type: 'string',
          defaultValue: '[N]',
          description: '支持 [N]/[P]/[G]/[C]，例如 foo[N]bar',
          sendToTool: true,
        },
        {
          key: 'findText',
          label: '查找文本',
          type: 'string',
          defaultValue: '',
          description: '在掩码渲染后的文件名主体中查找',
          sendToTool: true,
        },
        {
          key: 'replaceText',
          label: '替换文本',
          type: 'string',
          defaultValue: '',
          description: '替换查找到的文本，允许为空字符串',
          sendToTool: true,
        },
        {
          key: 'searchMode',
          label: '查找模式',
          type: 'enum',
          defaultValue: 'plain',
          values: [
            { value: 'plain', label: '普通文本' },
            { value: 'regex', label: '正则表达式' },
          ],
          description: '普通文本或正则表达式查找',
          sendToTool: true,
        },
        {
          key: 'regexFlags',
          label: '正则 Flags',
          type: 'enum',
          defaultValue: 'g',
          values: [
            { value: 'g', label: 'g (全局)' },
            { value: 'gi', label: 'gi (全局 + 忽略大小写)' },
            { value: 'gm', label: 'gm (全局 + 多行)' },
            { value: 'gim', label: 'gim (全局 + 忽略大小写 + 多行)' },
            { value: 'gu', label: 'gu (全局 + Unicode)' },
            { value: 'giu', label: 'giu (全局 + 忽略大小写 + Unicode)' },
            { value: 'gs', label: 'gs (全局 + dotAll)' },
            { value: 'gis', label: 'gis (全局 + 忽略大小写 + dotAll)' },
          ],
          description: '仅 searchMode=regex 生效，默认 g',
          sendToTool: true,
        },
        {
          key: 'counterStart',
          label: '计数起始',
          type: 'string',
          defaultValue: '1',
          description: '[C] 起始值（整数，>=1）',
          sendToTool: true,
        },
        {
          key: 'counterStep',
          label: '计数步长',
          type: 'string',
          defaultValue: '1',
          description: '[C] 递增步长（整数，>=1）',
          sendToTool: true,
        },
        {
          key: 'counterPad',
          label: '补零位数',
          type: 'string',
          defaultValue: '0',
          description: '[C] 左侧补零位数（整数，>=0）',
          sendToTool: true,
        },
      ],
      toolActions: [
        {
          key: 'dryRun',
          label: '预演',
          description: '仅预演，不落盘',
          intent: 'primary',
          arguments: { confirm: false },
        },
        {
          key: 'commit',
          label: '执行重命名',
          description: '执行批量重命名',
          intent: 'accent',
          arguments: { confirm: true },
        },
      ],
    },
  },
]

function isWindowsPath(input) {
  return /^[a-zA-Z]:[\\/]/.test(input)
}

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

function toPosixPath(p) {
  return p.split(path.sep).join('/')
}

function normalizeRelativePath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw toInvalidParamsError('relativePaths contains invalid value')
  }

  const normalized = input.replace(/\\/g, '/').split('/').filter(Boolean)
  if (normalized.length === 0) {
    throw toInvalidParamsError('relativePaths contains empty path')
  }

  for (const segment of normalized) {
    if (segment === '..' || segment === '.') {
      throw toInvalidParamsError('relativePaths contains unsafe segments')
    }
    if (segment.includes('\0')) {
      throw toInvalidParamsError('relativePaths contains invalid characters')
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

function hasOwnKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function parsePositiveIntOption(input, optionName, defaultValue) {
  if (typeof input === 'undefined' || input === null) {
    return defaultValue
  }

  const raw = typeof input === 'string' ? input.trim() : input
  if (raw === '') {
    return defaultValue
  }

  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw toInvalidParamsError(`${optionName} must be an integer >= 1`)
  }

  return value
}

function parseNonNegativeIntOption(input, optionName, defaultValue) {
  if (typeof input === 'undefined' || input === null) {
    return defaultValue
  }

  const raw = typeof input === 'string' ? input.trim() : input
  if (raw === '') {
    return defaultValue
  }

  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw toInvalidParamsError(`${optionName} must be an integer >= 0`)
  }

  return value
}

function normalizeRegexFlags(input) {
  const flags = typeof input === 'string' && input.trim() ? input.trim() : DEFAULT_REGEX_FLAGS
  if (!REGEX_FLAG_OPTIONS.includes(flags)) {
    throw toInvalidParamsError(`regexFlags must be one of: ${REGEX_FLAG_OPTIONS.join(', ')}`)
  }

  try {
    // Validate flags syntax and duplicates.
    new RegExp('', flags)
  } catch {
    throw toInvalidParamsError('regexFlags is invalid')
  }

  return flags
}

function splitRuleArgs(args) {
  if (hasOwnKey(args, 'prefix') || hasOwnKey(args, 'suffix')) {
    throw toInvalidParamsError('prefix/suffix are removed; use nameMask with [N] instead')
  }

  let nameMask = DEFAULT_NAME_MASK
  if (typeof args.nameMask !== 'undefined') {
    if (typeof args.nameMask !== 'string' || args.nameMask.length === 0) {
      throw toInvalidParamsError('nameMask must be a non-empty string when provided')
    }
    nameMask = args.nameMask
  }

  const findText = typeof args.findText === 'string' ? args.findText : ''
  const replaceText = typeof args.replaceText === 'string' ? args.replaceText : ''

  let searchMode = DEFAULT_SEARCH_MODE
  if (typeof args.searchMode !== 'undefined') {
    if (args.searchMode !== 'plain' && args.searchMode !== 'regex') {
      throw toInvalidParamsError('searchMode must be one of: plain, regex')
    }
    searchMode = args.searchMode
  }

  const counterStart = parsePositiveIntOption(args.counterStart, 'counterStart', 1)
  const counterStep = parsePositiveIntOption(args.counterStep, 'counterStep', 1)
  const counterPad = parseNonNegativeIntOption(args.counterPad, 'counterPad', 0)

  if (nameMask === DEFAULT_NAME_MASK && findText === '') {
    throw toInvalidParamsError('at least one rename rule is required (nameMask/findText)')
  }

  let searchRegex = null
  let regexFlags = DEFAULT_REGEX_FLAGS
  if (findText !== '' && searchMode === 'regex') {
    regexFlags = normalizeRegexFlags(args.regexFlags)
    try {
      searchRegex = new RegExp(findText, regexFlags)
    } catch {
      throw toInvalidParamsError('findText is not a valid regular expression')
    }
  }

  return {
    nameMask,
    findText,
    replaceText,
    searchMode,
    regexFlags,
    searchRegex,
    counterStart,
    counterStep,
    counterPad,
  }
}

function resolveRootBaseName(rootPath) {
  const base = path.basename(rootPath)
  if (base) return base

  const parsed = path.parse(rootPath)
  return parsed.name || parsed.root || rootPath
}

function formatCounterValue(counterValue, counterPad) {
  const raw = String(counterValue)
  if (counterPad <= 0) return raw
  return raw.padStart(counterPad, '0')
}

function renderNameMask(mask, context) {
  return mask.replace(/\[(N|P|G|C)\]/g, (full, token) => {
    if (token === 'N') return context.N
    if (token === 'P') return context.P
    if (token === 'G') return context.G
    if (token === 'C') return context.C
    return full
  })
}

function applySearchReplace(input, rule) {
  if (rule.findText === '') {
    return input
  }

  if (rule.searchMode === 'plain') {
    return input.split(rule.findText).join(rule.replaceText)
  }

  return input.replace(rule.searchRegex, rule.replaceText)
}

function applyRenameRule({ sourceFileName, normalizedRelativePath, rule, counterValue, rootBaseName }) {
  const sourceParsed = path.parse(sourceFileName)
  const segments = normalizedRelativePath.split('/')

  const context = {
    N: sourceParsed.name,
    P: segments.length >= 2 ? segments[segments.length - 2] : rootBaseName,
    G: segments.length >= 3 ? segments[segments.length - 3] : '',
    C: formatCounterValue(counterValue, rule.counterPad),
  }

  let nextBase = renderNameMask(rule.nameMask, context)
  nextBase = applySearchReplace(nextBase, rule)

  if (!nextBase) {
    throw toInvalidParamsError('rename result basename is empty')
  }

  if (nextBase.includes('/') || nextBase.includes('\\')) {
    throw toInvalidParamsError('rename result basename contains path separators')
  }

  return `${nextBase}${sourceParsed.ext}`
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function allocateDedupedTargetPath({ sourceAbsolutePath, candidateAbsolutePath, reservedTargetPaths }) {
  const parsed = path.parse(candidateAbsolutePath)
  let attemptPath = candidateAbsolutePath
  let suffixIndex = 1

  while (true) {
    if (attemptPath === sourceAbsolutePath) {
      return attemptPath
    }

    if (!reservedTargetPaths.has(attemptPath)) {
      const exists = await pathExists(attemptPath)
      if (!exists) {
        return attemptPath
      }
    }

    attemptPath = path.join(parsed.dir, `${parsed.name} (${suffixIndex})${parsed.ext}`)
    suffixIndex += 1
  }
}

async function buildRenamePlans({ rootPath, relativePaths, rule }) {
  const plans = []
  const reservedTargetPaths = new Set()
  const rootBaseName = resolveRootBaseName(rootPath)
  let counterValue = rule.counterStart

  for (const originalRelativePath of relativePaths) {
    let normalizedRelativePath = originalRelativePath

    try {
      normalizedRelativePath = normalizeRelativePath(originalRelativePath)
      const sourceAbsolutePath = resolvePathWithinRoot(rootPath, normalizedRelativePath)

      let stat
      try {
        stat = await fs.lstat(sourceAbsolutePath)
      } catch {
        plans.push({
          relativePath: normalizedRelativePath,
          ok: false,
          skipped: false,
          reasonCode: 'RENAME_SOURCE_NOT_FOUND',
          error: 'source file not found',
        })
        continue
      }

      if (!stat.isFile()) {
        plans.push({
          relativePath: normalizedRelativePath,
          ok: false,
          skipped: false,
          reasonCode: 'RENAME_UNSUPPORTED_KIND',
          error: 'only file items are supported',
        })
        continue
      }

      const sourceFileName = path.basename(sourceAbsolutePath)
      const targetFileName = applyRenameRule({
        sourceFileName,
        normalizedRelativePath,
        rule,
        counterValue,
        rootBaseName,
      })
      counterValue += rule.counterStep

      const candidateAbsolutePath = path.join(path.dirname(sourceAbsolutePath), targetFileName)
      const candidateRelativePath = toPosixPath(path.relative(rootPath, candidateAbsolutePath))

      if (candidateAbsolutePath === sourceAbsolutePath) {
        plans.push({
          relativePath: normalizedRelativePath,
          nextRelativePath: candidateRelativePath,
          sourceAbsolutePath,
          targetAbsolutePath: sourceAbsolutePath,
          ok: true,
          skipped: true,
          reasonCode: 'RENAME_NO_CHANGE',
        })
        reservedTargetPaths.add(sourceAbsolutePath)
        continue
      }

      const targetAbsolutePath = await allocateDedupedTargetPath({
        sourceAbsolutePath,
        candidateAbsolutePath,
        reservedTargetPaths,
      })
      const targetRelativePath = toPosixPath(path.relative(rootPath, targetAbsolutePath))

      plans.push({
        relativePath: normalizedRelativePath,
        nextRelativePath: targetRelativePath,
        sourceAbsolutePath,
        targetAbsolutePath,
        ok: true,
        skipped: false,
      })
      reservedTargetPaths.add(targetAbsolutePath)
    } catch (error) {
      plans.push({
        relativePath: normalizedRelativePath,
        ok: false,
        skipped: false,
        reasonCode: 'RENAME_INVALID_PATH',
        error: error instanceof Error ? error.message : 'invalid path',
      })
    }
  }

  return plans
}

async function runBatchRename(args) {
  const rootPath = resolveRootPath(args.rootPath)
  const normalizedRootPath = path.resolve(rootPath)

  if (!Array.isArray(args.relativePaths) || args.relativePaths.length === 0) {
    throw toInvalidParamsError('relativePaths must be a non-empty string[]')
  }

  const relativePaths = args.relativePaths.map((item) => {
    if (typeof item !== 'string') {
      throw toInvalidParamsError('relativePaths must be a non-empty string[]')
    }
    return item
  })

  const confirm = args.confirm === true
  if (typeof args.confirm !== 'undefined' && typeof args.confirm !== 'boolean') {
    throw toInvalidParamsError('confirm must be a boolean when provided')
  }

  const rule = splitRuleArgs(args)
  const items = await buildRenamePlans({
    rootPath: normalizedRootPath,
    relativePaths,
    rule,
  })

  if (confirm) {
    for (const item of items) {
      if (!item.ok || item.skipped || !item.sourceAbsolutePath || !item.targetAbsolutePath) {
        continue
      }

      try {
        if (await pathExists(item.targetAbsolutePath)) {
          item.ok = false
          item.skipped = false
          item.reasonCode = 'RENAME_TARGET_EXISTS'
          item.error = 'target path already exists'
          continue
        }

        await fs.rename(item.sourceAbsolutePath, item.targetAbsolutePath)
      } catch (error) {
        item.ok = false
        item.skipped = false
        item.reasonCode = 'RENAME_SOURCE_NOT_FOUND'
        item.error = error instanceof Error ? error.message : 'rename failed'
      }
    }
  }

  const responseItems = items.map((item) => ({
    relativePath: item.relativePath,
    nextRelativePath: item.nextRelativePath,
    ok: item.ok,
    skipped: item.skipped,
    reasonCode: item.reasonCode,
    error: item.error,
  }))

  const renamed = responseItems.filter((item) => item.ok && item.skipped !== true).length
  const skipped = responseItems.filter((item) => item.skipped === true).length
  const failed = responseItems.filter((item) => item.ok !== true && item.skipped !== true).length

  return {
    dryRun: !confirm,
    total: responseItems.length,
    renamed,
    skipped,
    failed,
    items: responseItems,
  }
}

async function handleRequest(request) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'fauplay-batch-rename', version: '0.1.0' },
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

    if (toolName === 'fs.batchRename') {
      return runBatchRename(args || {})
    }

    const error = new Error(`Unsupported tool: ${toolName}`)
    error.code = 'MCP_TOOL_NOT_FOUND'
    throw error
  }

  const error = new Error(`Unsupported MCP method: ${request.method}`)
  error.code = 'MCP_METHOD_NOT_FOUND'
  throw error
}

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

    const result = await handleRequest(request)
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
