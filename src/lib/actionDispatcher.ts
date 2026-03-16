import { ensureRootPath } from '@/lib/reveal'
import { callGatewayTool, type ToolCallResult } from '@/lib/gateway'

export type SystemToolName = string

interface DispatchSystemToolOptions {
  toolName: SystemToolName
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
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

function isLikelyRootPathError(error: { message: string; code?: string }): boolean {
  const normalizedMessage = error.message.toLowerCase()
  const normalizedCode = error.code?.toLowerCase() || ''
  return (
    normalizedMessage.includes('rootpath')
    || normalizedMessage.includes('root path')
    || normalizedCode.includes('rootpath')
    || normalizedCode.includes('root_path')
  )
}

// Dispatch system tools through a single entry to avoid feature components
// coupling to specific gateway transport details.
export async function dispatchSystemTool({
  toolName,
  rootHandle,
  rootId,
  additionalArgs,
}: DispatchSystemToolOptions): Promise<DispatchSystemToolResult> {
  if (!toolName || !rootHandle || !rootId) {
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
    if (isLikelyRootPathError({ message, code })) {
      const rebound = ensureRootPath({
        rootLabel,
        rootId,
        promptIfMissing: true,
        forcePrompt: true,
      })
      return {
        toolName,
        ok: false,
        error: rebound
          ? '检测到 rootPath 可能错误，已重绑路径，请手动重试当前操作'
          : '检测到 rootPath 可能错误，请重绑路径后手动重试当前操作',
        errorCode: 'TOOL_ROOT_PATH_REBIND_REQUIRED',
      }
    }

    return {
      toolName,
      ok: false,
      error: message,
      errorCode: code,
    }
  }
}
