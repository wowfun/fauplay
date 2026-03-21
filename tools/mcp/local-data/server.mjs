/* global process */
import readline from 'node:readline'

const MCP_PROTOCOL_VERSION = '2025-11-05'

const TOOL_DEFINITIONS = [
  {
    name: 'local.data',
    description: '本地数据管理：标注写入、file 重绑与失效清理',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        operation: {
          type: 'string',
          enum: ['setAnnotationValue', 'batchRebindPaths', 'reconcileFileBindings', 'cleanupInvalidFileIds'],
        },
        relativePath: { type: 'string' },
        mappings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fromRelativePath: { type: 'string' },
              toRelativePath: { type: 'string' },
            },
            required: ['fromRelativePath', 'toRelativePath'],
            additionalProperties: false,
          },
        },
        fieldKey: { type: 'string' },
        value: { type: 'string' },
        source: {
          type: 'string',
          enum: ['hotkey', 'click'],
        },
        confirm: { type: 'boolean' },
      },
      required: ['rootPath', 'operation'],
      additionalProperties: false,
    },
    annotations: {
      title: '本地数据',
      mutation: true,
      icon: 'database',
      scopes: ['file', 'workspace'],
      toolActions: [
        {
          key: 'reconcileFileBindings',
          label: '刷新 file 绑定',
          description: '扫描 file 表并执行自动重绑',
          intent: 'primary',
          arguments: { operation: 'reconcileFileBindings' },
        },
        {
          key: 'cleanupInvalidFileIdsDryRun',
          label: '预演清理失效 fileId',
          description: '仅统计，不执行删除',
          intent: 'outline',
          arguments: { operation: 'cleanupInvalidFileIds', confirm: false },
        },
        {
          key: 'cleanupInvalidFileIdsCommit',
          label: '执行清理失效 fileId',
          description: '删除失效 file 行并级联清理',
          intent: 'accent',
          arguments: { operation: 'cleanupInvalidFileIds', confirm: true },
        },
      ],
    },
  },
]

function createJsonRpcError(code, message, dataCode) {
  const error = { code, message }
  if (dataCode) {
    error.data = { code: dataCode }
  }
  return error
}

function toJsonRpcError(error) {
  if (error?.code === 'MCP_INVALID_REQUEST') {
    return createJsonRpcError(-32600, error.message || 'Invalid Request', 'MCP_INVALID_REQUEST')
  }
  if (error?.code === 'MCP_METHOD_NOT_FOUND') {
    return createJsonRpcError(-32601, error.message || 'Method not found', 'MCP_METHOD_NOT_FOUND')
  }
  if (error?.code === 'MCP_INVALID_PARAMS') {
    return createJsonRpcError(-32602, error.message || 'Invalid params', 'MCP_INVALID_PARAMS')
  }
  if (error?.code === 'MCP_TOOL_NOT_FOUND') {
    return createJsonRpcError(-32601, error.message || 'Tool not found', 'MCP_TOOL_NOT_FOUND')
  }

  return createJsonRpcError(
    -32000,
    error instanceof Error ? error.message : 'Server error',
    error?.code || 'MCP_TOOL_CALL_FAILED',
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

async function handleRequest(request) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'fauplay-local-data', version: '0.1.0' },
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
      const error = new Error('params.name is required for tools/call')
      error.code = 'MCP_INVALID_PARAMS'
      throw error
    }
    if (args !== undefined && (typeof args !== 'object' || Array.isArray(args))) {
      const error = new Error('params.arguments must be an object')
      error.code = 'MCP_INVALID_PARAMS'
      throw error
    }
    if (toolName !== 'local.data') {
      const error = new Error(`Unsupported tool: ${toolName}`)
      error.code = 'MCP_TOOL_NOT_FOUND'
      throw error
    }

    const operation = typeof args?.operation === 'string' ? args.operation : ''
    const error = new Error(
      operation
        ? `operation '${operation}' has moved to Gateway HTTP API; use /v1/file-annotations, /v1/files/relative-paths, /v1/file-bindings/* instead`
        : 'local.data operation is required',
    )
    error.code = 'MCP_TOOL_CALL_FAILED'
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
    if (!isNotification) {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: requestId,
        result,
      })
    }
  } catch (error) {
    if (!isNotification) {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: requestId,
        error: toJsonRpcError(error),
      })
    }
  }
})
