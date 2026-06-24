import { callRuntimeHttp, callRuntimePluginTool, type ToolCallResult } from '@/lib/runtimeApi'
import { ensureRootPath, getBoundRootPath } from '@/lib/reveal'
import { resolveDispatchHttpRoute } from '@/lib/actionDispatcher/httpRoutes'
import { dispatchRuntimeSystemTool } from '@/lib/actionDispatcher/runtimeDispatchers'

export type SystemToolName = string

interface DispatchSystemToolOptions {
  toolName: SystemToolName
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
  additionalArgs?: Record<string, unknown>
  timeoutMs?: number
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

// Dispatch system tools through one Web App interface while preferring
// direct Runtime Capabilities before generic Plugin Capability calls.
export async function dispatchSystemTool({
  toolName,
  rootHandle,
  rootId,
  additionalArgs,
  timeoutMs,
}: DispatchSystemToolOptions): Promise<DispatchSystemToolResult> {
  if (!toolName || !rootId) {
    return {
      toolName,
      ok: false,
      skipped: true,
      error: '工具上下文不完整',
      errorCode: 'TOOL_CONTEXT_INVALID',
    }
  }

  const rootLabel = rootHandle?.name || 'current-folder'
  const rootPath = getBoundRootPath(rootId)
    ?? (rootHandle
      ? ensureRootPath({
          rootLabel,
          rootId,
          promptIfMissing: true,
        })
      : null)
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
    const argsPayload: Record<string, unknown> = {
      rootPath,
      ...(additionalArgs ?? {}),
    }
    const runtimeResult = await dispatchRuntimeSystemTool(toolName, argsPayload, timeoutMs)
    const httpRoute = runtimeResult ? null : resolveDispatchHttpRoute(toolName, argsPayload)
    if (!httpRoute && toolName === 'local.data') {
      const operation = typeof argsPayload.operation === 'string' ? argsPayload.operation : ''
      return {
        toolName,
        ok: false,
        error: operation
          ? `local.data.${operation} 不支持或已下线`
          : 'local.data 缺少 operation 参数',
        errorCode: 'TOOL_OPERATION_UNSUPPORTED',
      }
    }

    const result = runtimeResult
      ?? (httpRoute
        ? await callRuntimeHttp(
          httpRoute.endpointPath,
          httpRoute.payload,
          typeof timeoutMs === 'number' ? timeoutMs : httpRoute.timeoutMs,
          httpRoute.method,
        )
        : await callRuntimePluginTool(toolName, argsPayload, timeoutMs))

    return {
      toolName,
      ok: true,
      result,
    }
  } catch (error) {
    const { message, code } = toToolError(error)
    if (isLikelyRootPathError({ message, code })) {
      if (!rootHandle) {
        return {
          toolName,
          ok: false,
          error: '检测到 rootPath 可能错误，请重绑路径后手动重试当前操作',
          errorCode: 'TOOL_ROOT_PATH_REBIND_REQUIRED',
        }
      }
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
