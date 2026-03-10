/* global process */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const MCP_PROTOCOL_VERSION = '2025-11-05'
const TRASH_DIR_NAME = '.trash'

const TOOL_DEFINITIONS = [
  {
    name: 'fs.softDelete',
    description: '软删除（文件/批量）',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        relativePath: { type: 'string' },
        relativePaths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        confirm: { type: 'boolean' },
      },
      required: ['rootPath'],
      additionalProperties: false,
    },
    annotations: {
      title: '软删除',
      mutation: true,
      icon: 'trash-2',
      scopes: ['file', 'workspace'],
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
          label: '执行软删除',
          description: '移动文件到 .trash',
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

function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

function normalizeRelativePath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw toInvalidParamsError('relativePath contains invalid value')
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

function parseConfirm(input) {
  if (typeof input === 'undefined') {
    return true
  }

  if (typeof input !== 'boolean') {
    throw toInvalidParamsError('confirm must be a boolean when provided')
  }

  return input
}

function parseTargets(args) {
  const hasRelativePath = Object.prototype.hasOwnProperty.call(args, 'relativePath')
  const hasRelativePaths = Object.prototype.hasOwnProperty.call(args, 'relativePaths')

  if (hasRelativePath && hasRelativePaths) {
    throw toInvalidParamsError('relativePath and relativePaths are mutually exclusive')
  }

  if (!hasRelativePath && !hasRelativePaths) {
    throw toInvalidParamsError('relativePath or relativePaths is required')
  }

  if (hasRelativePath) {
    return [normalizeRelativePath(args.relativePath)]
  }

  if (!Array.isArray(args.relativePaths) || args.relativePaths.length === 0) {
    throw toInvalidParamsError('relativePaths must be a non-empty string[]')
  }

  return args.relativePaths.map((item) => normalizeRelativePath(item))
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function allocateDedupedTrashPath({ sourceAbsolutePath, candidateAbsolutePath, reservedTargetPaths }) {
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

async function buildSoftDeletePlans({ rootPath, relativePaths }) {
  const plans = []
  const reservedTargetPaths = new Set()

  for (const normalizedRelativePath of relativePaths) {
    try {
      const sourceAbsolutePath = resolvePathWithinRoot(rootPath, normalizedRelativePath)

      let stat
      try {
        stat = await fs.lstat(sourceAbsolutePath)
      } catch {
        plans.push({
          relativePath: normalizedRelativePath,
          ok: false,
          skipped: false,
          reasonCode: 'SOFT_DELETE_SOURCE_NOT_FOUND',
          error: 'source file not found',
        })
        continue
      }

      if (!stat.isFile()) {
        plans.push({
          relativePath: normalizedRelativePath,
          ok: false,
          skipped: false,
          reasonCode: 'SOFT_DELETE_UNSUPPORTED_KIND',
          error: 'only file items are supported',
        })
        continue
      }

      const candidateRelativePath = `${TRASH_DIR_NAME}/${normalizedRelativePath}`
      const candidateAbsolutePath = resolvePathWithinRoot(rootPath, candidateRelativePath)
      const targetAbsolutePath = await allocateDedupedTrashPath({
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
        reasonCode: 'SOFT_DELETE_INVALID_PATH',
        error: error instanceof Error ? error.message : 'invalid path',
      })
    }
  }

  return plans
}

async function runSoftDelete(args) {
  const rootPath = resolveRootPath(args.rootPath)
  const normalizedRootPath = path.resolve(rootPath)
  const relativePaths = parseTargets(args)
  const confirm = parseConfirm(args.confirm)

  const items = await buildSoftDeletePlans({
    rootPath: normalizedRootPath,
    relativePaths,
  })

  if (confirm) {
    for (const item of items) {
      if (!item.ok || item.skipped || !item.sourceAbsolutePath || !item.targetAbsolutePath) {
        continue
      }

      try {
        await fs.mkdir(path.dirname(item.targetAbsolutePath), { recursive: true })

        if (await pathExists(item.targetAbsolutePath)) {
          item.ok = false
          item.skipped = false
          item.reasonCode = 'SOFT_DELETE_TARGET_EXISTS'
          item.error = 'target path already exists'
          continue
        }

        await fs.rename(item.sourceAbsolutePath, item.targetAbsolutePath)
      } catch (error) {
        item.ok = false
        item.skipped = false
        item.reasonCode = 'SOFT_DELETE_SOURCE_NOT_FOUND'
        item.error = error instanceof Error ? error.message : 'soft delete failed'
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

  const moved = responseItems.filter((item) => item.ok && item.skipped !== true).length
  const skipped = responseItems.filter((item) => item.skipped === true).length
  const failed = responseItems.filter((item) => item.ok !== true && item.skipped !== true).length

  return {
    dryRun: !confirm,
    total: responseItems.length,
    moved,
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
      serverInfo: { name: 'fauplay-soft-delete', version: '0.1.0' },
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

    if (toolName === 'fs.softDelete') {
      return runSoftDelete(args || {})
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
