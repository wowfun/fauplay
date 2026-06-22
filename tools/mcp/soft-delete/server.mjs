/* global process, URL, URLSearchParams, fetch */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'

const MCP_PROTOCOL_VERSION = '2025-11-05'
const DEFAULT_RUNTIME_BASE_URL =
  (typeof process.env.FAUPLAY_RUNTIME_BASE_URL === 'string' && process.env.FAUPLAY_RUNTIME_BASE_URL.trim())
  || 'http://127.0.0.1:3211'

const TOOL_DEFINITIONS = [
  {
    name: 'fs.softDelete',
    description: '软删除（文件/目录/批量）',
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
          description: '移动目标项到 .trash',
          intent: 'accent',
          arguments: { confirm: true },
        },
      ],
    },
  },
  {
    name: 'fs.restore',
    description: '回收站还原（单文件/批量）',
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
      title: '还原',
      mutation: true,
      icon: 'undo-2',
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
          label: '执行还原',
          description: '将回收站项还原到原路径',
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

function parseConfirm(input) {
  if (typeof input === 'undefined') {
    return true
  }

  if (typeof input !== 'boolean') {
    throw toInvalidParamsError('confirm must be a boolean when provided')
  }

  return input
}

function isSameOrDescendantPath(candidatePath, ancestorPath) {
  return candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}/`)
}

function compactRelativePathsForBatch(paths) {
  let compacted = []

  for (const pathItem of paths) {
    if (compacted.includes(pathItem)) continue
    if (compacted.some((existing) => isSameOrDescendantPath(pathItem, existing))) continue

    compacted = compacted.filter((existing) => !isSameOrDescendantPath(existing, pathItem))
    compacted.push(pathItem)
  }

  return compacted
}

function parseBatchRelativePaths(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw toInvalidParamsError('relativePaths must be a non-empty string[]')
  }

  return compactRelativePathsForBatch(input.map((item) => normalizeRelativePath(item)))
}

function parseSoftDeleteTargets(args) {
  const hasRelativePath = Object.prototype.hasOwnProperty.call(args, 'relativePath')
  const hasRelativePaths = Object.prototype.hasOwnProperty.call(args, 'relativePaths')

  if (hasRelativePath && hasRelativePaths) {
    throw toInvalidParamsError('relativePath and relativePaths are mutually exclusive')
  }

  if (!hasRelativePath && !hasRelativePaths) {
    throw toInvalidParamsError('relativePath or relativePaths is required')
  }

  if (hasRelativePath) {
    return {
      relativePaths: [normalizeRelativePath(args.relativePath)],
    }
  }

  return {
    relativePaths: parseBatchRelativePaths(args.relativePaths),
  }
}

function parseRestoreTargets(args) {
  const hasRelativePath = Object.prototype.hasOwnProperty.call(args, 'relativePath')
  const hasRelativePaths = Object.prototype.hasOwnProperty.call(args, 'relativePaths')

  if (hasRelativePath && hasRelativePaths) {
    throw toInvalidParamsError('relativePath and relativePaths are mutually exclusive')
  }

  if (!hasRelativePath && !hasRelativePaths) {
    throw toInvalidParamsError('relativePath or relativePaths is required')
  }

  if (hasRelativePath) {
    return {
      relativePaths: [normalizeRelativePath(args.relativePath)],
    }
  }

  return {
    relativePaths: parseBatchRelativePaths(args.relativePaths),
  }
}

function buildRuntimeUrl(endpointPath) {
  return new URL(
    endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`,
    `${DEFAULT_RUNTIME_BASE_URL.replace(/\/+$/, '')}/`
  ).toString()
}

function toRuntimeToolError(message, code = 'MCP_TOOL_CALL_FAILED') {
  const error = new Error(message)
  error.code = code
  return error
}

async function callRootTrashRuntime({ operation, rootPath, relativePaths, dryRun }) {
  const query = new URLSearchParams({ rootPath })
  for (const relativePath of relativePaths) {
    query.append('rootRelativePath', relativePath)
  }
  if (dryRun) {
    query.set('dryRun', 'true')
  }

  let response
  try {
    response = await fetch(buildRuntimeUrl(`/v1/root-trash/${operation}?${query.toString()}`), {
      method: 'POST',
    })
  } catch (error) {
    throw toRuntimeToolError(
      error instanceof Error
        ? `failed to call Fauplay Runtime: ${error.message}`
        : 'failed to call Fauplay Runtime'
    )
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw toRuntimeToolError(
      typeof payload?.error === 'string'
        ? payload.error
        : `Fauplay Runtime request failed: ${response.status}`
    )
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    throw toRuntimeToolError('Fauplay Runtime returned an invalid Root Trash response')
  }

  return payload
}

