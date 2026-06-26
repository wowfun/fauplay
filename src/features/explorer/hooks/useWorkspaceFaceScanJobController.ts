import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { ensureRootPath } from '@/lib/reveal'
import { callRuntimeHttp, type RuntimeToolDescriptor } from '@/lib/runtimeApi'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import {
  FACE_SCAN_JOB_CANCEL_TIMEOUT_MS,
  FACE_SCAN_JOB_POLL_INTERVAL_MS,
  FACE_SCAN_JOB_POLL_TIMEOUT_MS,
  FACE_SCAN_JOB_SUBMIT_TIMEOUT_MS,
  type FaceScanJobSnapshot,
  WORKSPACE_FACE_SCAN_ACTION,
  isWorkspaceFaceScanJobTerminal,
  readWorkspaceFaceScanProvidedRootPath,
  resolveWorkspaceFaceScanJobCancelPlan,
  resolveWorkspaceFaceScanJobErrorPlan,
  resolveWorkspaceFaceScanJobFinishPlan,
  resolveWorkspaceFaceScanJobPollPath,
  resolveWorkspaceFaceScanJobStartPlan,
  shouldRefreshAfterWorkspaceFaceScanJob,
  toWorkspaceFaceScanJobErrorMessage,
  toWorkspaceFaceScanJobProgress,
} from '@/features/explorer/lib/workspaceFaceScanJobModel'
import type { PluginResultProgress, PluginResultQueueItem, PluginResultQueueState } from '@/features/plugin-runtime/types'
import {
  createQueueItemId,
  enqueueLoadingResult,
  finalizeQueueItem,
  updateQueueItemProgress,
} from '@/features/plugin-runtime/utils/resultQueueState'

