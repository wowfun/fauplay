import { spawn } from 'node:child_process'
import readline from 'node:readline'

function createRunnerError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeRemoteErrorCode(value) {
  if (typeof value !== 'string') return 'MCP_TOOL_CALL_FAILED'
  if (value === 'MCP_TOOL_NOT_FOUND') return value
  if (value === 'MCP_INVALID_PARAMS') return value
  if (value === 'MCP_TOOL_CALL_FAILED') return value
  return 'MCP_TOOL_CALL_FAILED'
}

function pruneCrashHistory(history, now, windowMs) {
  return history.filter((timestamp) => now - timestamp <= windowMs)
}

export class StdioMcpRunner {
  constructor(options) {
    this.sourceLabel =
      typeof options.sourceLabel === 'string' && options.sourceLabel ? options.sourceLabel : 'stdio-server'
    this.command = options.command
    this.args = Array.isArray(options.args) ? options.args : []
    this.cwd = options.cwd
    this.env = options.env

    this.initTimeoutMs = Number(options.initTimeoutMs || 2000)
    this.callTimeoutMs = Number(options.callTimeoutMs || 5000)
    this.restartWindowMs = Number(options.restartWindowMs || 10000)
    this.maxCrashesInWindow = Number(options.maxCrashesInWindow || 3)
    this.restartCooldownMs = Number(options.restartCooldownMs || 15000)

    this.proc = null
    this.readline = null
    this.nextRequestId = 1
    this.pending = new Map()
    this.toolsCache = null
    this.cooldownUntil = 0
    this.crashTimestamps = []
    this.lastStderr = ''
  }

  async listTools() {
    await this.ensureStarted()
    if (Array.isArray(this.toolsCache)) {
      return this.toolsCache
    }

    const result = await this.request('tools/list', {}, this.callTimeoutMs)
    const tools = Array.isArray(result?.tools) ? result.tools : []
    this.toolsCache = tools
    return tools
  }

  async callTool(toolName, args) {
    await this.ensureStarted()
    const result = await this.request(
      'tools/call',
      {
        name: toolName,
        arguments: args ?? {},
      },
      this.callTimeoutMs
    )
    return result
  }

  async shutdown() {
    this.rejectPending('MCP_SERVER_CRASHED', `MCP server exited: ${this.sourceLabel}`)

    if (this.readline) {
      this.readline.close()
      this.readline = null
    }

    if (this.proc) {
      const proc = this.proc
      this.proc = null
      proc.kill('SIGTERM')
    }
  }

  async ensureStarted() {
    if (this.proc && !this.proc.killed) return

    const now = Date.now()
    if (now < this.cooldownUntil) {
      throw createRunnerError(
        'MCP_SERVER_CRASHED',
        `MCP server is in restart cooldown: ${this.sourceLabel}`
      )
    }

    this.startProcess()

    const result = await this.request('tools/list', {}, this.initTimeoutMs)
    this.toolsCache = Array.isArray(result?.tools) ? result.tools : []
  }

  startProcess() {
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env ? { ...process.env, ...this.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.proc = child
    this.toolsCache = null
    this.lastStderr = ''

    this.readline = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    })

    this.readline.on('line', (line) => {
      this.handleStdoutLine(line)
    })

    child.stderr.on('data', (chunk) => {
      const next = `${this.lastStderr}${chunk.toString('utf-8')}`
      this.lastStderr = next.slice(-4000)
    })

    child.once('error', (error) => {
      this.handleProcessExit(error)
    })

    child.once('exit', (code, signal) => {
      const details = `source=${this.sourceLabel} code=${code ?? 'null'} signal=${signal ?? 'null'}`
      this.handleProcessExit(new Error(`MCP server exited (${details})`))
    })
  }

  handleStdoutLine(line) {
    let parsed

    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }

    if (!parsed || typeof parsed !== 'object') return

    if (typeof parsed.id !== 'number') {
      return
    }

    const pending = this.pending.get(parsed.id)
    if (!pending) return

    this.pending.delete(parsed.id)
    clearTimeout(pending.timerId)

    if (parsed.error) {
      const message =
        typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : `MCP server returned an error: ${this.sourceLabel}`
      const remoteCode = normalizeRemoteErrorCode(parsed.error?.data?.code)
      const error = createRunnerError(remoteCode, message)
      pending.reject(error)
      return
    }

    pending.resolve(parsed.result ?? {})
  }

  handleProcessExit(reason) {
    const now = Date.now()
    this.crashTimestamps = pruneCrashHistory(this.crashTimestamps, now, this.restartWindowMs)
    this.crashTimestamps.push(now)

    if (this.crashTimestamps.length >= this.maxCrashesInWindow) {
      this.cooldownUntil = now + this.restartCooldownMs
    } else {
      this.cooldownUntil = now + 1000
    }

    this.rejectPending(
      'MCP_SERVER_CRASHED',
      `MCP server crashed: ${this.sourceLabel}. ${reason?.message || ''}`
    )

    if (this.readline) {
      this.readline.close()
      this.readline = null
    }

    if (this.proc) {
      this.proc.removeAllListeners()
      this.proc = null
    }
  }

  rejectPending(code, message) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timerId)
      pending.reject(createRunnerError(code, message))
      this.pending.delete(id)
    }
  }

  request(method, params, timeoutMs) {
    if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
      throw createRunnerError(
        'MCP_SERVER_CRASHED',
        `MCP server is not running: ${this.sourceLabel}`
      )
    }

    const id = this.nextRequestId++
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params: params ?? {},
    }

    const promise = new Promise((resolve, reject) => {
      const timerId = setTimeout(() => {
        this.pending.delete(id)
        reject(createRunnerError('MCP_SERVER_TIMEOUT', `MCP request timeout: ${method}`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timerId })
    })

    this.proc.stdin.write(`${JSON.stringify(payload)}\n`, 'utf-8')
    return promise
  }
}
