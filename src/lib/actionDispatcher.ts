import { ensureRootPath } from '@/lib/reveal'
import { callGatewayHttp, callGatewayTool, type ToolCallResult } from '@/lib/gateway'
import {
  moveRuntimePathToRootTrash,
  restoreRuntimePathFromRootTrash,
  type RuntimeRootTrashResponse,
} from '@/lib/runtimeApi'

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

type RuntimeRootTrashOperation = 'move' | 'restore'

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

function normalizeRootRelativePath(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

function normalizeAbsolutePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized) return ''
  if (normalized === '/' || /^[a-zA-Z]:\/$/.test(normalized)) {
    return normalized
  }
  return normalized.replace(/\/+$/, '')
}

function toRelativePathWithinRoot(rootPath: string, absolutePath: string): string | null {
  const normalizedRootPath = normalizeAbsolutePath(rootPath)
  const normalizedAbsolutePath = normalizeAbsolutePath(absolutePath)
  if (!normalizedRootPath || !normalizedAbsolutePath) {
    return null
  }
  if (normalizedAbsolutePath === normalizedRootPath) {
    return ''
  }
  const prefix = `${normalizedRootPath}/`
  if (!normalizedAbsolutePath.startsWith(prefix)) {
    return null
  }
  return normalizeRootRelativePath(normalizedAbsolutePath.slice(prefix.length))
}

function compactRootRelativePaths(paths: string[]): string[] {
  let compacted: string[] = []

  for (const pathItem of paths) {
    if (compacted.includes(pathItem)) continue
    if (compacted.some((existing) => pathItem === existing || pathItem.startsWith(`${existing}/`))) continue

    compacted = compacted.filter((existing) => !(existing === pathItem || existing.startsWith(`${pathItem}/`)))
    compacted.push(pathItem)
  }

  return compacted
}

function readRootRelativePaths(args: Record<string, unknown>): string[] | null {
  const hasRelativePath = Object.prototype.hasOwnProperty.call(args, 'relativePath')
  const hasRelativePaths = Object.prototype.hasOwnProperty.call(args, 'relativePaths')
  if (hasRelativePath && hasRelativePaths) {
    return null
  }

  if (hasRelativePath && typeof args.relativePath === 'string') {
    const normalized = normalizeRootRelativePath(args.relativePath)
    return normalized ? [normalized] : null
  }

  if (hasRelativePaths && isStringArray(args.relativePaths)) {
    const normalizedPaths = args.relativePaths
      .map((item) => normalizeRootRelativePath(item))
      .filter((item) => item)
    return normalizedPaths.length > 0 ? compactRootRelativePaths(normalizedPaths) : null
  }

  return null
}

function readMoveRootRelativePaths(args: Record<string, unknown>, rootPath: string): string[] | null {
  const relativePaths = readRootRelativePaths(args)
  if (relativePaths) {
    return relativePaths
  }

  if (!isStringArray(args.absolutePaths)) {
    return null
  }

  const paths = args.absolutePaths
    .map((absolutePath) => toRelativePathWithinRoot(rootPath, absolutePath))
    .filter((item): item is string => Boolean(item))
  if (paths.length !== args.absolutePaths.length) {
    return null
  }

  return compactRootRelativePaths(paths)
}

function readRestoreRootRelativePaths(args: Record<string, unknown>, rootPath: string): string[] | null {
  const relativePaths = readRootRelativePaths(args)
  if (relativePaths) {
    return relativePaths
  }

  if (!isObjectArray(args.items)) {
    return null
  }

  const paths: string[] = []
  for (const item of args.items) {
    if (item.sourceType !== 'root_trash') {
      return null
    }
    const absolutePath = typeof item.absolutePath === 'string' ? item.absolutePath.trim() : ''
    if (!absolutePath) {
      return null
    }
    const relativePath = toRelativePathWithinRoot(rootPath, absolutePath)
    if (!relativePath || !relativePath.startsWith('.trash/')) {
      return null
    }
    paths.push(relativePath)
  }

  return paths.length > 0 ? compactRootRelativePaths(paths) : null
}

