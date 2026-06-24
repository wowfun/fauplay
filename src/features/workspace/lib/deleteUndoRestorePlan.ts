import {
  type DeleteUndoBatch,
  type DeleteUndoRestoreItem,
  type DeleteUndoSnapshot,
  normalizeAbsolutePath,
} from './deleteUndo.ts'
import { buildRestoredDeleteUndoSnapshot } from './deleteUndoSnapshot.ts'

export interface DeleteUndoRestoreResponseItem {
  ok?: boolean
  nextAbsolutePath?: string
}

export interface DeleteUndoRestoreResponse {
  items?: DeleteUndoRestoreResponseItem[]
}

export interface DeleteUndoRetryBatchMetadata {
  id: string
  createdAt: number
}

export interface ResolveDeleteUndoRestoreResultParams {
  batch: DeleteUndoBatch
  remainingUndoBatches: DeleteUndoBatch[]
  response: DeleteUndoRestoreResponse
  retryBatchMetadata: DeleteUndoRetryBatchMetadata
}

export interface DeleteUndoRestoreResult {
  restoredCount: number
  restoredAbsolutePaths: string[]
  failedRetryBatch: DeleteUndoBatch | null
  undoBatches: DeleteUndoBatch[]
  restoredSnapshot: DeleteUndoSnapshot
}

export function resolveDeleteUndoRestoreResult({
  batch,
  remainingUndoBatches,
  response,
  retryBatchMetadata,
}: ResolveDeleteUndoRestoreResultParams): DeleteUndoRestoreResult {
  const responseItems = Array.isArray(response.items) ? response.items : []
  const restoredAbsolutePathByOriginalAbsolutePath = new Map<string, string>()
  const failedRestoreItems: DeleteUndoRestoreItem[] = []

  batch.restoreItems.forEach((restoreItem, index) => {
    const responseItem = responseItems[index]
    const nextAbsolutePath = typeof responseItem?.nextAbsolutePath === 'string'
      ? responseItem.nextAbsolutePath.trim()
      : ''
    if (responseItem?.ok === true && nextAbsolutePath) {
      const normalizedNextAbsolutePath = normalizeAbsolutePath(nextAbsolutePath)
      restoredAbsolutePathByOriginalAbsolutePath.set(
        normalizeAbsolutePath(restoreItem.originalAbsolutePath),
        normalizedNextAbsolutePath
      )
      return
    }
    failedRestoreItems.push(restoreItem)
  })

  const failedOriginalAbsolutePathSet = new Set(
    failedRestoreItems.map((item) => normalizeAbsolutePath(item.originalAbsolutePath))
  )
  const retrySnapshot = buildRestoredDeleteUndoSnapshot(
    batch.snapshot,
    restoredAbsolutePathByOriginalAbsolutePath,
    new Set()
  )
  const restoredSnapshot = buildRestoredDeleteUndoSnapshot(
    batch.snapshot,
    restoredAbsolutePathByOriginalAbsolutePath,
    failedOriginalAbsolutePathSet
  )
  const failedRetryBatch = failedRestoreItems.length > 0
    ? {
      id: retryBatchMetadata.id,
      createdAt: retryBatchMetadata.createdAt,
      deletedCount: failedRestoreItems.length,
      restoreItems: failedRestoreItems,
      snapshot: retrySnapshot,
    }
    : null

  return {
    restoredCount: restoredAbsolutePathByOriginalAbsolutePath.size,
    restoredAbsolutePaths: [...restoredAbsolutePathByOriginalAbsolutePath.values()],
    failedRetryBatch,
    undoBatches: failedRetryBatch
      ? [failedRetryBatch, ...remainingUndoBatches]
      : remainingUndoBatches,
    restoredSnapshot,
  }
}
