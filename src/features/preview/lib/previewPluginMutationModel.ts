import type { DispatchSystemToolResult } from '../../../lib/actionDispatcher.ts'
import type { FileItem } from '../../../types/index.ts'
import { readDeleteUndoRestoreItems } from '../../workspace/lib/deleteUndo.ts'
import type { PreviewMutationCommitParams } from '../types/mutation.ts'

export interface ResolvePreviewPluginMutationCommitParamsParams {
  toolName: string
  result: DispatchSystemToolResult
  file: FileItem
  activeProjectionId?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function readFirstResultRelativePath(result: unknown): string | null {
  if (!isRecord(result)) return null
  if (!Array.isArray(result.items) || result.items.length === 0) return null
  const first = result.items[0]
  if (!isRecord(first) || typeof first.relativePath !== 'string') return null
  const normalized = normalizeRelativePath(first.relativePath)
  return normalized || null
}

function readSuccessfulResultAbsolutePaths(result: unknown): string[] {
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

export function resolvePreviewPluginMutationCommitParams({
  toolName,
  result,
  file,
  activeProjectionId,
}: ResolvePreviewPluginMutationCommitParamsParams): PreviewMutationCommitParams {
  const mutationParams: PreviewMutationCommitParams = {
    mutationToolName: toolName,
  }
  if (toolName !== 'fs.softDelete') {
    return mutationParams
  }

  mutationParams.undoRestoreItems = readDeleteUndoRestoreItems(result.result)
  mutationParams.deletedRelativePath = readFirstResultRelativePath(result.result) ?? file.path
  const deletedAbsolutePathSet = new Set<string>()
  for (const absolutePath of readSuccessfulResultAbsolutePaths(result.result)) {
    if (absolutePath) {
      deletedAbsolutePathSet.add(absolutePath)
    }
  }
  if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
    deletedAbsolutePathSet.add(file.absolutePath.trim())
  }
  if (deletedAbsolutePathSet.size > 0) {
    mutationParams.deletedAbsolutePaths = [...deletedAbsolutePathSet]
  }
  if (activeProjectionId) {
    mutationParams.projectionTabId = activeProjectionId
    mutationParams.deletedProjectionPaths = [file.path]
  }

  return mutationParams
}
