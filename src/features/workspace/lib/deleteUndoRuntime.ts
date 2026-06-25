import {
  restoreRuntimeGlobalTrash,
  restoreRuntimePathFromRootTrash,
  type RuntimeGlobalTrashRestoreResponse,
  type RuntimeRootTrashResponse,
} from '@/lib/runtimeApi'
import {
  type DeleteUndoRestoreItem,
  toRelativePathWithinRoot,
} from '@/features/workspace/lib/deleteUndo'

interface RestoreRecycleResponseItem {
  ok?: boolean
  nextAbsolutePath?: string
  reasonCode?: string
  error?: string
}

interface RestoreRecycleResponse {
  ok?: boolean
  total?: number
  restored?: number
  failed?: number
  items?: RestoreRecycleResponseItem[]
}

function mapRuntimeRestoreReasonCode(reason: string | null): string | undefined {
  if (reason === 'invalid_source') return 'RESTORE_INVALID_SOURCE'
  if (reason === 'recycle_item_not_found') return 'RECYCLE_ITEM_NOT_FOUND'
  if (reason === 'source_not_found') return 'RESTORE_SOURCE_NOT_FOUND'
  if (reason === 'unsupported_kind') return 'RESTORE_UNSUPPORTED_KIND'
  if (reason === 'target_exists') return 'RESTORE_TARGET_EXISTS'
  if (reason === 'mutation_failed') return 'RESTORE_FAILED'
  return reason ? 'RESTORE_FAILED' : undefined
}

function toRestoreRecycleResponseFromRuntime(response: RuntimeRootTrashResponse): RestoreRecycleResponse {
  return {
    ok: true,
    total: response.total,
    restored: response.completed,
    failed: response.failed,
    items: response.items.map((item) => ({
      ok: item.ok,
      nextAbsolutePath: item.nextAbsolutePath ?? undefined,
      reasonCode: mapRuntimeRestoreReasonCode(item.reason),
      error: item.error ?? undefined,
    })),
  }
}

function toRestoreRecycleResponseFromGlobalTrashRuntime(
  response: RuntimeGlobalTrashRestoreResponse
): RestoreRecycleResponse {
  return {
    ok: true,
    total: response.total,
    restored: response.restored,
    failed: response.failed,
    items: response.items.map((item) => ({
      ok: item.ok,
      nextAbsolutePath: item.nextAbsolutePath ?? undefined,
      reasonCode: mapRuntimeRestoreReasonCode(item.reason),
      error: item.error ?? undefined,
    })),
  }
}

export async function restoreDeleteUndoItemsThroughRuntime(
  items: DeleteUndoRestoreItem[],
  rootPath: string | null,
): Promise<RestoreRecycleResponse> {
  const responseItems: RestoreRecycleResponseItem[] = Array.from({ length: items.length }, () => ({
    ok: false,
    reasonCode: 'RESTORE_UNSUPPORTED_KIND',
    error: '撤销删除项无法通过 Fauplay Runtime 恢复',
  }))
  const rootTrashItems: Array<{ index: number; rootRelativePath: string }> = []
  const globalTrashItems: Array<{ index: number; recycleId: string }> = []

  for (const [index, item] of items.entries()) {
    if (item.sourceType === 'root_trash') {
      const absolutePath = typeof item.absolutePath === 'string' ? item.absolutePath.trim() : ''
      const rootRelativePath = rootPath && absolutePath
        ? toRelativePathWithinRoot(rootPath, absolutePath)
        : null
      if (!rootRelativePath || !rootRelativePath.startsWith('.trash/')) {
        responseItems[index] = {
          ok: false,
          reasonCode: 'RESTORE_INVALID_SOURCE',
          error: 'Root Trash restore item is outside the current Local Root',
        }
        continue
      }
      rootTrashItems.push({ index, rootRelativePath })
      continue
    }

    if (item.sourceType === 'global_recycle') {
      const recycleId = typeof item.recycleId === 'string' ? item.recycleId.trim() : ''
      if (!recycleId) {
        responseItems[index] = {
          ok: false,
          reasonCode: 'RECYCLE_ITEM_NOT_FOUND',
          error: 'Global Trash restore item is missing recycleId',
        }
        continue
      }
      globalTrashItems.push({ index, recycleId })
    }
  }

  if (rootTrashItems.length > 0) {
    if (!rootPath) {
      throw new Error('Root Trash restore requires a Local Root Binding')
    }
    const response = toRestoreRecycleResponseFromRuntime(
      await restoreRuntimePathFromRootTrash({
        rootPath,
        rootRelativePath: rootTrashItems.map((item) => item.rootRelativePath),
      }, 120000)
    )
    rootTrashItems.forEach((item, responseIndex) => {
      responseItems[item.index] = response.items?.[responseIndex] ?? {
        ok: false,
        reasonCode: 'RESTORE_FAILED',
        error: 'Root Trash restore response was incomplete',
      }
    })
  }

  if (globalTrashItems.length > 0) {
    const response = toRestoreRecycleResponseFromGlobalTrashRuntime(
      await restoreRuntimeGlobalTrash({
        recycleId: globalTrashItems.map((item) => item.recycleId),
      }, 120000)
    )
    globalTrashItems.forEach((item, responseIndex) => {
      responseItems[item.index] = response.items?.[responseIndex] ?? {
        ok: false,
        reasonCode: 'RESTORE_FAILED',
        error: 'Global Trash restore response was incomplete',
      }
    })
  }

  const restored = responseItems.filter((item) => item.ok === true).length

  return {
    ok: true,
    total: items.length,
    restored,
    failed: items.length - restored,
    items: responseItems,
  }
}

export function createDeleteUndoId(prefix: string): string {
  return `${prefix}:${Date.now()}-${Math.random().toString(16).slice(2)}`
}
