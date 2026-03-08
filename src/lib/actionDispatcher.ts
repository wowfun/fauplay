import { ensureRootPath } from '@/lib/reveal'
import { callGatewayTool, type ToolCallResult } from '@/lib/gateway'

export type SystemToolName = string

interface DispatchSystemToolOptions {
  toolName: SystemToolName
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  additionalArgs?: Record<string, unknown>
}

export interface DispatchSystemToolResult {
  toolName: SystemToolName
  ok: boolean
  skipped?: boolean
  result?: ToolCallResult
  error?: string
  errorCode?: string
}

function toToolError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown }
    const code = typeof errorWithCode.code === 'string'
      ? errorWithCode.code
      : undefined
    return {
      message: error.message || '工具调用失败',
      code,
    }
  }

  return { message: '工具调用失败' }
}

// Dispatch system tools through a single entry to avoid feature components
// coupling to specific gateway transport details.
export async function dispatchSystemTool({
  toolName,
  rootHandle,
  rootId,
  additionalArgs,
}: DispatchSystemToolOptions): Promise<DispatchSystemToolResult> {
  if (!toolName || !rootHandle) {
    return {
      toolName,
      ok: false,
      skipped: true,
      error: '工具上下文不完整',
      errorCode: 'TOOL_CONTEXT_INVALID',
    }
  }

  const rootLabel = rootHandle.name || 'current-folder'
  const rootPath = ensureRootPath({
    rootLabel,
    rootId,
    promptIfMissing: true,
  })
  if (!rootPath) {
    return {
      toolName,
      ok: false,
      skipped: true,
      error: '未设置有效 rootPath',
      errorCode: 'TOOL_CONTEXT_INVALID',
    }
  }

  try {
    const result = await callGatewayTool(toolName, {
      rootPath,
      ...(additionalArgs ?? {}),
    })

    return {
      toolName,
      ok: true,
      result,
    }
  } catch (error) {
    const { message, code } = toToolError(error)
    return {
      toolName,
      ok: false,
      error: message,
      errorCode: code,
    }
  }
}
