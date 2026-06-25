import type { FileItem } from '../../../types/index.ts'
import type { PluginResultQueueItem } from '../../plugin-runtime/types/index.ts'
import {
  type PluginDuplicateProjectionDismissIntent,
  type PluginProjectionActivationIntent,
  resolvePluginDuplicateProjectionDismissIntent,
  resolvePluginProjectionActivationIntent,
} from '../../plugin-runtime/lib/pluginProjectionIntentModel.ts'
import { readDeleteUndoRestoreItems } from '../../workspace/lib/deleteUndo.ts'
import type { WorkspaceMutationCommitParams } from '../../workspace/types/mutation.ts'

export interface WorkspaceRelativeToolPayload {
  relativePaths: string[]
  rootPath?: string
}

export interface WorkspaceAbsoluteDeletePayload {
  absolutePaths: string[]
}

export interface ResolveWorkspaceMutationCommitParamsParams {
  toolName: string
  result: { result?: unknown }
  selectedDeleteAbsoluteArgs: WorkspaceAbsoluteDeletePayload | null
  activeProjectionId: string | null | undefined
  selectedFileEntries: FileItem[]
}

interface ResolveWorkspacePluginProjectionActivationIntentParams {
  queueItems: readonly PluginResultQueueItem[]
  handledResultId: string | null
}

interface ResolveWorkspacePluginDuplicateProjectionDismissIntentParams {
  queueItems: readonly PluginResultQueueItem[]
  handledResultId: string | null
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function resolveWorkspaceRelativeToolPayload(files: FileItem[]): WorkspaceRelativeToolPayload | null {
  if (files.length === 0) return null

  const relativePaths: string[] = []
  let sharedRootPath: string | null = null
  for (const file of files) {
    const relativePath = typeof file.sourceRelativePath === 'string' && file.sourceRelativePath.trim()
      ? file.sourceRelativePath.trim()
      : (!isAbsolutePathLike(file.path) ? file.path : '')
    if (!relativePath) {
      return null
    }

    if (typeof file.sourceRootPath === 'string' && file.sourceRootPath.trim()) {
      const sourceRootPath = file.sourceRootPath.trim()
      if (sharedRootPath === null) {
        sharedRootPath = sourceRootPath
      } else if (sharedRootPath !== sourceRootPath) {
        return null
      }
    }

    relativePaths.push(relativePath)
  }

  return {
    relativePaths,
    ...(sharedRootPath ? { rootPath: sharedRootPath } : {}),
  }
}

export function resolveWorkspaceRecycleRestoreItems(files: FileItem[]): Array<Record<string, unknown>> | null {
  if (files.length === 0) return null

  const items: Array<Record<string, unknown>> = []
  for (const file of files) {
    if (file.sourceType !== 'root_trash' && file.sourceType !== 'global_recycle') {
      return null
    }

    const nextItem: Record<string, unknown> = {
      sourceType: file.sourceType,
    }
    if (typeof file.recycleId === 'string' && file.recycleId.trim()) {
      nextItem.recycleId = file.recycleId.trim()
    }
    if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
      nextItem.absolutePath = file.absolutePath.trim()
    }
    items.push(nextItem)
  }

  return items
}

export function resolveWorkspaceAbsoluteDeletePayload(files: FileItem[]): WorkspaceAbsoluteDeletePayload | null {
  if (files.length === 0) return null
  const absolutePaths = files
    .map((file) => (typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''))
    .filter((item) => item)
  if (absolutePaths.length !== files.length) {
    return null
  }
  return { absolutePaths }
}

export function resolveWorkspacePluginProjectionActivationIntent({
  queueItems,
  handledResultId,
}: ResolveWorkspacePluginProjectionActivationIntentParams): PluginProjectionActivationIntent {
  return resolvePluginProjectionActivationIntent({ queueItems, handledResultId })
}

export function resolveWorkspacePluginDuplicateProjectionDismissIntent({
  queueItems,
  handledResultId,
}: ResolveWorkspacePluginDuplicateProjectionDismissIntentParams): PluginDuplicateProjectionDismissIntent {
  return resolvePluginDuplicateProjectionDismissIntent({ queueItems, handledResultId })
}

export function readSuccessfulResultAbsolutePaths(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.items)) {
    return []
  }

  const unique = new Set<string>()
  for (const item of result.items) {
    if (!isRecord(item) || item.ok !== true || typeof item.absolutePath !== 'string') {
      continue
    }
    const absolutePath = item.absolutePath.trim()
    if (!absolutePath) continue
    unique.add(absolutePath)
  }

  return [...unique]
}

export function resolveWorkspaceMutationCommitParams({
  toolName,
  result,
  selectedDeleteAbsoluteArgs,
  activeProjectionId,
  selectedFileEntries,
}: ResolveWorkspaceMutationCommitParamsParams): WorkspaceMutationCommitParams {
  const mutationParams: WorkspaceMutationCommitParams = {
    mutationToolName: toolName,
  }
  if (toolName !== 'fs.softDelete') {
    return mutationParams
  }

  mutationParams.undoRestoreItems = readDeleteUndoRestoreItems(result.result)
  const successfulAbsolutePaths = readSuccessfulResultAbsolutePaths(result.result)
  const requestedAbsolutePaths = selectedDeleteAbsoluteArgs?.absolutePaths ?? []
  const deletedAbsolutePathSet = new Set<string>()
  for (const absolutePath of successfulAbsolutePaths) {
    if (absolutePath) {
      deletedAbsolutePathSet.add(absolutePath)
    }
  }
  for (const absolutePath of requestedAbsolutePaths) {
    if (absolutePath) {
      deletedAbsolutePathSet.add(absolutePath)
    }
  }
  if (deletedAbsolutePathSet.size > 0) {
    mutationParams.deletedAbsolutePaths = [...deletedAbsolutePathSet]
  }
  if (activeProjectionId) {
    mutationParams.projectionTabId = activeProjectionId
    mutationParams.deletedProjectionPaths = selectedFileEntries.map((file) => file.path)
  }

  return mutationParams
}
