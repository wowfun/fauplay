/* global process */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const MCP_PROTOCOL_VERSION = '2025-11-05'

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
        findText: { type: 'string' },
        replaceText: { type: 'string' },
        prefix: { type: 'string' },
        suffix: { type: 'string' },
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
          key: 'findText',
          label: '查找文本',
          type: 'string',
          defaultValue: '',
          description: '在文件名主体中查找文本（不含扩展名）',
          sendToTool: true,
        },
        {
          key: 'replaceText',
          label: '替换文本',
          type: 'string',
          defaultValue: '',
          description: '替换查找到的文本（需配合查找文本）',
          sendToTool: true,
        },
        {
          key: 'prefix',
          label: '前缀',
          type: 'string',
          defaultValue: '',
          description: '追加到文件名主体前',
          sendToTool: true,
        },
        {
          key: 'suffix',
          label: '后缀',
          type: 'string',
          defaultValue: '',
          description: '追加到文件名主体后',
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

function splitRuleArgs(args) {
  const findText = typeof args.findText === 'string' ? args.findText : ''
  const replaceText = typeof args.replaceText === 'string' ? args.replaceText : ''
  const prefix = typeof args.prefix === 'string' ? args.prefix : ''
  const suffix = typeof args.suffix === 'string' ? args.suffix : ''

  if (findText === '' && prefix === '' && suffix === '') {
    throw toInvalidParamsError('at least one rename rule is required (findText/prefix/suffix)')
  }

  return {
    findText,
    replaceText,
    prefix,
    suffix,
  }
}

function applyRenameRule(fileName, rule) {
  const parsed = path.parse(fileName)
  let nextBase = parsed.name

  if (rule.findText) {
    nextBase = nextBase.split(rule.findText).join(rule.replaceText)
  }

  if (rule.prefix) {
    nextBase = `${rule.prefix}${nextBase}`
  }
  if (rule.suffix) {
    nextBase = `${nextBase}${rule.suffix}`
  }

  if (!nextBase) {
    throw toInvalidParamsError('rename result basename is empty')
  }

  if (nextBase.includes('/') || nextBase.includes('\\')) {
    throw toInvalidParamsError('rename result basename contains path separators')
  }

  return `${nextBase}${parsed.ext}`
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function buildRenamePlans({ rootPath, relativePaths, rule }) {
  const plans = []

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
      const targetFileName = applyRenameRule(sourceFileName, rule)
      const targetAbsolutePath = path.join(path.dirname(sourceAbsolutePath), targetFileName)
      const targetRelativePath = toPosixPath(path.relative(rootPath, targetAbsolutePath))

      if (targetAbsolutePath === sourceAbsolutePath) {
        plans.push({
          relativePath: normalizedRelativePath,
          nextRelativePath: targetRelativePath,
          sourceAbsolutePath,
          targetAbsolutePath,
          ok: true,
          skipped: true,
          reasonCode: 'RENAME_NO_CHANGE',
        })
        continue
      }

      plans.push({
        relativePath: normalizedRelativePath,
        nextRelativePath: targetRelativePath,
        sourceAbsolutePath,
        targetAbsolutePath,
        ok: true,
        skipped: false,
      })
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

  const pendingPlans = plans.filter((plan) => plan.ok && !plan.skipped && plan.targetAbsolutePath)
  const targetCountMap = new Map()
  for (const plan of pendingPlans) {
    const next = (targetCountMap.get(plan.targetAbsolutePath) || 0) + 1
    targetCountMap.set(plan.targetAbsolutePath, next)
  }

  for (const plan of pendingPlans) {
    const sameTargetCount = targetCountMap.get(plan.targetAbsolutePath) || 0
    if (sameTargetCount > 1) {
      plan.ok = false
      plan.skipped = false
      plan.reasonCode = 'RENAME_TARGET_EXISTS'
      plan.error = 'target path conflicts within current batch'
      continue
    }

    const targetExists = await pathExists(plan.targetAbsolutePath)
    if (targetExists) {
      plan.ok = false
      plan.skipped = false
      plan.reasonCode = 'RENAME_TARGET_EXISTS'
      plan.error = 'target path already exists'
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
