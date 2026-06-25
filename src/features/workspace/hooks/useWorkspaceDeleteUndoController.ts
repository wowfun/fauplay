import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import {
  type PendingDeleteUndoRestoreState,
  usePendingDeleteUndoRestore,
} from '@/features/workspace/hooks/usePendingDeleteUndoRestore'
import type { DuplicateSelectionRule } from '@/features/workspace/lib/duplicateSelection'
import type {
  DeleteUndoBatch,
  DeleteUndoPreviewSnapshot,
  DeleteUndoRestoreItem,
  DeleteUndoSnapshot,
} from '@/features/workspace/lib/deleteUndo'
import {
  createDeleteUndoId,
  restoreDeleteUndoItemsThroughRuntime,
} from '@/features/workspace/lib/deleteUndoRuntime'
import { shouldCreateDeleteUndoBatchForMutation } from '@/features/workspace/lib/deleteUndoMutationPlan'
import { resolveDeleteUndoRestoreResult } from '@/features/workspace/lib/deleteUndoRestorePlan'
import { cloneFilterState } from '@/features/workspace/hooks/useWorkspaceFilterState'
import {
  cloneDuplicateSelectionRuleRecord,
  cloneNullableStringRecord,
  cloneResultProjection,
  cloneStringArrayRecord,
  createDeleteUndoBatch,
  createDeleteUndoPreviewSnapshot,
  createDeleteUndoSnapshot,
} from '@/features/workspace/lib/deleteUndoSnapshot'
import {
  normalizeRootRelativePath,
  type WorkspaceActiveSurface,
} from '@/features/workspace/lib/projectionTabRecords'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import { getBoundRootPath } from '@/lib/reveal'
import type {
  AddressPathHistoryEntry,
  FileItem,
  FilterState,
  ResultPanelDisplayMode,
  ResultProjection,
} from '@/types'

const DELETE_UNDO_NOTICE_TIMEOUT_MS = 6000

type DeleteUndoNoticeTone = 'default' | 'error'

interface DeleteUndoNoticeState {
  id: string
  message: string
  tone: DeleteUndoNoticeTone
}

interface UseWorkspaceDeleteUndoControllerParams {
  rootId: string
  rootName: string
  currentPath: string
  filter: FilterState
  setFilter: Dispatch<SetStateAction<FilterState>>
  isFlattenView: boolean
  setFlattenView: (flattenView: boolean) => Promise<void>
  activeSurface: WorkspaceActiveSurface
  setActiveSurface: Dispatch<SetStateAction<WorkspaceActiveSurface>>
  directorySelectedPaths: string[]
  setDirectorySelectedPaths: Dispatch<SetStateAction<string[]>>
  directoryFocusedPath: string | null
  setDirectoryFocusedPath: Dispatch<SetStateAction<string | null>>
  isResultPanelOpen: boolean
  setIsResultPanelOpen: (isOpen: boolean) => void
  resultPanelDisplayMode: ResultPanelDisplayMode
  setResultPanelDisplayMode: (mode: ResultPanelDisplayMode) => void
  resultPanelHeightPx: number
  setResultPanelHeightPx: (heightPx: number) => void
  lastNormalResultPanelHeightRef: MutableRefObject<number>
  projectionTabs: ResultProjection[]
  setProjectionTabs: Dispatch<SetStateAction<ResultProjection[]>>
  activeProjectionTabId: string | null
  setActiveProjectionTabId: Dispatch<SetStateAction<string | null>>
  setLastProjectionTabId: (tabId: string | null) => void
  projectionSelectedPathsById: Record<string, string[]>
  setProjectionSelectedPathsById: Dispatch<SetStateAction<Record<string, string[]>>>
  projectionFocusedPathById: Record<string, string | null>
  setProjectionFocusedPathById: Dispatch<SetStateAction<Record<string, string | null>>>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
  setDuplicateSelectionRuleByProjectionId: Dispatch<SetStateAction<Record<string, DuplicateSelectionRule | null>>>
  showPreviewPane: boolean
  selectedFile: FileItem | null
  previewFile: FileItem | null
  openFileInPaneOrFullscreenFallback: (file: FileItem) => void
  closePreviewPane: () => void
  openFileInModal: (file: FileItem) => void
  closePreviewModal: () => void
  refreshFilterTagSnapshots: () => Promise<void>
  openHistoryEntry: (entry: AddressPathHistoryEntry) => Promise<boolean>
  forgetDeletedProjectionAbsolutePath: (absolutePath: string) => void
}