function mapRuntimeFailureReason(operation: RuntimeRootTrashOperation, reason: string | null): string | undefined {
  if (!reason) return undefined

  if (operation === 'restore') {
    if (reason === 'invalid_source') return 'RESTORE_INVALID_SOURCE'
    if (reason === 'source_not_found') return 'RESTORE_SOURCE_NOT_FOUND'
    if (reason === 'unsupported_kind') return 'RESTORE_UNSUPPORTED_KIND'
    if (reason === 'target_exists') return 'RESTORE_TARGET_EXISTS'
    return 'RESTORE_FAILED'
  }

  if (reason === 'invalid_source') return 'SOFT_DELETE_INVALID_SOURCE'
  if (reason === 'source_not_found') return 'SOFT_DELETE_SOURCE_NOT_FOUND'
  if (reason === 'unsupported_kind') return 'SOFT_DELETE_UNSUPPORTED_KIND'
  if (reason === 'target_exists') return 'SOFT_DELETE_TARGET_EXISTS'
  return 'SOFT_DELETE_FAILED'
}

function toRuntimeRootTrashToolResult(
  response: RuntimeRootTrashResponse,
  operation: RuntimeRootTrashOperation,
): ToolCallResult {
  const items = response.items.map((item) => ({
    sourceType: 'root_trash',
    relativePath: item.rootRelativePath,
    nextRelativePath: item.nextRootRelativePath ?? undefined,
    absolutePath: item.absolutePath,
    nextAbsolutePath: item.nextAbsolutePath ?? undefined,
    ok: item.ok,
    skipped: false,
    reasonCode: mapRuntimeFailureReason(operation, item.reason),
    error: item.error ?? undefined,
  }))
  const movedOrRestored = items.filter((item) => item.ok === true && item.skipped !== true).length
  const failed = items.filter((item) => item.ok !== true && item.skipped !== true).length

  return {
    ok: true,
    dryRun: response.dryRun,
    total: items.length,
    ...(operation === 'restore' ? { restored: movedOrRestored } : { moved: movedOrRestored }),
    skipped: 0,
    failed,
    items,
  }
}

async function dispatchRuntimeRootTrash(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<ToolCallResult | null> {
  const rootPath = typeof args.rootPath === 'string' ? args.rootPath.trim() : ''
  if (!rootPath) {
    return null
  }

  if (toolName === 'fs.softDelete') {
    const rootRelativePaths = readMoveRootRelativePaths(args, rootPath)
    if (!rootRelativePaths) {
      return null
    }
    const response = await moveRuntimePathToRootTrash({
      rootPath,
      rootRelativePath: rootRelativePaths,
      dryRun: args.confirm === false,
    }, timeoutMs)
    return toRuntimeRootTrashToolResult(response, 'move')
  }

  if (toolName === 'fs.restore') {
    const rootRelativePaths = readRestoreRootRelativePaths(args, rootPath)
    if (!rootRelativePaths) {
      return null
    }
    const response = await restoreRuntimePathFromRootTrash({
      rootPath,
      rootRelativePath: rootRelativePaths,
      dryRun: args.confirm === false,
    }, timeoutMs)
    return toRuntimeRootTrashToolResult(response, 'restore')
  }

  return null
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
    if (operation === 'detectAssets') {
      return {
        endpointPath: '/v1/faces/detect-assets',
        payload,
        timeoutMs: 600000,
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
    const runtimeRootTrashResult = await dispatchRuntimeRootTrash(toolName, argsPayload, timeoutMs)
    const httpRoute = runtimeRootTrashResult ? null : resolveDispatchHttpRoute(toolName, argsPayload)
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

    const result = runtimeRootTrashResult
      ?? (httpRoute
        ? await callGatewayHttp(
          httpRoute.endpointPath,
          httpRoute.payload,
          typeof timeoutMs === 'number' ? timeoutMs : httpRoute.timeoutMs,
          httpRoute.method
        )
        : await callGatewayTool(toolName, argsPayload, timeoutMs))

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
