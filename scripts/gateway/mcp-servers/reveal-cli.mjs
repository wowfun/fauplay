import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { promisify } from 'node:util'

const MCP_PROTOCOL_VERSION = '2025-11-05'
const execFileAsync = promisify(execFile)

const TOOL_DEFINITIONS = [
  {
    name: 'system.reveal',
    description: '在文件资源管理器中显示',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        relativePath: { type: 'string' },
      },
      required: ['rootPath', 'relativePath'],
      additionalProperties: false,
    },
    annotations: {
      title: '在文件资源管理器中显示',
      mutation: false,
      scopes: ['file'],
    },
  },
  {
    name: 'system.openDefault',
    description: '用系统默认应用打开',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        relativePath: { type: 'string' },
      },
      required: ['rootPath', 'relativePath'],
      additionalProperties: false,
    },
    annotations: {
      title: '用系统默认应用打开',
      mutation: false,
      scopes: ['file'],
    },
  },
]

function isWindowsPath(input) {
  return /^[a-zA-Z]:[\\/]/.test(input)
}

function hasUnsafeSegment(relativePath) {
  const segments = relativePath.split('/').filter(Boolean)
  return segments.some((segment) => segment === '..')
}

function joinTargetPath(rootPath, relativePath) {
  if (isWindowsPath(rootPath)) {
    const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
    return `${normalizedRoot}\\${relativePath.split('/').join('\\')}`
  }

  return path.resolve(rootPath, ...relativePath.split('/'))
}

async function toWindowsPath(targetPath) {
  if (isWindowsPath(targetPath)) return targetPath
  const { stdout } = await execFileAsync('wslpath', ['-w', targetPath])
  return stdout.trim()
}

async function launchExplorer(args, fallbackMessage) {
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('explorer.exe', args, {
        stdio: 'ignore',
      })

      child.once('error', reject)
      child.once('spawn', resolve)
    })
  } catch (error) {
    const message = `${error?.message || ''}\n${error?.stderr || ''}`
    const interopLikelyDisabled =
      message.includes('MZ') ||
      message.includes('No such device') ||
      message.includes('Syntax error: newline unexpected')

    if (interopLikelyDisabled) {
      throw new Error(
        'WSL Windows interop seems disabled. Enable it in /etc/wsl.conf: [interop] enabled=true, then run "wsl --shutdown" from Windows and reopen WSL.'
      )
    }

    throw new Error(message || fallbackMessage)
  }
}

async function resolveTargetPath(rootPath, relativePath) {
  if (!rootPath || !relativePath) {
    const error = new Error('rootPath and relativePath are required')
    error.code = 'MCP_INVALID_PARAMS'
    throw error
  }

  if (hasUnsafeSegment(relativePath)) {
    const error = new Error('relativePath contains unsafe segments')
    error.code = 'MCP_INVALID_PARAMS'
    throw error
  }

  const targetPath = joinTargetPath(rootPath, relativePath)
  return toWindowsPath(targetPath)
}

async function revealInExplorer(rootPath, relativePath) {
  const windowsPath = await resolveTargetPath(rootPath, relativePath)
  await launchExplorer(['/select,', windowsPath], 'Failed to open explorer')
}

async function openWithSystemDefaultApp(rootPath, relativePath) {
  const windowsPath = await resolveTargetPath(rootPath, relativePath)
  await launchExplorer([windowsPath], 'Failed to open explorer')
}

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

async function handleRequest(request) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'fauplay-reveal-cli', version: '0.2.0' },
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

    const rootPath = args?.rootPath
    const relativePath = args?.relativePath
    if (!rootPath || !relativePath) {
      const error = new Error('rootPath and relativePath are required')
      error.code = 'MCP_INVALID_PARAMS'
      throw error
    }

    if (toolName === 'system.reveal') {
      await revealInExplorer(rootPath, relativePath)
      return { ok: true }
    }

    if (toolName === 'system.openDefault') {
      await openWithSystemDefaultApp(rootPath, relativePath)
      return { ok: true }
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
        error: createJsonRpcError(-32700, 'Parse error', 'MCP_PARSE_ERROR'),
      })
      return
    }

    writeJsonRpc({
      jsonrpc: '2.0',
      id: requestId,
      error: toJsonRpcError(error),
    })
  }
})