interface WorkspaceDeleteUndoController {
  deleteUndoNoticeMessage: string | null
  deleteUndoNoticeTone: DeleteUndoNoticeTone
  canUndoDelete: boolean
  isUndoingDelete: boolean
  createDeleteUndoBatchFromParams: (
    params: WorkspaceMutationCommitParams | PreviewMutationCommitParams | undefined
  ) => DeleteUndoBatch | null
  pushDeleteUndoBatch: (batch: DeleteUndoBatch | null) => void
  handleUndoDelete: () => Promise<void>
}

export function useWorkspaceDeleteUndoController({
  rootId,
  rootName,
  currentPath,
  filter,
  setFilter,
  isFlattenView,
  setFlattenView,
  activeSurface,
  setActiveSurface,
  directorySelectedPaths,
  setDirectorySelectedPaths,
  directoryFocusedPath,
  setDirectoryFocusedPath,
  isResultPanelOpen,
  setIsResultPanelOpen,
  resultPanelDisplayMode,
  setResultPanelDisplayMode,
  resultPanelHeightPx,
  setResultPanelHeightPx,
  lastNormalResultPanelHeightRef,
  projectionTabs,
  setProjectionTabs,
  activeProjectionTabId,
  setActiveProjectionTabId,
  setLastProjectionTabId,
  projectionSelectedPathsById,
  setProjectionSelectedPathsById,
  projectionFocusedPathById,
  setProjectionFocusedPathById,
  duplicateSelectionRuleByProjectionId,
  setDuplicateSelectionRuleByProjectionId,
  showPreviewPane,
  selectedFile,
  previewFile,
  openFileInPaneOrFullscreenFallback,
  closePreviewPane,
  openFileInModal,
  closePreviewModal,
  refreshFilterTagSnapshots,
  openHistoryEntry,
  forgetDeletedProjectionAbsolutePath,
}: UseWorkspaceDeleteUndoControllerParams): WorkspaceDeleteUndoController {
  const [deleteUndoBatches, setDeleteUndoBatches] = useState<DeleteUndoBatch[]>([])
  const [isUndoingDelete, setIsUndoingDelete] = useState(false)
  const [deleteUndoNotice, setDeleteUndoNotice] = useState<DeleteUndoNoticeState | null>(null)
  const [pendingDeleteUndoRestore, setPendingDeleteUndoRestore] = useState<PendingDeleteUndoRestoreState | null>(null)

  const showDeleteUndoNoticeMessage = useCallback((message: string, tone: DeleteUndoNoticeTone = 'default') => {
    setDeleteUndoNotice({
      id: createDeleteUndoId('delete-undo-notice'),
      message,
      tone,
    })
  }, [])

  const captureDeleteUndoPreviewSnapshot = useCallback((): DeleteUndoPreviewSnapshot => (
    createDeleteUndoPreviewSnapshot({
      showPreviewPane,
      selectedFile,
      previewFile,
    })
  ), [previewFile, selectedFile, showPreviewPane])

  const captureDeleteUndoSnapshot = useCallback((): DeleteUndoSnapshot | null => {
    return createDeleteUndoSnapshot({
      rootId,
      rootName,
      rootPath: rootId ? getBoundRootPath(rootId) : null,
      currentPath,
      visitedAt: Date.now(),
      filter,
      isFlattenView,
      activeSurface,
      directorySelectedPaths,
      directoryFocusedPath,
      isResultPanelOpen,
      resultPanelDisplayMode,
      resultPanelHeightPx,
      lastNormalResultPanelHeightPx: lastNormalResultPanelHeightRef.current,
      projectionTabs,
      activeProjectionTabId,
      projectionSelectedPathsById,
      projectionFocusedPathById,
      duplicateSelectionRuleByProjectionId,
      preview: captureDeleteUndoPreviewSnapshot(),
    })
  }, [
    activeProjectionTabId,
    activeSurface,
    captureDeleteUndoPreviewSnapshot,
    currentPath,
    directoryFocusedPath,
    directorySelectedPaths,
    duplicateSelectionRuleByProjectionId,
    filter,
    isFlattenView,
    isResultPanelOpen,
    lastNormalResultPanelHeightRef,
    projectionFocusedPathById,
    projectionSelectedPathsById,
    projectionTabs,
    resultPanelDisplayMode,
    resultPanelHeightPx,
    rootId,
    rootName,
  ])

  const buildDeleteUndoBatch = useCallback((
    restoreItems: DeleteUndoRestoreItem[] | undefined,
    snapshot: DeleteUndoSnapshot | null
  ): DeleteUndoBatch | null => {
    return createDeleteUndoBatch({
      id: createDeleteUndoId('delete-undo-batch'),
      createdAt: Date.now(),
      restoreItems,
      snapshot,
    })
  }, [])

  const createDeleteUndoBatchFromParams = useCallback((
    params: WorkspaceMutationCommitParams | PreviewMutationCommitParams | undefined
  ): DeleteUndoBatch | null => {
    if (!shouldCreateDeleteUndoBatchForMutation(params)) {
      return null
    }
    return buildDeleteUndoBatch(params?.undoRestoreItems, captureDeleteUndoSnapshot())
  }, [buildDeleteUndoBatch, captureDeleteUndoSnapshot])

  const pushDeleteUndoBatch = useCallback((batch: DeleteUndoBatch | null) => {
    if (!batch) {
      return
    }

    setDeleteUndoBatches((previous) => [batch, ...previous])
    showDeleteUndoNoticeMessage(`已删除 ${batch.deletedCount} 项`, 'default')
  }, [showDeleteUndoNoticeMessage])

  const restoreDeleteUndoPreviewSnapshot = useCallback((previewSnapshot: DeleteUndoPreviewSnapshot) => {
    if (previewSnapshot.showPreviewPane && previewSnapshot.selectedFile?.kind === 'file') {
      openFileInPaneOrFullscreenFallback(previewSnapshot.selectedFile)
    } else {
      closePreviewPane()
    }

    if (previewSnapshot.previewFile?.kind === 'file') {
      openFileInModal(previewSnapshot.previewFile)
    } else {
      closePreviewModal()
    }
  }, [
    closePreviewModal,
    closePreviewPane,
    openFileInModal,
    openFileInPaneOrFullscreenFallback,
  ])

  const applyDeleteUndoSnapshot = useCallback(async (snapshot: DeleteUndoSnapshot) => {
    setFilter(cloneFilterState(snapshot.filter))

    if (isFlattenView !== snapshot.isFlattenView) {
      await setFlattenView(snapshot.isFlattenView)
    }

    lastNormalResultPanelHeightRef.current = snapshot.lastNormalResultPanelHeightPx
    setResultPanelHeightPx(snapshot.resultPanelHeightPx)
    setResultPanelDisplayMode(snapshot.resultPanelDisplayMode)
    setProjectionTabs(snapshot.projectionTabs.map((projection) => cloneResultProjection(projection)))
    setActiveProjectionTabId(snapshot.activeProjectionTabId)
    setLastProjectionTabId(snapshot.activeProjectionTabId)
    setProjectionSelectedPathsById(cloneStringArrayRecord(snapshot.projectionSelectedPathsById))
    setDuplicateSelectionRuleByProjectionId(cloneDuplicateSelectionRuleRecord(snapshot.duplicateSelectionRuleByProjectionId))
    setProjectionFocusedPathById(cloneNullableStringRecord(snapshot.projectionFocusedPathById))
    setDirectorySelectedPaths([...snapshot.directorySelectedPaths])
    setDirectoryFocusedPath(snapshot.directoryFocusedPath)
    setIsResultPanelOpen(snapshot.isResultPanelOpen)
    setActiveSurface(
      snapshot.activeSurface.kind === 'projection' && snapshot.activeProjectionTabId
        ? { kind: 'projection', tabId: snapshot.activeProjectionTabId }
        : { kind: 'directory' }
    )

    restoreDeleteUndoPreviewSnapshot(snapshot.preview)
    await refreshFilterTagSnapshots()
  }, [
    isFlattenView,
    lastNormalResultPanelHeightRef,
    refreshFilterTagSnapshots,
    restoreDeleteUndoPreviewSnapshot,
    setActiveProjectionTabId,
    setActiveSurface,
    setDirectoryFocusedPath,
    setDirectorySelectedPaths,
    setDuplicateSelectionRuleByProjectionId,
    setFilter,
    setFlattenView,
    setIsResultPanelOpen,
    setLastProjectionTabId,
    setProjectionFocusedPathById,
    setProjectionSelectedPathsById,
    setProjectionTabs,
    setResultPanelDisplayMode,
    setResultPanelHeightPx,
  ])

  const handleUndoDelete = useCallback(async () => {
    const batch = deleteUndoBatches[0]
    if (!batch || isUndoingDelete) {
      return
    }

    setIsUndoingDelete(true)

    try {
      const response = await restoreDeleteUndoItemsThroughRuntime(
        batch.restoreItems,
        batch.snapshot.rootPath,
      )
      const restoreResult = resolveDeleteUndoRestoreResult({
        batch,
        remainingUndoBatches: deleteUndoBatches.slice(1),
        response,
        retryBatchMetadata: {
          id: createDeleteUndoId('delete-undo-batch'),
          createdAt: Date.now(),
        },
      })
      setDeleteUndoBatches(restoreResult.undoBatches)

      if (restoreResult.restoredCount === 0) {
        showDeleteUndoNoticeMessage('撤销删除失败，请重试', 'error')
        setIsUndoingDelete(false)
        return
      }

      for (const restoredAbsolutePath of restoreResult.restoredAbsolutePaths) {
        forgetDeletedProjectionAbsolutePath(restoredAbsolutePath)
      }

      const shouldNavigateBack = (
        rootId !== restoreResult.restoredSnapshot.historyEntry.rootId
        || normalizeRootRelativePath(currentPath) !== normalizeRootRelativePath(
          restoreResult.restoredSnapshot.historyEntry.path
        )
      )
      if (shouldNavigateBack) {
        const reopened = await openHistoryEntry(restoreResult.restoredSnapshot.historyEntry)
        if (!reopened) {
          showDeleteUndoNoticeMessage(
            restoreResult.failedRetryBatch
              ? `已恢复 ${restoreResult.restoredCount} 项，但仍有 ${restoreResult.failedRetryBatch.deletedCount} 项待重试，且无法自动跳回原目录`
              : `已恢复 ${restoreResult.restoredCount} 项，但无法自动跳回原目录`,
            'error'
          )
          setIsUndoingDelete(false)
          return
        }
      }

      setPendingDeleteUndoRestore({ snapshot: restoreResult.restoredSnapshot })
      if (restoreResult.failedRetryBatch) {
        showDeleteUndoNoticeMessage(
          `已恢复 ${restoreResult.restoredCount} 项，仍有 ${restoreResult.failedRetryBatch.deletedCount} 项撤销失败`,
          'error'
        )
      } else {
        setDeleteUndoNotice(null)
      }
    } catch (error) {
      showDeleteUndoNoticeMessage(
        error instanceof Error ? error.message : '撤销删除失败',
        'error'
      )
      setIsUndoingDelete(false)
    }
  }, [
    currentPath,
    deleteUndoBatches,
    forgetDeletedProjectionAbsolutePath,
    isUndoingDelete,
    openHistoryEntry,
    rootId,
    showDeleteUndoNoticeMessage,
  ])

  useEffect(() => {
    if (!deleteUndoNotice) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setDeleteUndoNotice((previous) => (
        previous?.id === deleteUndoNotice.id
          ? null
          : previous
      ))
    }, DELETE_UNDO_NOTICE_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [deleteUndoNotice])

  usePendingDeleteUndoRestore({
    pendingDeleteUndoRestore,
    setPendingDeleteUndoRestore,
    rootId,
    currentPath,
    applyDeleteUndoSnapshot,
    showDeleteUndoNoticeMessage,
    setIsUndoingDelete,
  })

  return {
    deleteUndoNoticeMessage: deleteUndoNotice?.message ?? null,
    deleteUndoNoticeTone: deleteUndoNotice?.tone ?? 'default',
    canUndoDelete: deleteUndoBatches.length > 0,
    isUndoingDelete,
    createDeleteUndoBatchFromParams,
    pushDeleteUndoBatch,
    handleUndoDelete,
  }
}