interface UseWorkspaceFaceScanJobControllerParams {
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  contextKey: string
  setResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  getRequestSignature: (
    tool: RuntimeToolDescriptor,
    params?: { actionKey?: string; additionalArgs?: Record<string, unknown> }
  ) => string | null
  onMutationCommitted?: (params?: WorkspaceMutationCommitParams) => void | Promise<void>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function useWorkspaceFaceScanJobController({
  rootHandle,
  rootId,
  contextKey,
  setResultQueueState,
  getRequestSignature,
  onMutationCommitted,
}: UseWorkspaceFaceScanJobControllerParams) {
  const faceScanJobIdByQueueItemIdRef = useRef(new Map<string, string>())

  const updateFaceScanQueueProgress = useCallback((queueItemId: string, progress: PluginResultProgress) => {
    setResultQueueState((prev) => updateQueueItemProgress(prev, {
      contextKey,
      queueItemId,
      progress,
    }))
  }, [contextKey, setResultQueueState])

  const runWorkspaceFaceScanJob = useCallback(async (
    tool: RuntimeToolDescriptor,
    additionalArgs: Record<string, unknown>,
  ) => {
    if (!rootHandle || !rootId) return

    const providedRootPath = readWorkspaceFaceScanProvidedRootPath(additionalArgs)
    const resolvedRootPath = providedRootPath || ensureRootPath({
      rootLabel: rootHandle.name || 'current-folder',
      rootId,
      promptIfMissing: true,
    })
    const queueItemId = createQueueItemId(tool.name)
    const startedAt = Date.now()
    const startPlan = resolveWorkspaceFaceScanJobStartPlan({
      toolName: tool.name,
      toolTitle: tool.title,
      actionLabel: WORKSPACE_FACE_SCAN_ACTION.label,
      additionalArgs,
      resolvedRootPath: resolvedRootPath ?? '',
      queueItemId,
      startedAt,
      requestSignature: null,
    })
    const requestSignature = getRequestSignature(tool, {
      actionKey: WORKSPACE_FACE_SCAN_ACTION.key,
      additionalArgs: startPlan.requestArgs,
    }) ?? startPlan.requestSignature

    setResultQueueState((prev) => enqueueLoadingResult(prev, {
      queueItemId: startPlan.queueItemId,
      contextKey,
      toolName: tool.name,
      title: startPlan.title,
      trigger: 'manual',
      actionKey: WORKSPACE_FACE_SCAN_ACTION.key,
      requestSignature,
      startedAt: startPlan.startedAt,
      progress: startPlan.initialProgress,
    }))

    let latestSnapshot: FaceScanJobSnapshot | null = null
    try {
      if (startPlan.missingRootPathError) {
        throw new Error(startPlan.missingRootPathError)
      }
      latestSnapshot = await callRuntimeHttp<FaceScanJobSnapshot>(
        '/v1/faces/detect-assets/jobs',
        startPlan.requestArgs,
        FACE_SCAN_JOB_SUBMIT_TIMEOUT_MS
      )
      if (!latestSnapshot.jobId) {
        throw new Error('Runtime 未返回人脸扫描任务 ID')
      }
      const jobId = latestSnapshot.jobId
      faceScanJobIdByQueueItemIdRef.current.set(queueItemId, jobId)
      updateFaceScanQueueProgress(queueItemId, toWorkspaceFaceScanJobProgress(latestSnapshot))

      while (!isWorkspaceFaceScanJobTerminal(latestSnapshot.status)) {
        await delay(FACE_SCAN_JOB_POLL_INTERVAL_MS)
        latestSnapshot = await callRuntimeHttp<FaceScanJobSnapshot>(
          resolveWorkspaceFaceScanJobPollPath(jobId),
          {},
          FACE_SCAN_JOB_POLL_TIMEOUT_MS,
          'GET'
        )
        updateFaceScanQueueProgress(queueItemId, toWorkspaceFaceScanJobProgress(latestSnapshot))
      }

      const finishedAt = Date.now()
      const snapshot = latestSnapshot
      setResultQueueState((prev) => finalizeQueueItem(prev, resolveWorkspaceFaceScanJobFinishPlan({
        contextKey,
        queueItemId,
        snapshot,
        finishedAt,
      })))

      if (onMutationCommitted && shouldRefreshAfterWorkspaceFaceScanJob(snapshot)) {
        await onMutationCommitted({ mutationToolName: tool.name })
      }
    } catch (error) {
      const finishedAt = Date.now()
      setResultQueueState((prev) => finalizeQueueItem(prev, resolveWorkspaceFaceScanJobErrorPlan({
        contextKey,
        queueItemId,
        error,
        finishedAt,
      })))
    } finally {
      faceScanJobIdByQueueItemIdRef.current.delete(queueItemId)
    }
  }, [
    contextKey,
    getRequestSignature,
    onMutationCommitted,
    rootHandle,
    rootId,
    setResultQueueState,
    updateFaceScanQueueProgress,
  ])

  const handleCancelResultItem = useCallback(({ item }: { item: PluginResultQueueItem }) => {
    const cancelPlan = resolveWorkspaceFaceScanJobCancelPlan({
      item,
      trackedJobId: faceScanJobIdByQueueItemIdRef.current.get(item.id),
    })
    if (!cancelPlan) return
    updateFaceScanQueueProgress(item.id, cancelPlan.cancelProgress)
    void callRuntimeHttp<FaceScanJobSnapshot>(
      cancelPlan.endpointPath,
      {},
      FACE_SCAN_JOB_CANCEL_TIMEOUT_MS
    )
      .then((snapshot) => {
        updateFaceScanQueueProgress(item.id, toWorkspaceFaceScanJobProgress(snapshot, {
          cancelRequested: snapshot.status === 'canceling',
        }))
      })
      .catch((error) => {
        updateFaceScanQueueProgress(item.id, {
          jobId: cancelPlan.jobId,
          cancelRequested: false,
          cancelable: true,
          message: `取消失败：${toWorkspaceFaceScanJobErrorMessage(error)}`,
        })
      })
  }, [updateFaceScanQueueProgress])

  return {
    runWorkspaceFaceScanJob,
    handleCancelResultItem,
  }
}
