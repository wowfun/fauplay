/* global process */
import readline from 'node:readline'

const MCP_PROTOCOL_VERSION = '2025-11-05'

const TOOL_DEFINITIONS = [
  {
    name: 'data.findDuplicateFiles',
    description: '根据现有 asset/file 索引查询重复文件',
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
        searchScope: {
          type: 'string',
          enum: ['global', 'root'],
        },
      },
      required: ['rootPath'],
      additionalProperties: false,
    },
    annotations: {
      title: '重复文件',
      mutation: false,
      icon: 'copy',
      scopes: ['file', 'workspace'],
      toolOptions: [
        {
          key: 'preview.continuousCall.enabled',
          label: '持续调用',
          type: 'boolean',
          defaultValue: false,
          description: '切换预览文件后自动触发重复文件查重',
        },
        {
          key: 'search.scope',
          label: '查找范围',
          type: 'enum',
          defaultValue: 'global',
          values: [
            { value: 'global', label: '全局' },
            { value: 'root', label: '当前 Root' },
          ],
          sendToTool: true,
          argumentKey: 'searchScope',
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
      serverInfo: { name: 'fauplay-duplicate-files', version: '0.1.0' },
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
    if (toolName !== 'data.findDuplicateFiles') {
      const error = new Error(`Unsupported tool: ${toolName}`)
      error.code = 'MCP_TOOL_NOT_FOUND'
      throw error
    }

    const error = new Error(
      'data.findDuplicateFiles has moved to Gateway HTTP API; use /v1/files/duplicates/query instead',
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
