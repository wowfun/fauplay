export class RuntimeMcpError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RuntimeMcpError'
    this.code = code
  }
}

export class RuntimeHttpError extends Error {
  code?: string
  status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'RuntimeHttpError'
    this.code = code
    this.status = status
  }
}

export function createRuntimeRequestTimeoutError(timeoutMs: number): RuntimeMcpError {
  const timeoutSec = Math.ceil(timeoutMs / 1000)
  return new RuntimeMcpError(`Runtime API request timed out after ${timeoutSec}s`, 'MCP_CLIENT_TIMEOUT')
}
