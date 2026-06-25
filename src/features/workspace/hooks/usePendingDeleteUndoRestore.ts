import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { normalizeRootRelativePath } from '@/features/workspace/lib/projectionTabRecords'
import type { DeleteUndoSnapshot } from '@/features/workspace/lib/deleteUndo'

export interface PendingDeleteUndoRestoreState {
  snapshot: DeleteUndoSnapshot
}

interface UsePendingDeleteUndoRestoreParams {
  pendingDeleteUndoRestore: PendingDeleteUndoRestoreState | null
  setPendingDeleteUndoRestore: Dispatch<SetStateAction<PendingDeleteUndoRestoreState | null>>
  rootId: string
  currentPath: string
  applyDeleteUndoSnapshot: (snapshot: DeleteUndoSnapshot) => Promise<void>
  showDeleteUndoNoticeMessage: (message: string, tone?: 'default' | 'error') => void
  setIsUndoingDelete: (isUndoingDelete: boolean) => void
}

export function usePendingDeleteUndoRestore({
  pendingDeleteUndoRestore,
  setPendingDeleteUndoRestore,
  rootId,
  currentPath,
  applyDeleteUndoSnapshot,
  showDeleteUndoNoticeMessage,
  setIsUndoingDelete,
}: UsePendingDeleteUndoRestoreParams): void {
  useEffect(() => {
    if (!pendingDeleteUndoRestore) {
      return
    }
    if (rootId !== pendingDeleteUndoRestore.snapshot.historyEntry.rootId) {
      return
    }
    if (
      normalizeRootRelativePath(currentPath)
      !== normalizeRootRelativePath(pendingDeleteUndoRestore.snapshot.historyEntry.path)
    ) {
      return
    }

    let cancelled = false
    const snapshot = pendingDeleteUndoRestore.snapshot
    setPendingDeleteUndoRestore(null)

    const applyPendingRestore = async () => {
      try {
        await applyDeleteUndoSnapshot(snapshot)
      } catch (error) {
        if (!cancelled) {
          showDeleteUndoNoticeMessage(
            error instanceof Error ? error.message : '恢复删除前状态失败',
            'error'
          )
        }
      } finally {
        if (!cancelled) {
          setIsUndoingDelete(false)
        }
      }
    }

    void applyPendingRestore()
    return () => {
      cancelled = true
    }
  }, [
    applyDeleteUndoSnapshot,
    currentPath,
    pendingDeleteUndoRestore,
    rootId,
    setIsUndoingDelete,
    setPendingDeleteUndoRestore,
    showDeleteUndoNoticeMessage,
  ])
}
