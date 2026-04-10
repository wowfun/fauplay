import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { FileItem, ResultProjection } from '@/types'
import { callGatewayHttp, type GatewayToolDescriptor } from '@/lib/gateway'
import type { DispatchSystemToolResult } from '@/lib/actionDispatcher'
import { withToolScopedProjection } from '@/lib/projection'
import { ensureRootPath } from '@/lib/reveal'
import { readDeleteUndoRestoreItems } from '@/features/workspace/lib/deleteUndo'
import { PluginActionRail } from '@/features/plugin-runtime/components/PluginActionRail'
import { PluginToolResultPanel } from '@/features/plugin-runtime/components/PluginToolResultPanel'
import { PluginToolWorkbench } from '@/features/plugin-runtime/components/PluginToolWorkbench'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import {
  hasWorkbenchMetadata,
  usePluginRuntime,
} from '@/features/plugin-runtime/hooks/usePluginRuntime'
import { orderToolsWithSoftDeleteLast } from '@/features/plugin-runtime/utils/toolOrdering'
import type { PluginResultProgress, PluginResultQueueItem, PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import {
  createQueueItemId,
  enqueueLoadingResult,
  finalizeQueueItem,
  updateQueueItemProgress,
} from '@/features/plugin-runtime/utils/resultQueueState'

interface WorkspacePluginHostProps {
  tools: GatewayToolDescriptor[]
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

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
}

function resolveRelativeToolPayload(files: FileItem[]): { relativePaths: string[]; rootPath?: string } | null {
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
      if (sharedRootPath === null) {
        sharedRootPath = file.sourceRootPath.trim()
      } else if (sharedRootPath !== file.sourceRootPath.trim()) {
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

function resolveRecycleRestoreItems(files: FileItem[]): Array<Record<string, unknown>> | null {
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

function resolveAbsoluteDeletePayload(files: FileItem[]): { absolutePaths: string[] } | null {
  if (files.length === 0) return null
  const absolutePaths = files
    .map((file) => (typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''))
    .filter((item) => item)
  if (absolutePaths.length !== files.length) {
    return null
  }
  return { absolutePaths }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

const WORKSPACE_FACE_SCAN_ACTION = {
  key: 'detectVisibleAssets',
  label: '扫描当前目标媒体',
  description: '选中优先，否则扫描当前可见图片/视频；仅处理未检测资产，并执行识别聚类',
  intent: 'primary',
  arguments: {
    operation: 'detectAssets',
    onlyUndetected: true,
    runCluster: true,
    preCluster: true,
  },
}

const FACE_SCAN_JOB_SUBMIT_TIMEOUT_MS = 30000
const FACE_SCAN_JOB_POLL_TIMEOUT_MS = 15000
const FACE_SCAN_JOB_CANCEL_TIMEOUT_MS = 15000
const FACE_SCAN_JOB_POLL_INTERVAL_MS = 1000

type FaceScanJobStatus = 'queued' | 'running' | 'canceling' | 'canceled' | 'succeeded' | 'failed'

interface FaceScanJobSnapshot {
  ok?: boolean
  jobId?: string
  status?: FaceScanJobStatus
  total?: number
  unique?: number
  processed?: number
  scanned?: number
  skipped?: number
  failed?: number
  detectedFaces?: number
  currentPath?: string | null
  batchIndex?: number
  batchCount?: number
  preCluster?: unknown
  postCluster?: unknown
  recentItems?: unknown[]
  failureSummary?: unknown[]
  error?: string | null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function isFaceScanJobTerminal(status?: string): boolean {
  return status === 'canceled' || status === 'succeeded' || status === 'failed'
}

function toFaceScanJobProgress(snapshot: FaceScanJobSnapshot, overrides: Partial<PluginResultProgress> = {}): PluginResultProgress {
  const status = snapshot.status ?? 'queued'
  const current = Math.max(0, Number(snapshot.processed ?? 0))
  const total = Math.max(0, Number(snapshot.total ?? 0))
  const statusLabel = status === 'queued'
    ? '排队中'
    : status === 'running'
      ? '扫描中'
      : status === 'canceling'
        ? '取消中'
        : status === 'canceled'
          ? '已取消'
          : status === 'failed'
            ? '失败'
            : '已完成'

  return {
    jobId: snapshot.jobId,
    status,
    current,
    total,
    currentPath: typeof snapshot.currentPath === 'string' ? snapshot.currentPath : null,
    batchIndex: typeof snapshot.batchIndex === 'number' ? snapshot.batchIndex : undefined,
    batchCount: typeof snapshot.batchCount === 'number' ? snapshot.batchCount : undefined,
    scanned: Math.max(0, Number(snapshot.scanned ?? 0)),
    skipped: Math.max(0, Number(snapshot.skipped ?? 0)),
    failed: Math.max(0, Number(snapshot.failed ?? 0)),
    detectedFaces: Math.max(0, Number(snapshot.detectedFaces ?? 0)),
    cancelable: status === 'queued' || status === 'running',
    cancelRequested: status === 'canceling',
    message: `人脸扫描${statusLabel}: ${current}/${total}`,
    ...overrides,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '工具调用失败'
}

function shouldRefreshAfterFaceScanJob(snapshot: FaceScanJobSnapshot): boolean {
  return (
    Number(snapshot.processed ?? 0) > 0
    || Number(snapshot.scanned ?? 0) > 0
    || Number(snapshot.detectedFaces ?? 0) > 0
  )
}

function toFaceScanJobResult(snapshot: FaceScanJobSnapshot): Record<string, unknown> {
  return {
    ok: snapshot.status !== 'failed',
    jobId: snapshot.jobId,
    status: snapshot.status,
    total: snapshot.total ?? 0,
    unique: snapshot.unique ?? 0,
    processed: snapshot.processed ?? 0,
    scanned: snapshot.scanned ?? 0,
    skipped: snapshot.skipped ?? 0,
    failed: snapshot.failed ?? 0,
    detectedFaces: snapshot.detectedFaces ?? 0,
    preCluster: snapshot.preCluster ?? null,
    postCluster: snapshot.postCluster ?? null,
    recentItems: snapshot.recentItems ?? [],
    failureSummary: snapshot.failureSummary ?? [],
    error: snapshot.error ?? null,
  }
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
  const normalizedCurrentPath = useMemo(
    () => currentPath.split('/').filter(Boolean).join('/'),
    [currentPath]
  )
  const isTrashContext = useMemo(
    () => normalizedCurrentPath === '@trash' || normalizedCurrentPath === '.trash' || normalizedCurrentPath.startsWith('.trash/'),
    [normalizedCurrentPath]
  )
  const contextualTools = useMemo(() => {
    const filteredTools = isTrashContext
      ? tools.filter((tool) => tool.name === 'fs.restore')
      : tools.filter((tool) => tool.name !== 'fs.restore')
    return orderToolsWithSoftDeleteLast(filteredTools)
  }, [isTrashContext, tools])
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])

  const selectedEntries = useMemo(
    () => visibleFiles.filter((file) => selectedPathSet.has(file.path)),
    [selectedPathSet, visibleFiles]
  )
  const selectedEntryPaths = useMemo(
    () => selectedEntries.map((file) => file.path),
    [selectedEntries]
  )
  const selectedFileEntries = useMemo(
    () => selectedEntries.filter((file): file is FileItem => file.kind === 'file'),
    [selectedEntries]
  )
  const visibleFileEntries = useMemo(
    () => visibleFiles.filter((file): file is FileItem => file.kind === 'file'),
    [visibleFiles]
  )
  const targetFileEntries = useMemo(
    () => (selectedFileEntries.length > 0 ? selectedFileEntries : visibleFileEntries),
    [selectedFileEntries, visibleFileEntries]
  )
  const relativeTargetArgs = useMemo(
    () => resolveRelativeToolPayload(targetFileEntries),
    [targetFileEntries]
  )
  const selectedRestoreItems = useMemo(
    () => resolveRecycleRestoreItems(selectedFileEntries),
    [selectedFileEntries]
  )
  const selectedDeleteAbsoluteArgs = useMemo(
    () => (activeProjection ? resolveAbsoluteDeletePayload(selectedFileEntries) : null),
    [activeProjection, selectedFileEntries]
  )
  const hasTargets = targetFileEntries.length > 0
  const hasSelectedEntries = selectedEntries.length > 0
  const hasRenderableTargets = hasTargets || hasSelectedEntries
  const contextKey = currentPath || '/'

  const resolveToolArguments = useCallback((tool: GatewayToolDescriptor, extraArgs?: Record<string, unknown>): Record<string, unknown> | null => {
    if (tool.name === 'fs.softDelete') {
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

    if (tool.name === 'fs.restore') {
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
  }, [
    hasSelectedEntries,
    relativeTargetArgs,
    selectedDeleteAbsoluteArgs,
    selectedEntryPaths,
    selectedRestoreItems,
  ])

  const handleRuntimeMutationCommitted = useCallback(async ({ tool, result }: { tool: GatewayToolDescriptor; result: DispatchSystemToolResult }) => {
    if (!onMutationCommitted) {
      return
    }

    const mutationParams: WorkspaceMutationCommitParams = {
      mutationToolName: tool.name,
    }
    if (tool.name === 'fs.softDelete') {
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
      if (activeProjection?.id) {
        mutationParams.projectionTabId = activeProjection.id
        mutationParams.deletedProjectionPaths = selectedFileEntries.map((file) => file.path)
      }
    }
    await onMutationCommitted(mutationParams)
  }, [activeProjection?.id, onMutationCommitted, selectedDeleteAbsoluteArgs?.absolutePaths, selectedFileEntries])

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
    canRunTool: useCallback((tool: GatewayToolDescriptor) => {
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

  const runWorkspaceFaceScanJob = useCallback(async (tool: GatewayToolDescriptor, additionalArgs: Record<string, unknown>) => {
    if (!rootHandle || !rootId) return

    const providedRootPath = typeof additionalArgs.rootPath === 'string' && additionalArgs.rootPath.trim()
      ? additionalArgs.rootPath.trim()
      : ''
    const resolvedRootPath = providedRootPath || ensureRootPath({
      rootLabel: rootHandle.name || 'current-folder',
      rootId,
      promptIfMissing: true,
    })
    const requestArgs = resolvedRootPath
      ? { ...additionalArgs, rootPath: resolvedRootPath }
      : additionalArgs
    const queueItemId = createQueueItemId(tool.name)
    const startedAt = Date.now()
    const title = `${tool.title || tool.name} · ${WORKSPACE_FACE_SCAN_ACTION.label}`
    const requestSignature = runtime.getRequestSignature(tool, {
      actionKey: WORKSPACE_FACE_SCAN_ACTION.key,
      additionalArgs: requestArgs,
    }) ?? `${queueItemId}:face-scan-job`

    setResultQueueState((prev) => enqueueLoadingResult(prev, {
      queueItemId,
      contextKey,
      toolName: tool.name,
      title,
      trigger: 'manual',
      actionKey: WORKSPACE_FACE_SCAN_ACTION.key,
      requestSignature,
      startedAt,
      progress: {
        current: 0,
        total: Array.isArray(requestArgs.relativePaths) ? requestArgs.relativePaths.length : 0,
        message: '提交人脸扫描任务...',
        cancelable: false,
      },
    }))

    let latestSnapshot: FaceScanJobSnapshot | null = null
    try {
      if (!resolvedRootPath) {
        throw new Error('未设置有效 rootPath')
      }
      latestSnapshot = await callGatewayHttp<FaceScanJobSnapshot>(
        '/v1/faces/detect-assets/jobs',
        requestArgs,
        FACE_SCAN_JOB_SUBMIT_TIMEOUT_MS
      )
      if (!latestSnapshot.jobId) {
        throw new Error('Gateway 未返回人脸扫描任务 ID')
      }
      const jobId = latestSnapshot.jobId
      faceScanJobIdByQueueItemIdRef.current.set(queueItemId, jobId)
      updateFaceScanQueueProgress(queueItemId, toFaceScanJobProgress(latestSnapshot))

      while (!isFaceScanJobTerminal(latestSnapshot.status)) {
        await delay(FACE_SCAN_JOB_POLL_INTERVAL_MS)
        latestSnapshot = await callGatewayHttp<FaceScanJobSnapshot>(
          `/v1/faces/detect-assets/jobs/${encodeURIComponent(jobId)}`,
          {},
          FACE_SCAN_JOB_POLL_TIMEOUT_MS,
          'GET'
        )
        updateFaceScanQueueProgress(queueItemId, toFaceScanJobProgress(latestSnapshot))
      }

      const finishedAt = Date.now()
      const snapshot = latestSnapshot
      setResultQueueState((prev) => finalizeQueueItem(prev, snapshot.status === 'failed'
        ? {
          contextKey,
          queueItemId,
          status: 'error',
          error: snapshot.error || '人脸扫描任务失败',
          errorCode: 'FACE_SCAN_JOB_FAILED',
          finishedAt,
        }
        : {
          contextKey,
          queueItemId,
          status: 'success',
          result: toFaceScanJobResult(snapshot),
          finishedAt,
        }))

      if (onMutationCommitted && shouldRefreshAfterFaceScanJob(snapshot)) {
        await onMutationCommitted({ mutationToolName: tool.name })
      }
    } catch (error) {
      const finishedAt = Date.now()
      setResultQueueState((prev) => finalizeQueueItem(prev, {
        contextKey,
        queueItemId,
        status: 'error',
        error: toErrorMessage(error),
        errorCode: 'FACE_SCAN_JOB_ERROR',
        finishedAt,
      }))
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

  const handleCancelResultItem = useCallback(({ item }: { item: PluginResultQueueItem }) => {
    const jobId = item.progress?.jobId || faceScanJobIdByQueueItemIdRef.current.get(item.id)
    if (!jobId) return
    updateFaceScanQueueProgress(item.id, {
      jobId,
      cancelRequested: true,
      cancelable: false,
      message: '正在取消人脸扫描任务...',
    })
    void callGatewayHttp<FaceScanJobSnapshot>(
      `/v1/faces/detect-assets/jobs/${encodeURIComponent(jobId)}/cancel`,
      {},
      FACE_SCAN_JOB_CANCEL_TIMEOUT_MS
    )
      .then((snapshot) => {
        updateFaceScanQueueProgress(item.id, toFaceScanJobProgress(snapshot, {
          cancelRequested: snapshot.status === 'canceling',
        }))
      })
      .catch((error) => {
        updateFaceScanQueueProgress(item.id, {
          jobId,
          cancelRequested: false,
          cancelable: true,
          message: `取消失败：${toErrorMessage(error)}`,
        })
      })
  }, [updateFaceScanQueueProgress])

  const toolByName = useMemo(() => {
    const map = new Map<string, GatewayToolDescriptor>()
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
    const latestDuplicateResult = runtime.currentQueue.find((item) => (
      item.toolName === 'data.findDuplicateFiles'
      && item.status === 'success'
    ))
    const autoProjectionItem = runtime.currentQueue.find((item) => (
      item.status === 'success'
      && item.projection?.entry === 'auto'
      && !(
        item.toolName === 'data.findDuplicateFiles'
        && latestDuplicateResult
        && latestDuplicateResult.id !== item.id
        && !latestDuplicateResult.projection
      )
    ))
    if (!autoProjectionItem?.projection) return
    if (handledAutoProjectionIdRef.current === autoProjectionItem.id) return
    handledAutoProjectionIdRef.current = autoProjectionItem.id
    onActivateProjection(withToolScopedProjection(autoProjectionItem.projection, autoProjectionItem.toolName))
  }, [onActivateProjection, runtime.currentQueue])

  useEffect(() => {
    const latestDuplicateResult = runtime.currentQueue.find((item) => (
      item.toolName === 'data.findDuplicateFiles'
      && item.status === 'success'
    ))
    if (!latestDuplicateResult) return
    if (latestDuplicateResult.projection) return
    if (handledDuplicateProjectionDismissResultIdRef.current === latestDuplicateResult.id) return

    handledDuplicateProjectionDismissResultIdRef.current = latestDuplicateResult.id
    onDismissProjectionTool(latestDuplicateResult.toolName)
  }, [onDismissProjectionTool, runtime.currentQueue])

  const handleWorkbenchRunAction = useCallback((tool: GatewayToolDescriptor, action: Parameters<typeof runtime.handleRunWorkbenchAction>[1]) => {
    const additionalArgs = resolveToolArguments(tool, action.arguments)
    if (!additionalArgs) return
    runtime.handleWorkbenchContextChange(tool.name)
    if (tool.name === 'vision.face' && action.key === WORKSPACE_FACE_SCAN_ACTION.key) {
      void runWorkspaceFaceScanJob(tool, additionalArgs)
      return
    }
    void runtime.runToolCall(tool, {
      trigger: 'manual',
      actionKey: action.key,
      actionLabel: action.label,
      additionalArgs,
    })
  }, [resolveToolArguments, runWorkspaceFaceScanJob, runtime])

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
        if (!additionalArgs) return
        runtime.handleWorkbenchContextChange(tool.name)
        if (tool.name === 'vision.face') {
          void runWorkspaceFaceScanJob(tool, additionalArgs)
          return
        }
        void runtime.runToolCall(tool, {
          trigger: 'manual',
          additionalArgs,
        })
      },
    }))
  ), [resolveToolArguments, runWorkspaceFaceScanJob, runtime, toolByName])

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
          if (!additionalArgs) return
          runtime.handleWorkbenchContextChange(toolItem.name)
          if (toolItem.name === 'vision.face' && additionalArgs.operation === 'detectAssets') {
            void runWorkspaceFaceScanJob(toolItem, additionalArgs)
            return
          }
          void runtime.runToolCall(toolItem, {
            trigger: 'manual',
            actionLabel: params.actionLabel,
            additionalArgs,
          })
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
