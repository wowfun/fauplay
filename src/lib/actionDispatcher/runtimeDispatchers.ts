import {
  callRuntimeHttp,
  findRuntimeDuplicateFiles,
  moveRuntimePathToGlobalTrash,
  moveRuntimePathToRootTrash,
  moveRuntimeRootPathBatch,
  restoreRuntimeGlobalTrash,
  restoreRuntimePathFromRootTrash,
} from '@/lib/runtimeApi'
import type { ToolCallResult } from '@/lib/runtimeApi'
import {
  isStringArray,
  normalizeRootRelativePath,
  readMoveGlobalTrashAbsolutePaths,
  readMoveRootRelativePaths,
  readRestoreGlobalTrashRecycleIds,
  readRestoreRootRelativePaths,
  readRootRelativePaths,
  toArgsWithoutOperation,
} from './pathArgs'
import {
  rebindRuntimeRootMoveBatchPaths,
  toRuntimeDuplicateToolResult,
  toRuntimeGlobalTrashMoveToolResult,
  toRuntimeGlobalTrashToolResult,
  toRuntimeRootMoveBatchToolResult,
  toRuntimeRootTrashToolResult,
} from './runtimeToolResults'

async function dispatchRuntimeDuplicateFiles(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<ToolCallResult | null> {
  if (toolName !== 'data.findDuplicateFiles') {
    return null
  }

  const rootPath = typeof args.rootPath === 'string' ? args.rootPath.trim() : ''
  if (!rootPath) {
    return null
  }
  if (args.searchScope !== 'root') {
    return null
  }

  const rootRelativePaths = readRootRelativePaths(args)
  if (!rootRelativePaths) {
    return null
  }

  try {
    const response = await findRuntimeDuplicateFiles({
      rootPath,
      rootRelativePath: rootRelativePaths,
    }, timeoutMs)
    if (!response.ok) {
      return null
    }
    return toRuntimeDuplicateToolResult(
      response,
      rootPath,
      rootRelativePaths,
      Object.prototype.hasOwnProperty.call(args, 'relativePath') ? 'file' : 'workspace',
    )
  } catch {
    return null
  }
}

async function dispatchRuntimeRootMove(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<ToolCallResult | null> {
  if (toolName !== 'fs.batchRename') {
    return null
  }

  const rootPath = typeof args.rootPath === 'string' ? args.rootPath.trim() : ''
  if (!rootPath) {
    return null
  }

  if (!isStringArray(args.relativePaths) || args.relativePaths.length === 0) {
    return null
  }
  const rootRelativePaths = args.relativePaths
    .map((item) => normalizeRootRelativePath(item))
    .filter((item) => item)
  if (rootRelativePaths.length !== args.relativePaths.length) {
    return null
  }
  const searchMode = args.searchMode === 'regex' ? 'regex' : 'plain'
  const nameMask = typeof args.nameMask === 'string' && args.nameMask.length > 0
    ? args.nameMask
    : '[N]'
  const findText = typeof args.findText === 'string' ? args.findText : ''
  const replaceText = typeof args.replaceText === 'string' ? args.replaceText : ''
  const regexFlags = typeof args.regexFlags === 'string' && args.regexFlags.trim()
    ? args.regexFlags.trim()
    : 'g'

  try {
    const response = await moveRuntimeRootPathBatch({
      rootPath,
      rootRelativePaths,
      nameMask,
      findText,
      replaceText,
      searchMode,
      regexFlags,
      counterStart: typeof args.counterStart === 'number' || typeof args.counterStart === 'string'
        ? args.counterStart
        : 1,
      counterStep: typeof args.counterStep === 'number' || typeof args.counterStep === 'string'
        ? args.counterStep
        : 1,
      counterPad: typeof args.counterPad === 'number' || typeof args.counterPad === 'string'
        ? args.counterPad
        : 0,
      dryRun: args.confirm !== true,
    }, timeoutMs)
    return rebindRuntimeRootMoveBatchPaths(
      rootPath,
      toRuntimeRootMoveBatchToolResult(response),
      timeoutMs,
    )
  } catch {
    return null
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

async function dispatchRuntimeGlobalTrash(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<ToolCallResult | null> {
  if (toolName === 'fs.softDelete') {
    const absolutePaths = readMoveGlobalTrashAbsolutePaths(args)
    if (!absolutePaths) {
      return null
    }

    const response = await moveRuntimePathToGlobalTrash({
      absolutePath: absolutePaths,
      dryRun: args.confirm === false,
    }, timeoutMs)
    return toRuntimeGlobalTrashMoveToolResult(response)
  }

  if (toolName !== 'fs.restore') {
    return null
  }

  const recycleIds = readRestoreGlobalTrashRecycleIds(args)
  if (!recycleIds) {
    return null
  }

  const response = await restoreRuntimeGlobalTrash({
    recycleId: recycleIds,
    dryRun: args.confirm === false,
  }, timeoutMs)
  return toRuntimeGlobalTrashToolResult(response)
}

async function dispatchRuntimeFileAnnotations(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<ToolCallResult | null> {
  const operation = typeof args.operation === 'string' ? args.operation : ''
  const payload = toArgsWithoutOperation(args)

  if (toolName === 'local.data') {
    if (operation === 'setAnnotationValue') {
      return callRuntimeHttp<ToolCallResult>('/v1/file-annotations', payload, timeoutMs, 'PUT')
    }
    if (operation === 'bindAnnotationTag') {
      return callRuntimeHttp<ToolCallResult>('/v1/file-annotations/tags/bind', payload, timeoutMs)
    }
    if (operation === 'unbindAnnotationTag') {
      return callRuntimeHttp<ToolCallResult>('/v1/file-annotations/tags/unbind', payload, timeoutMs)
    }
    if (operation === 'batchRebindPaths') {
      return callRuntimeHttp<ToolCallResult>('/v1/files/relative-paths', payload, timeoutMs, 'PATCH')
    }
    if (operation === 'cleanupMissingFiles') {
      return callRuntimeHttp<ToolCallResult>('/v1/files/missing/cleanups', payload, timeoutMs)
    }
    if (operation === 'ensureFileEntries') {
      return callRuntimeHttp<ToolCallResult>('/v1/files/indexes', payload, timeoutMs)
    }
    return null
  }

  if (toolName === 'data.tags') {
    if (operation === 'listFileTags') {
      return callRuntimeHttp<ToolCallResult>('/v1/data/tags/file', payload, timeoutMs)
    }
    if (operation === 'listTagOptions') {
      return callRuntimeHttp<ToolCallResult>('/v1/data/tags/options', payload, timeoutMs)
    }
    if (operation === 'queryFiles') {
      return callRuntimeHttp<ToolCallResult>('/v1/data/tags/query', payload, timeoutMs)
    }
  }

  return null
}

export async function dispatchRuntimeSystemTool(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<ToolCallResult | null> {
  const runtimeDuplicateFilesResult = await dispatchRuntimeDuplicateFiles(toolName, args, timeoutMs)
  const runtimeRootMoveResult = runtimeDuplicateFilesResult
    ? null
    : await dispatchRuntimeRootMove(toolName, args, timeoutMs)
  const runtimeRootTrashResult = runtimeDuplicateFilesResult || runtimeRootMoveResult
    ? null
    : await dispatchRuntimeRootTrash(toolName, args, timeoutMs)
  const runtimeGlobalTrashResult = runtimeDuplicateFilesResult || runtimeRootMoveResult || runtimeRootTrashResult
    ? null
    : await dispatchRuntimeGlobalTrash(toolName, args, timeoutMs)
  const runtimeFileAnnotationResult = runtimeDuplicateFilesResult || runtimeRootMoveResult || runtimeRootTrashResult || runtimeGlobalTrashResult
    ? null
    : await dispatchRuntimeFileAnnotations(toolName, args, timeoutMs)

  return runtimeDuplicateFilesResult
    ?? runtimeRootMoveResult
    ?? runtimeRootTrashResult
    ?? runtimeGlobalTrashResult
    ?? runtimeFileAnnotationResult
}
