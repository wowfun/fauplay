import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { FileItem, ResultProjection } from '@/types'
import type { DispatchSystemToolResult } from '@/lib/actionDispatcher'
import { callRuntimeHttp, type RuntimeToolActionAnnotation, type RuntimeToolDescriptor } from '@/lib/runtimeApi'
import { withToolScopedProjection } from '@/lib/projection'
import { ensureRootPath } from '@/lib/reveal'
import { PluginActionRail } from '@/features/plugin-runtime/components/PluginActionRail'
import { PluginToolResultPanel } from '@/features/plugin-runtime/components/PluginToolResultPanel'
import { PluginToolWorkbench } from '@/features/plugin-runtime/components/PluginToolWorkbench'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import {
  resolveWorkspaceContextualTools,
  resolveWorkspaceMutationCommitParams,
  resolveWorkspacePluginDuplicateProjectionDismissIntent,
  resolveWorkspacePluginProjectionActivationIntent,
  resolveWorkspaceToolArguments,
  resolveWorkspaceToolTargetState,
  resolveWorkspaceToolRunPlan,
  type WorkspaceToolRunPlan,
} from '@/features/explorer/lib/workspacePluginHostModel'
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
import {
  hasWorkbenchMetadata,
  usePluginRuntime,
} from '@/features/plugin-runtime/hooks/usePluginRuntime'
import type { PluginResultProgress, PluginResultQueueItem, PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import {
  createQueueItemId,
  enqueueLoadingResult,
  finalizeQueueItem,
  updateQueueItemProgress,
} from '@/features/plugin-runtime/utils/resultQueueState'

interface WorkspacePluginHostProps {
  tools: RuntimeToolDescriptor[]
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  currentPath: string
  visibleFiles: FileItem[]
  selectedPaths: string[]
  resultQueueState: PluginResultQueueState
  setResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  workbenchState: PluginWorkbenchState
  setWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  onMutationCommitted?: (params?: WorkspaceMutationCommitParams) => void | Promise<void>
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
  onDismissProjectionTool: (toolName: string) => void
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  toolPanelWidthPx: number
  onToolPanelWidthChange: (nextWidthPx: number) => void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function WorkspacePluginHost({
  tools,
  rootHandle,
  rootId,
  currentPath,
  visibleFiles,
  selectedPaths,
  resultQueueState,
  setResultQueueState,
  workbenchState,
  setWorkbenchState,
  onMutationCommitted,
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
  toolPanelCollapsed,
  onToggleToolPanelCollapsed,
  toolPanelWidthPx,
  onToolPanelWidthChange,
}: WorkspacePluginHostProps) {
  const handledDuplicateProjectionDismissResultIdRef = useRef<string | null>(null)
  const faceScanJobIdByQueueItemIdRef = useRef(new Map<string, string>())
  const contextualTools = useMemo(() => resolveWorkspaceContextualTools({
    currentPath,
    tools,
  }), [currentPath, tools])
  const {
    selectedEntryPaths,
    selectedFileEntries,
    relativeTargetArgs,
    selectedRestoreItems,
    selectedDeleteAbsoluteArgs,
    hasTargets,
    hasSelectedEntries,
    hasRenderableTargets,
  } = useMemo(() => resolveWorkspaceToolTargetState({
    visibleFiles,
    selectedPaths,
    hasActiveProjection: Boolean(activeProjection),
  }), [activeProjection, selectedPaths, visibleFiles])
  const contextKey = currentPath || '/'

  const resolveToolArguments = useCallback((tool: RuntimeToolDescriptor, extraArgs?: Record<string, unknown>): Record<string, unknown> | null => {
    return resolveWorkspaceToolArguments({
      toolName: tool.name,
      hasSelectedEntries,
      selectedEntryPaths,
      selectedDeleteAbsoluteArgs,
      selectedRestoreItems,
      relativeTargetArgs,
      extraArgs,
    })
  }, [
    hasSelectedEntries,
    relativeTargetArgs,
    selectedDeleteAbsoluteArgs,
    selectedEntryPaths,
    selectedRestoreItems,
  ])

  const handleRuntimeMutationCommitted = useCallback(async ({ tool, result }: { tool: RuntimeToolDescriptor; result: DispatchSystemToolResult }) => {
    if (!onMutationCommitted) {
      return
    }

    const mutationParams = resolveWorkspaceMutationCommitParams({
      toolName: tool.name,
      result,
      selectedDeleteAbsoluteArgs,
      activeProjectionId: activeProjection?.id,
      selectedFileEntries,
    })
    await onMutationCommitted(mutationParams)
  }, [activeProjection?.id, onMutationCommitted, selectedDeleteAbsoluteArgs, selectedFileEntries])

  const runtime = usePluginRuntime({
    scope: 'workspace',
    tools: contextualTools,
    contextKey,
    rootHandle,
    rootId,
    resultQueueState,
    setResultQueueState,
    workbenchState,
    setWorkbenchState,
    buildBaseArguments: useCallback(() => ({}), []),
    canRunTool: useCallback((tool: RuntimeToolDescriptor) => {
      if (tool.name === 'fs.softDelete' || tool.name === 'fs.restore') {
        return hasSelectedEntries
      }
      return hasTargets && relativeTargetArgs !== null
    }, [hasSelectedEntries, hasTargets, relativeTargetArgs]),
    onMutationCommitted: onMutationCommitted ? handleRuntimeMutationCommitted : undefined,
  })

  const updateFaceScanQueueProgress = useCallback((queueItemId: string, progress: PluginResultProgress) => {
    setResultQueueState((prev) => updateQueueItemProgress(prev, {
      contextKey,
      queueItemId,
      progress,
    }))
  }, [contextKey, setResultQueueState])

  const runWorkspaceFaceScanJob = useCallback(async (tool: RuntimeToolDescriptor, additionalArgs: Record<string, unknown>) => {
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
    const requestSignature = runtime.getRequestSignature(tool, {
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
    onMutationCommitted,
    rootHandle,
    rootId,
    runtime,
    setResultQueueState,
    updateFaceScanQueueProgress,
  ])

  const runWorkspaceToolPlan = useCallback((tool: RuntimeToolDescriptor, plan: WorkspaceToolRunPlan) => {
    if (plan.kind === 'none') return
    runtime.handleWorkbenchContextChange(tool.name)
    if (plan.kind === 'face-scan-job') {
      void runWorkspaceFaceScanJob(tool, plan.additionalArgs)
      return
    }
    void runtime.runToolCall(tool, {
      trigger: 'manual',
      actionKey: plan.actionKey,
      actionLabel: plan.actionLabel,
      additionalArgs: plan.additionalArgs,
    })
  }, [runWorkspaceFaceScanJob, runtime])

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

  const toolByName = useMemo(() => {
    const map = new Map<string, RuntimeToolDescriptor>()
    for (const tool of runtime.scopedTools) {
      map.set(tool.name, tool)
    }
    return map
  }, [runtime.scopedTools])
  const handledAutoProjectionIdRef = useRef<string | null>(null)

  useEffect(() => {
    handledAutoProjectionIdRef.current = null
    handledDuplicateProjectionDismissResultIdRef.current = null
  }, [contextKey])

  useEffect(() => {
    const intent = resolveWorkspacePluginProjectionActivationIntent({
      queueItems: runtime.currentQueue,
      handledResultId: handledAutoProjectionIdRef.current,
    })
    if (intent.kind !== 'activate') return

    handledAutoProjectionIdRef.current = intent.resultId
    onActivateProjection(withToolScopedProjection(intent.projection, intent.toolName))
  }, [onActivateProjection, runtime.currentQueue])

  useEffect(() => {
    const intent = resolveWorkspacePluginDuplicateProjectionDismissIntent({
      queueItems: runtime.currentQueue,
      handledResultId: handledDuplicateProjectionDismissResultIdRef.current,
    })
    if (intent.kind !== 'dismiss') return

    handledDuplicateProjectionDismissResultIdRef.current = intent.resultId
    onDismissProjectionTool(intent.toolName)
  }, [onDismissProjectionTool, runtime.currentQueue])

  const handleWorkbenchRunAction = useCallback((tool: RuntimeToolDescriptor, action: RuntimeToolActionAnnotation) => {
    const additionalArgs = resolveToolArguments(tool, action.arguments)
    runWorkspaceToolPlan(tool, resolveWorkspaceToolRunPlan({
      source: 'workbench-action',
      toolName: tool.name,
      actionKey: action.key,
      actionLabel: action.label,
      additionalArgs,
    }))
  }, [resolveToolArguments, runWorkspaceToolPlan])

  const railActions = useMemo(() => (
    runtime.railActions.map((action) => ({
      ...action,
      onClick: () => {
        const tool = toolByName.get(action.toolName)
        if (!tool) return
        const additionalArgs = resolveToolArguments(
          tool,
          tool.name === 'vision.face' ? WORKSPACE_FACE_SCAN_ACTION.arguments : undefined
        )
        runWorkspaceToolPlan(tool, resolveWorkspaceToolRunPlan({
          source: 'rail',
          toolName: tool.name,
          additionalArgs,
        }))
      },
    }))
  ), [resolveToolArguments, runWorkspaceToolPlan, runtime.railActions, toolByName])

  const activeTool = useMemo(() => {
    const tool = runtime.activeWorkbenchTool
    if (!tool) return null
    if (tool.name !== 'vision.face') return tool
    return {
      ...tool,
      toolActions: [
        WORKSPACE_FACE_SCAN_ACTION,
        ...tool.toolActions,
      ],
    }
  }, [runtime.activeWorkbenchTool])

  if (runtime.scopedTools.length === 0) {
    return null
  }

  const workbenchNode = activeTool && hasWorkbenchMetadata(activeTool)
    ? (
      <PluginToolWorkbench
        tool={activeTool}
        optionValues={workbenchState.optionValuesByTool[activeTool.name]}
        onOptionChange={runtime.handleWorkbenchOptionChange}
        onRunAction={handleWorkbenchRunAction}
        onRunCustomToolCall={(toolItem, params) => {
          const additionalArgs = resolveToolArguments(toolItem, params.additionalArgs)
          runWorkspaceToolPlan(toolItem, resolveWorkspaceToolRunPlan({
            source: 'custom-tool-call',
            toolName: toolItem.name,
            actionLabel: params.actionLabel,
            additionalArgs,
          }))
        }}
        rootId={rootId}
        annotationTargetPath={null}
        surfaceVariant="workspace-grid"
        subzone="WorkspaceToolWorkbench"
      />
    )
    : null

  return (
    <>
      {!toolPanelCollapsed && (
        <PluginToolResultPanel
          workbench={workbenchNode}
          items={runtime.currentQueue}
          onToggleItemCollapsed={runtime.handleToggleResultItemCollapsed}
          onActivateProjection={({ item }) => {
            if (item.projection) {
              onActivateProjection(withToolScopedProjection(item.projection, item.toolName))
            }
          }}
          onCancelItem={handleCancelResultItem}
          activeProjectionId={activeProjection?.id ?? null}
          surfaceVariant="workspace-grid"
          side="right"
          subzone="WorkspaceToolResultPanel"
          emptyHint={hasRenderableTargets ? '点击右侧工具按钮后，结果会显示在这里。' : '当前目录没有可处理项目。'}
          panelWidthPx={toolPanelWidthPx}
          minPanelWidthPx={320}
          maxPanelWidthPx={640}
          onPanelWidthChange={onToolPanelWidthChange}
        />
      )}
      <PluginActionRail
        actions={railActions}
        surfaceVariant="workspace-grid"
        side="right"
        subzone="WorkspaceActionRail"
        onActionHoverChange={runtime.handleWorkbenchContextChange}
        panelToggle={{
          collapsed: toolPanelCollapsed,
          onToggle: onToggleToolPanelCollapsed,
          expandLabel: '展开工作区工具面板',
          collapseLabel: '收起工作区工具面板',
        }}
      />
    </>
  )
}
