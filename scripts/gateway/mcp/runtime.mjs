import { StdioMcpRunner } from './stdio-runner.mjs'

function createRuntimeError(code, message, statusCode = 400) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function toGatewayTool(sourceLabel, tool) {
  const name = tool?.name
  if (typeof name !== 'string' || !name) {
    throw createRuntimeError(
      'MCP_INVALID_PARAMS',
      `MCP server ${sourceLabel} returned a tool with invalid name`,
      500
    )
  }

  const annotations = tool?.annotations && typeof tool.annotations === 'object' ? tool.annotations : {}
  const scopes = normalizeArray(annotations.scopes).filter((scope) => typeof scope === 'string')
  const normalizedAnnotations = {}
  if (typeof annotations.title === 'string' && annotations.title) {
    normalizedAnnotations.title = annotations.title
  }
  if (typeof annotations.mutation === 'boolean') {
    normalizedAnnotations.mutation = annotations.mutation
  }
  if (scopes.length > 0) {
    normalizedAnnotations.scopes = scopes
  }

  const normalizedTool = {
    name,
    title: typeof tool?.title === 'string' && tool.title
      ? tool.title
      : typeof annotations.title === 'string' && annotations.title
        ? annotations.title
        : name,
    description: typeof tool?.description === 'string' ? tool.description : '',
    inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' },
  }

  if (Object.keys(normalizedAnnotations).length > 0) {
    normalizedTool.annotations = normalizedAnnotations
  }

  return normalizedTool
}

function mapRuntimeError(error) {
  if (error?.code === 'MCP_SERVER_TIMEOUT') {
    return createRuntimeError('MCP_SERVER_TIMEOUT', error.message || 'MCP server request timeout', 504)
  }

  if (error?.code === 'MCP_SERVER_CRASHED') {
    return createRuntimeError('MCP_SERVER_CRASHED', error.message || 'MCP server crashed', 502)
  }

  if (error?.code === 'MCP_TOOL_CALL_FAILED') {
    return createRuntimeError('MCP_TOOL_CALL_FAILED', error.message || 'MCP tool call failed', 400)
  }

  if (error?.code === 'MCP_TOOL_NOT_FOUND') {
    return createRuntimeError('MCP_TOOL_NOT_FOUND', error.message || 'MCP tool not found', 404)
  }

  if (error?.code === 'MCP_INVALID_PARAMS') {
    return createRuntimeError('MCP_INVALID_PARAMS', error.message || 'MCP invalid params', 400)
  }

  return createRuntimeError(
    'MCP_RUNTIME_ERROR',
    error instanceof Error ? error.message : 'MCP runtime error',
    500
  )
}

function createStdioClient(entry, defaults, sourceLabel) {
  if (typeof entry.command !== 'string' || !entry.command) {
    throw createRuntimeError(
      'MCP_RUNTIME_ERROR',
      `Stdio MCP server is missing command: ${sourceLabel}`,
      500
    )
  }

  const runner = new StdioMcpRunner({
    sourceLabel,
    command: entry.command,
    args: entry.args,
    cwd: entry.cwd,
    env: entry.env,
    callTimeoutMs: Number(entry.callTimeoutMs || defaults.callTimeoutMs),
    initTimeoutMs: Number(entry.initTimeoutMs || defaults.initTimeoutMs),
    restartWindowMs: Number(entry.restartWindowMs || defaults.restartWindowMs),
    maxCrashesInWindow: Number(entry.maxCrashesInWindow || defaults.maxCrashesInWindow),
    restartCooldownMs: Number(entry.restartCooldownMs || defaults.restartCooldownMs),
  })

  return {
    listTools() {
      return runner.listTools()
    },
    callTool(name, args) {
      return runner.callTool(name, args)
    },
    shutdown() {
      return runner.shutdown()
    },
  }
}

function resolveSourceLabel(entry, index) {
  if (typeof entry?.sourceLabel === 'string' && entry.sourceLabel) {
    return entry.sourceLabel
  }

  if (typeof entry?.command === 'string' && entry.command) {
    return `stdio:${entry.command}`
  }

  return `stdio:${index}`
}

export class McpHostRuntime {
  constructor(options = {}) {
    this.serverRegistry = normalizeArray(options.serverRegistry)
    this.callTimeoutMs = Number(options.callTimeoutMs || 5000)
    this.initTimeoutMs = Number(options.initTimeoutMs || 2000)
    this.restartWindowMs = Number(options.restartWindowMs || 10000)
    this.maxCrashesInWindow = Number(options.maxCrashesInWindow || 3)
    this.restartCooldownMs = Number(options.restartCooldownMs || 15000)

    this.toolMap = new Map()
    this.tools = []
  }

  async initialize() {
    let index = 0
    for (const entry of this.serverRegistry) {
      if (!entry || typeof entry !== 'object') continue
      const sourceLabel = resolveSourceLabel(entry, index)
      index += 1

      const client = createStdioClient(entry, {
        callTimeoutMs: this.callTimeoutMs,
        initTimeoutMs: this.initTimeoutMs,
        restartWindowMs: this.restartWindowMs,
        maxCrashesInWindow: this.maxCrashesInWindow,
        restartCooldownMs: this.restartCooldownMs,
      }, sourceLabel)

      const tools = normalizeArray(await client.listTools())

      for (const tool of tools) {
        const normalized = toGatewayTool(sourceLabel, tool)
        if (this.toolMap.has(normalized.name)) {
          throw createRuntimeError(
            'MCP_RUNTIME_ERROR',
            `Duplicate tool name: ${normalized.name}`,
            500
          )
        }

        this.toolMap.set(normalized.name, {
          client,
        })
        this.tools.push(normalized)
      }
    }

    this.tools.sort((a, b) => a.name.localeCompare(b.name))
  }

  listTools() {
    return this.tools
  }

  async callTool(toolName, args) {
    if (typeof toolName !== 'string' || !toolName) {
      throw createRuntimeError('MCP_INVALID_PARAMS', 'tool name is required', 400)
    }

    const found = this.toolMap.get(toolName)
    if (!found) {
      throw createRuntimeError('MCP_TOOL_NOT_FOUND', `Unknown tool: ${toolName}`, 404)
    }

    try {
      return await found.client.callTool(toolName, args ?? {})
    } catch (error) {
      throw mapRuntimeError(error)
    }
  }

  async shutdown() {
    const shutdownTasks = []

    const clients = new Set([...this.toolMap.values()].map((entry) => entry.client))
    for (const client of clients) {
      shutdownTasks.push(client.shutdown())
    }

    await Promise.allSettled(shutdownTasks)
  }
}

export function createMcpRuntimeError(code, message, statusCode) {
  return createRuntimeError(code, message, statusCode)
}
