import { getMimeType } from '@/lib/fileSystem'
import { getFilePreviewKind } from '@/lib/filePreview'
import { callRuntimeHttp } from '@/lib/runtimeApi'
import type {
  RuntimeDuplicateFile,
  RuntimeDuplicateFilesResponse,
  RuntimeDuplicateSet,
  RuntimeGlobalTrashMoveResponse,
  RuntimeGlobalTrashRestoreResponse,
  RuntimeRootMoveBatchResponse,
  RuntimeRootTrashResponse,
} from '@/lib/runtimeApi'
import type { ToolCallResult } from '@/lib/gateway'

type RuntimeRootTrashOperation = 'move' | 'restore'

function mapRuntimeFailureReason(operation: RuntimeRootTrashOperation, reason: string | null): string | undefined {
  if (!reason) return undefined

  if (operation === 'restore') {
    if (reason === 'invalid_source') return 'RESTORE_INVALID_SOURCE'
    if (reason === 'recycle_item_not_found') return 'RECYCLE_ITEM_NOT_FOUND'
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

function mapRootMoveFailureReason(reason: string | null): string | undefined {
  if (!reason) return undefined
  if (reason === 'target_exists') return 'RENAME_TARGET_EXISTS'
  if (reason === 'source_not_found') return 'RENAME_SOURCE_NOT_FOUND'
  if (reason === 'invalid_source' || reason === 'invalid_path') return 'RENAME_INVALID_SOURCE'
  if (reason === 'invalid_target') return 'RENAME_INVALID_TARGET'
  if (reason === 'invalid_rule') return 'RENAME_INVALID_RULE'
  if (reason === 'unsupported_kind') return 'RENAME_UNSUPPORTED_KIND'
  if (reason === 'no_change') return 'RENAME_NO_CHANGE'
  return 'RENAME_FAILED'
}

export function toRuntimeRootTrashToolResult(
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

export function toRuntimeRootMoveBatchToolResult(response: RuntimeRootMoveBatchResponse): ToolCallResult {
  const items = response.items.map((item) => ({
    relativePath: item.rootRelativePath,
    nextRelativePath: item.nextRootRelativePath ?? undefined,
    absolutePath: item.absolutePath,
    nextAbsolutePath: item.nextAbsolutePath ?? undefined,
    ok: item.ok,
    skipped: item.skipped,
    reasonCode: mapRootMoveFailureReason(item.reason),
    error: item.error ?? undefined,
  }))

  return {
    ok: true,
    dryRun: response.dryRun,
    total: response.total,
    renamed: response.moved,
    skipped: response.skipped,
    failed: response.failed,
    items,
  }
}

interface RuntimeRootMoveRebindMapping {
  fromRelativePath: string
  toRelativePath: string
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function appendPostProcessWarning(result: Record<string, unknown>, warning: string): void {
  const previous = typeof result.postProcessWarning === 'string' ? result.postProcessWarning : ''
  result.postProcessWarning = previous ? `${previous}; ${warning}` : warning
}

function readRuntimeRootMoveRebindMappings(result: ToolCallResult): RuntimeRootMoveRebindMapping[] {
  if (!isObjectRecord(result) || !Array.isArray(result.items)) {
    return []
  }

  const mappings: RuntimeRootMoveRebindMapping[] = []
  for (const item of result.items) {
    if (!isObjectRecord(item)) continue
    if (item.ok !== true || item.skipped === true) continue
    const fromRelativePath = typeof item.relativePath === 'string' ? item.relativePath.trim() : ''
    const toRelativePath = typeof item.nextRelativePath === 'string' ? item.nextRelativePath.trim() : ''
    if (!fromRelativePath || !toRelativePath || fromRelativePath === toRelativePath) continue
    mappings.push({ fromRelativePath, toRelativePath })
  }

  return mappings
}

export async function rebindRuntimeRootMoveBatchPaths(
  rootPath: string,
  result: ToolCallResult,
  timeoutMs?: number,
): Promise<ToolCallResult> {
  if (!isObjectRecord(result) || result.dryRun === true || Number(result.renamed ?? 0) <= 0) {
    return result
  }

  const mappings = readRuntimeRootMoveRebindMappings(result)
  if (mappings.length === 0) {
    return result
  }

  try {
    result.rebindResult = await callRuntimeHttp(
      '/v1/files/relative-paths',
      {
        rootPath,
        mappings,
      },
      typeof timeoutMs === 'number' ? timeoutMs : 120000,
      'PATCH',
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    appendPostProcessWarning(result, `batchRebindPaths failed: ${reason}`)
  }

  return result
}

export function toRuntimeGlobalTrashMoveToolResult(response: RuntimeGlobalTrashMoveResponse): ToolCallResult {
  const items = response.items.map((item) => ({
    sourceType: 'global_recycle',
    recycleId: item.recycleId || undefined,
    absolutePath: item.absolutePath,
    nextAbsolutePath: item.nextAbsolutePath ?? undefined,
    deletedAt: item.deletedAt,
    ok: item.ok,
    skipped: false,
    reasonCode: mapRuntimeFailureReason('move', item.reason),
    error: item.error ?? undefined,
  }))
  const moved = items.filter((item) => item.ok === true && item.skipped !== true).length
  const failed = items.filter((item) => item.ok !== true && item.skipped !== true).length

  return {
    ok: true,
    dryRun: response.dryRun,
    total: items.length,
    moved,
    skipped: 0,
    failed,
    items,
  }
}

export function toRuntimeGlobalTrashToolResult(response: RuntimeGlobalTrashRestoreResponse): ToolCallResult {
  const items = response.items.map((item) => ({
    sourceType: 'global_recycle',
    recycleId: item.recycleId,
    absolutePath: item.absolutePath,
    originalAbsolutePath: item.originalAbsolutePath,
    nextAbsolutePath: item.nextAbsolutePath ?? undefined,
    ok: item.ok,
    skipped: false,
    reasonCode: mapRuntimeFailureReason('restore', item.reason),
    error: item.error ?? undefined,
  }))
  const restored = items.filter((item) => item.ok === true && item.skipped !== true).length
  const failed = items.filter((item) => item.ok !== true && item.skipped !== true).length

  return {
    ok: true,
    dryRun: response.dryRun,
    total: items.length,
    restored,
    skipped: 0,
    failed,
    items,
  }
}

function mapDuplicateSeedSkipReason(reason: string): string {
  if (reason === 'source_not_found') return 'SOURCE_NOT_FOUND'
  if (reason === 'not_file') return 'NOT_FILE'
  return 'SKIPPED'
}

function toRuntimeDuplicateFileItem({
  file,
  rootPath,
  groupId,
  groupRank,
  isCurrentFile = false,
}: {
  file: RuntimeDuplicateFile
  rootPath: string
  groupId?: string
  groupRank?: number
  isCurrentFile?: boolean
}) {
  const lastModified = typeof file.lastModifiedMs === 'number'
    ? new Date(file.lastModifiedMs)
    : undefined

  return {
    name: file.name,
    path: file.rootRelativePath,
    kind: 'file',
    absolutePath: file.absolutePath,
    size: file.size,
    mimeType: getMimeType(file.name),
    previewKind: getFilePreviewKind(file.name),
    displayPath: file.rootRelativePath,
    sourceType: 'duplicate_file',
    sourceRootPath: rootPath,
    sourceRelativePath: file.rootRelativePath,
    lastModifiedMs: file.lastModifiedMs,
    lastModified,
    ...(groupId ? { groupId } : {}),
    ...(typeof groupRank === 'number' ? { groupRank } : {}),
    ...(isCurrentFile ? { isCurrentFile: true } : {}),
  }
}

function toRuntimeDuplicateFileToolResult(
  response: RuntimeDuplicateFilesResponse,
  rootPath: string,
  requestedRootRelativePaths: string[],
): ToolCallResult {
  const currentRootRelativePath = requestedRootRelativePaths[0] ?? ''
  const duplicateSet = response.duplicateSets.find((set) => (
    set.seedRootRelativePaths.includes(currentRootRelativePath)
    || set.files.some((file) => file.rootRelativePath === currentRootRelativePath)
  ))
  const currentFile = duplicateSet?.files.find((file) => file.rootRelativePath === currentRootRelativePath)
  const target = currentFile
    ? toRuntimeDuplicateFileItem({
        file: currentFile,
        rootPath,
        isCurrentFile: true,
      })
    : undefined
  const duplicates = duplicateSet
    ? duplicateSet.files
      .filter((file) => file.rootRelativePath !== currentRootRelativePath)
      .map((file) => toRuntimeDuplicateFileItem({ file, rootPath }))
    : []

  return {
    ok: true,
    mode: 'file',
    searchScope: 'root',
    ...(target ? { target } : {}),
    duplicateCount: duplicates.length,
    duplicates,
    indexing: {
      strategy: 'runtime_scan',
      targetStatus: response.skippedSeeds.length > 0 ? 'skipped' : 'fresh',
    },
    ...(target && duplicates.length > 0
      ? {
          projection: {
            id: `duplicates:file:${Date.now()}`,
            title: '重复文件',
            entry: 'auto',
            ordering: {
              mode: 'listed',
              keys: ['isCurrentFile:desc', 'lastModifiedMs:desc', 'displayPath:asc'],
            },
            files: [target, ...duplicates],
          },
        }
      : {}),
  }
}

function toRuntimeDuplicateWorkspaceGroup(
  duplicateSet: RuntimeDuplicateSet,
  rootPath: string,
  groupRank: number,
) {
  const items = duplicateSet.files.map((file) => toRuntimeDuplicateFileItem({
    file,
    rootPath,
    groupId: duplicateSet.setId,
    groupRank,
  }))

  return {
    groupId: duplicateSet.setId,
    seedRelativePaths: duplicateSet.seedRootRelativePaths,
    items,
  }
}

function toRuntimeDuplicateWorkspaceToolResult(
  response: RuntimeDuplicateFilesResponse,
  rootPath: string,
): ToolCallResult {
  const groups = response.duplicateSets
    .map((duplicateSet, index) => toRuntimeDuplicateWorkspaceGroup(duplicateSet, rootPath, index))
    .filter((group) => group.items.length > 1)
  const projectionFiles = groups.flatMap((group, groupRank) => (
    group.items.map((item) => ({
      ...item,
      groupRank,
    }))
  ))

  return {
    ok: true,
    mode: 'workspace',
    searchScope: 'root',
    seedCount: response.seedCount,
    indexedSeedCount: response.seedCount - response.skippedSeeds.length,
    needsIndexingCount: 0,
    skippedSeeds: response.skippedSeeds.map((skip) => ({
      relativePath: skip.rootRelativePath,
      reasonCode: mapDuplicateSeedSkipReason(skip.reason),
    })),
    duplicateGroupCount: groups.length,
    groups,
    ...(projectionFiles.length > 0
      ? {
          projection: {
            id: `duplicates:workspace:${Date.now()}`,
            title: '重复文件',
            entry: 'auto',
            ordering: {
              mode: 'group_contiguous',
              keys: ['groupRank:asc', 'lastModifiedMs:desc', 'displayPath:asc'],
            },
            files: projectionFiles,
          },
        }
      : {}),
  }
}

export function toRuntimeDuplicateToolResult(
  response: RuntimeDuplicateFilesResponse,
  rootPath: string,
  requestedRootRelativePaths: string[],
  mode: 'file' | 'workspace',
): ToolCallResult {
  if (mode === 'file') {
    return toRuntimeDuplicateFileToolResult(response, rootPath, requestedRootRelativePaths)
  }

  return toRuntimeDuplicateWorkspaceToolResult(response, rootPath)
}
