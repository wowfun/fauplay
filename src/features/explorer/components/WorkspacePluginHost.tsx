import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { FileItem, ResultProjection } from '@/types'
import type { DispatchSystemToolResult } from '@/lib/actionDispatcher'
import type { RuntimeToolActionAnnotation, RuntimeToolDescriptor } from '@/lib/runtimeApi'
import { withToolScopedProjection } from '@/lib/projection'
import { PluginActionRail } from '@/features/plugin-runtime/components/PluginActionRail'
import { PluginToolResultPanel } from '@/features/plugin-runtime/components/PluginToolResultPanel'
import { PluginToolWorkbench } from '@/features/plugin-runtime/components/PluginToolWorkbench'
import { useWorkspaceFaceScanJobController } from '@/features/explorer/hooks/useWorkspaceFaceScanJobController'
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
  WORKSPACE_FACE_SCAN_ACTION,
} from '@/features/explorer/lib/workspaceFaceScanJobModel'
import {
  hasWorkbenchMetadata,
  usePluginRuntime,
} from '@/features/plugin-runtime/hooks/usePluginRuntime'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'

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
  const {
    runWorkspaceFaceScanJob,
    handleCancelResultItem,
  } = useWorkspaceFaceScanJobController({
    rootHandle,
    rootId,
    contextKey,
    setResultQueueState,
    getRequestSignature: runtime.getRequestSignature,
    onMutationCommitted,
  })

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
