import { ensureRootPath } from '@/lib/reveal'
import { callGatewayHttp, callGatewayTool, type ToolCallResult } from '@/lib/gateway'

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

interface DispatchHttpRoute {
  method?: 'POST' | 'PUT' | 'PATCH'
  endpointPath: string
  payload: Record<string, unknown>
  timeoutMs?: number
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

function toArgsWithoutOperation(args: Record<string, unknown>): Record<string, unknown> {
  const next = { ...args }
  delete next.operation
  return next
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function resolveDispatchHttpRoute(toolName: string, args: Record<string, unknown>): DispatchHttpRoute | null {
  const operation = typeof args.operation === 'string' ? args.operation : ''
  const payload = toArgsWithoutOperation(args)

  if (toolName === 'local.data') {
    if (operation === 'setAnnotationValue') {
      return {
        method: 'PUT',
        endpointPath: '/v1/file-annotations',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'bindAnnotationTag') {
      return {
        method: 'POST',
        endpointPath: '/v1/file-annotations/tags/bind',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'unbindAnnotationTag') {
      return {
        method: 'POST',
        endpointPath: '/v1/file-annotations/tags/unbind',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'batchRebindPaths') {
      return {
        method: 'PATCH',
        endpointPath: '/v1/files/relative-paths',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'cleanupMissingFiles') {
      return {
        method: 'POST',
        endpointPath: '/v1/files/missing/cleanups',
        payload,
      }
    }
    if (operation === 'ensureFileEntries') {
      return {
        method: 'POST',
        endpointPath: '/v1/files/indexes',
        payload,
        timeoutMs: 120000,
      }
    }
    return null
  }

  if (toolName === 'data.findDuplicateFiles') {
    return {
      method: 'POST',
      endpointPath: '/v1/files/duplicates/query',
      payload,
      timeoutMs: 120000,
    }
  }

  if (toolName === 'vision.face') {
    if (operation === 'detectAsset') {
      return {
        endpointPath: '/v1/faces/detect-asset',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'clusterPending') {
      return {
        endpointPath: '/v1/faces/cluster-pending',
        payload,
      }
    }
    if (operation === 'listPeople') {
      return {
        endpointPath: '/v1/faces/list-people',
        payload,
      }
    }
    if (operation === 'renamePerson') {
      return {
        endpointPath: '/v1/faces/rename-person',
        payload,
      }
    }
    if (operation === 'mergePeople') {
      return {
        endpointPath: '/v1/faces/merge-people',
        payload,
      }
    }
    if (operation === 'listAssetFaces') {
      return {
        endpointPath: '/v1/faces/list-asset-faces',
        payload,
      }
    }
    if (operation === 'listReviewFaces') {
      return {
        endpointPath: '/v1/faces/list-review-faces',
        payload,
      }
    }
    if (operation === 'suggestPeople') {
      return {
        endpointPath: '/v1/faces/suggest-people',
        payload,
      }
    }
    if (operation === 'assignFaces') {
      return {
        endpointPath: '/v1/faces/assign-faces',
        payload,
      }
    }
    if (operation === 'createPersonFromFaces') {
      return {
        endpointPath: '/v1/faces/create-person-from-faces',
        payload,
      }
    }
    if (operation === 'unassignFaces') {
      return {
        endpointPath: '/v1/faces/unassign-faces',
        payload,
      }
    }
    if (operation === 'ignoreFaces') {
      return {
        endpointPath: '/v1/faces/ignore-faces',
        payload,
      }
    }
    if (operation === 'restoreIgnoredFaces') {
      return {
        endpointPath: '/v1/faces/restore-ignored-faces',
        payload,
      }
    }
    if (operation === 'requeueFaces') {
      return {
        endpointPath: '/v1/faces/requeue-faces',
        payload,
      }
    }
    return null
  }

  if (toolName === 'data.tags') {
    if (operation === 'listFileTags') {
      return {
        endpointPath: '/v1/data/tags/file',
        payload,
      }
    }
    if (operation === 'listTagOptions') {
      return {
        endpointPath: '/v1/data/tags/options',
        payload,
      }
    }
    if (operation === 'queryFiles') {
      return {
        endpointPath: '/v1/data/tags/query',
        payload,
      }
    }
    return null
  }

  if (toolName === 'fs.softDelete' && isStringArray(args.absolutePaths)) {
    return {
      method: 'POST',
      endpointPath: '/v1/recycle/items/move',
      payload: {
        absolutePaths: args.absolutePaths,
        ...(typeof args.reason === 'string' && args.reason.trim() ? { reason: args.reason.trim() } : {}),
      },
      timeoutMs: 120000,
    }
  }

  if (toolName === 'fs.restore' && isObjectArray(args.items)) {
    return {
      method: 'POST',
      endpointPath: '/v1/recycle/items/restore',
      payload: {
        items: args.items,
      },
      timeoutMs: 120000,
    }
  }

  return null
}

// Dispatch system tools through a single entry to avoid feature components
// coupling to specific gateway transport details.
export async function dispatchSystemTool({
  toolName,
  rootHandle,
  rootId,
  additionalArgs,
  timeoutMs,
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
    const argsPayload: Record<string, unknown> = {
      rootPath,
      ...(additionalArgs ?? {}),
    }
    const httpRoute = resolveDispatchHttpRoute(toolName, argsPayload)
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

    const result = httpRoute
      ? await callGatewayHttp(
        httpRoute.endpointPath,
        httpRoute.payload,
        typeof timeoutMs === 'number' ? timeoutMs : httpRoute.timeoutMs,
        httpRoute.method
      )
      : await callGatewayTool(toolName, argsPayload, timeoutMs)

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
