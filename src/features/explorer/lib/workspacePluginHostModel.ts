import type { FileItem } from '../../../types/index.ts'
import type { RuntimeToolDescriptor } from '../../../lib/runtimeApi/toolDescriptors.ts'
import type { PluginResultQueueItem } from '../../plugin-runtime/types/index.ts'
import {
  type PluginDuplicateProjectionDismissIntent,
  type PluginProjectionActivationIntent,
  resolvePluginDuplicateProjectionDismissIntent,
  resolvePluginProjectionActivationIntent,
} from '../../plugin-runtime/lib/pluginProjectionIntentModel.ts'
import { orderToolsWithSoftDeleteLast } from '../../plugin-runtime/utils/toolOrdering.ts'
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

interface ResolveWorkspaceContextualToolsParams {
  currentPath: string
  tools: readonly RuntimeToolDescriptor[]
}

interface ResolveWorkspaceToolArgumentsParams {
  toolName: string
  hasSelectedEntries: boolean
  selectedEntryPaths: readonly string[]
  selectedDeleteAbsoluteArgs: WorkspaceAbsoluteDeletePayload | null
  selectedRestoreItems: readonly Record<string, unknown>[] | null
  relativeTargetArgs: WorkspaceRelativeToolPayload | null
  extraArgs?: Record<string, unknown>
}

interface ResolveWorkspaceToolTargetStateParams {
  visibleFiles: readonly FileItem[]
  selectedPaths: readonly string[]
  hasActiveProjection: boolean
}

export interface WorkspaceToolTargetState {
  selectedEntries: FileItem[]
  selectedEntryPaths: string[]
  selectedFileEntries: FileItem[]
  targetFileEntries: FileItem[]
  relativeTargetArgs: WorkspaceRelativeToolPayload | null
  selectedRestoreItems: Array<Record<string, unknown>> | null
  selectedDeleteAbsoluteArgs: WorkspaceAbsoluteDeletePayload | null
  hasTargets: boolean
  hasSelectedEntries: boolean
  hasRenderableTargets: boolean
}

type WorkspaceToolRunSource = 'rail' | 'workbench-action' | 'custom-tool-call'

interface ResolveWorkspaceToolRunPlanParams {
  source: WorkspaceToolRunSource
  toolName: string
  additionalArgs: Record<string, unknown> | null
  actionKey?: string
  actionLabel?: string
}

export type WorkspaceToolRunPlan =
  | {
    kind: 'none'
  }
  | {
    kind: 'face-scan-job'
    additionalArgs: Record<string, unknown>
  }
  | {
    kind: 'runtime-tool-call'
    additionalArgs: Record<string, unknown>
    actionKey?: string
    actionLabel?: string
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

export function resolveWorkspaceContextualTools({
  currentPath,
  tools,
}: ResolveWorkspaceContextualToolsParams): RuntimeToolDescriptor[] {
  const normalizedCurrentPath = currentPath.split('/').filter(Boolean).join('/')
  const isTrashContext = (
    normalizedCurrentPath === '@trash'
    || normalizedCurrentPath === '.trash'
    || normalizedCurrentPath.startsWith('.trash/')
  )
  const filteredTools = isTrashContext
    ? tools.filter((tool) => tool.name === 'fs.restore')
    : tools.filter((tool) => tool.name !== 'fs.restore')
  return orderToolsWithSoftDeleteLast(filteredTools)
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

export function resolveWorkspaceToolTargetState({
  visibleFiles,
  selectedPaths,
  hasActiveProjection,
}: ResolveWorkspaceToolTargetStateParams): WorkspaceToolTargetState {
  const selectedPathSet = new Set(selectedPaths)
  const selectedEntries = visibleFiles.filter((file) => selectedPathSet.has(file.path))
  const selectedEntryPaths = selectedEntries.map((file) => file.path)
  const selectedFileEntries = selectedEntries.filter((file): file is FileItem => file.kind === 'file')
  const visibleFileEntries = visibleFiles.filter((file): file is FileItem => file.kind === 'file')
  const targetFileEntries = selectedFileEntries.length > 0 ? selectedFileEntries : visibleFileEntries
  const relativeTargetArgs = resolveWorkspaceRelativeToolPayload(targetFileEntries)
  const selectedRestoreItems = resolveWorkspaceRecycleRestoreItems(selectedFileEntries)
  const selectedDeleteAbsoluteArgs = hasActiveProjection
    ? resolveWorkspaceAbsoluteDeletePayload(selectedFileEntries)
    : null
  const hasTargets = targetFileEntries.length > 0
  const hasSelectedEntries = selectedEntries.length > 0

  return {
    selectedEntries,
    selectedEntryPaths,
    selectedFileEntries,
    targetFileEntries,
    relativeTargetArgs,
    selectedRestoreItems,
    selectedDeleteAbsoluteArgs,
    hasTargets,
    hasSelectedEntries,
    hasRenderableTargets: hasTargets || hasSelectedEntries,
  }
}

export function resolveWorkspaceToolArguments({
  toolName,
  hasSelectedEntries,
  selectedEntryPaths,
  selectedDeleteAbsoluteArgs,
  selectedRestoreItems,
  relativeTargetArgs,
  extraArgs,
}: ResolveWorkspaceToolArgumentsParams): Record<string, unknown> | null {
  if (toolName === 'fs.softDelete') {
    if (!hasSelectedEntries) return null
    if (selectedDeleteAbsoluteArgs) {
      return {
        ...selectedDeleteAbsoluteArgs,
        ...(extraArgs ?? {}),
      }
    }
    return {
      relativePaths: selectedEntryPaths,
      ...(extraArgs ?? {}),
    }
  }

  if (toolName === 'fs.restore') {
    if (!hasSelectedEntries) return null
    if (selectedRestoreItems) {
      return {
        items: selectedRestoreItems,
        ...(extraArgs ?? {}),
      }
    }
    return {
      relativePaths: selectedEntryPaths,
      ...(extraArgs ?? {}),
    }
  }

  if (!relativeTargetArgs) {
    return null
  }

  return {
    ...relativeTargetArgs,
    ...(extraArgs ?? {}),
  }
}

export function resolveWorkspaceToolRunPlan({
  source,
  toolName,
  additionalArgs,
  actionKey,
  actionLabel,
}: ResolveWorkspaceToolRunPlanParams): WorkspaceToolRunPlan {
  if (!additionalArgs) {
    return { kind: 'none' }
  }

  const shouldRunFaceScanJob = (
    toolName === 'vision.face'
    && (
      (source === 'rail' && additionalArgs.operation === 'detectAssets')
      || (source === 'workbench-action' && actionKey === 'detectVisibleAssets')
      || (source === 'custom-tool-call' && additionalArgs.operation === 'detectAssets')
    )
  )

  if (shouldRunFaceScanJob) {
    return {
      kind: 'face-scan-job',
      additionalArgs,
    }
  }

  return {
    kind: 'runtime-tool-call',
    additionalArgs,
    ...(actionKey ? { actionKey } : {}),
    ...(actionLabel ? { actionLabel } : {}),
  }
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