function mapRuntimeFailureReason(operation, reason) {
  if (operation === 'restore') {
    if (reason === 'invalid_source') return 'RESTORE_INVALID_SOURCE'
    if (reason === 'source_not_found') return 'RESTORE_SOURCE_NOT_FOUND'
    if (reason === 'unsupported_kind') return 'RESTORE_UNSUPPORTED_KIND'
    if (reason === 'target_exists') return 'RESTORE_TARGET_EXISTS'
    if (reason === 'mutation_failed') return 'RESTORE_FAILED'
    return reason ? 'RESTORE_FAILED' : undefined
  }

  if (reason === 'invalid_source') return 'SOFT_DELETE_INVALID_SOURCE'
  if (reason === 'source_not_found') return 'SOFT_DELETE_SOURCE_NOT_FOUND'
  if (reason === 'unsupported_kind') return 'SOFT_DELETE_UNSUPPORTED_KIND'
  if (reason === 'target_exists') return 'SOFT_DELETE_TARGET_EXISTS'
  if (reason === 'mutation_failed') return 'SOFT_DELETE_FAILED'
  return reason ? 'SOFT_DELETE_FAILED' : undefined
}

function toResponseItems(runtimeResponse, operation) {
  return runtimeResponse.items.map((item) => ({
    relativePath: typeof item.rootRelativePath === 'string' ? item.rootRelativePath : undefined,
    nextRelativePath: typeof item.nextRootRelativePath === 'string' ? item.nextRootRelativePath : undefined,
    absolutePath: typeof item.absolutePath === 'string' ? item.absolutePath : undefined,
    nextAbsolutePath: typeof item.nextAbsolutePath === 'string' ? item.nextAbsolutePath : undefined,
    ok: item.ok === true,
    skipped: false,
    reasonCode: typeof item.reason === 'string'
      ? mapRuntimeFailureReason(operation, item.reason)
      : undefined,
    error: typeof item.error === 'string' ? item.error : undefined,
  }))
}

function countOutcomeItems(items) {
  return {
    success: items.filter((item) => item.ok && item.skipped !== true).length,
    skipped: items.filter((item) => item.skipped === true).length,
    failed: items.filter((item) => item.ok !== true && item.skipped !== true).length,
  }
}

async function runSoftDelete(args) {
  const rootPath = resolveRootPath(args.rootPath)
  const normalizedRootPath = path.resolve(rootPath)
  const targetInfo = parseSoftDeleteTargets(args)
  const confirm = parseConfirm(args.confirm)

  const runtimeResponse = await callRootTrashRuntime({
    operation: 'move',
    rootPath: normalizedRootPath,
    relativePaths: targetInfo.relativePaths,
    dryRun: !confirm,
  })

  const responseItems = toResponseItems(runtimeResponse, 'move')
  const counts = countOutcomeItems(responseItems)

  return {
    dryRun: !confirm,
    total: responseItems.length,
    moved: counts.success,
    skipped: counts.skipped,
    failed: counts.failed,
    items: responseItems,
  }
}

async function runRestore(args) {
  const rootPath = resolveRootPath(args.rootPath)
  const normalizedRootPath = path.resolve(rootPath)
  const targetInfo = parseRestoreTargets(args)
  const confirm = parseConfirm(args.confirm)

  const runtimeResponse = await callRootTrashRuntime({
    operation: 'restore',
    rootPath: normalizedRootPath,
    relativePaths: targetInfo.relativePaths,
    dryRun: !confirm,
  })

  const responseItems = toResponseItems(runtimeResponse, 'restore')
  const counts = countOutcomeItems(responseItems)

  return {
    dryRun: !confirm,
    total: responseItems.length,
    restored: counts.success,
    skipped: counts.skipped,
    failed: counts.failed,
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
    if (toolName === 'fs.restore') {
      return runRestore(args || {})
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
