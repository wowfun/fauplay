import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { CONTINUOUS_CALL_OPTION_KEY, toolContinuousCallConfig, toEffectiveMaxContinuousConcurrent } from '@/config/toolContinuousCall'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { FileItem } from '@/types'
import { PluginActionRail } from '@/features/plugin-runtime/components/PluginActionRail'
import { PluginToolResultPanel } from '@/features/plugin-runtime/components/PluginToolResultPanel'
import { PluginToolWorkbench } from '@/features/plugin-runtime/components/PluginToolWorkbench'
import {
  hasWorkbenchMetadata,
  isBooleanToolOptionEnabled,
  usePluginRuntime,
} from '@/features/plugin-runtime/hooks/usePluginRuntime'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'

interface PreviewPluginHostProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  previewActionTools: GatewayToolDescriptor[]
  previewViewState: 'loading' | 'error' | 'ready' | 'empty'
  surfaceVariant: 'preview-lightbox' | 'preview-panel'
  toolResultQueueState: PluginResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  toolWorkbenchState: PluginWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
}

interface ContinuousToolTask {
  key: string
  tool: GatewayToolDescriptor
}

export function PreviewPluginHost({
  file,
  rootHandle,
  previewActionTools,
  previewViewState,
  surfaceVariant,
  toolResultQueueState,
  setToolResultQueueState,
  toolWorkbenchState,
  setToolWorkbenchState,
  enableContinuousAutoRunOwner,
}: PreviewPluginHostProps) {
  const continuousTaskQueueRef = useRef<ContinuousToolTask[]>([])
  const continuousTaskKeySetRef = useRef<Set<string>>(new Set())
  const continuousInFlightCountRef = useRef(0)

  const pluginRuntime = usePluginRuntime({
    scope: 'file',
    tools: previewActionTools,
    contextKey: file.path,
    rootHandle,
    resultQueueState: toolResultQueueState,
    setResultQueueState: setToolResultQueueState,
    workbenchState: toolWorkbenchState,
    setWorkbenchState: setToolWorkbenchState,
    buildBaseArguments: useCallback(() => {
      if (file.kind !== 'file') return null
      return { relativePath: file.path }
    }, [file.kind, file.path]),
    canRunTool: useCallback(() => file.kind === 'file', [file.kind]),
  })

  const fileActionTools = pluginRuntime.scopedTools
  const currentFileQueue = pluginRuntime.currentQueue
  const showActionRail = fileActionTools.length > 0
  const showResultPanel = fileActionTools.length > 0
  const maxContinuousConcurrent = useMemo(
    () => toEffectiveMaxContinuousConcurrent(toolContinuousCallConfig.maxConcurrent),
    []
  )

  const continuousEnabledToolNames = useMemo(
    () => new Set(
      fileActionTools
        .filter((tool) => isBooleanToolOptionEnabled(tool, CONTINUOUS_CALL_OPTION_KEY, toolWorkbenchState.optionValuesByTool))
        .map((tool) => tool.name)
    ),
    [fileActionTools, toolWorkbenchState.optionValuesByTool]
  )

  const processContinuousQueue = useCallback(() => {
    if (!enableContinuousAutoRunOwner) return

    while (
      continuousInFlightCountRef.current < maxContinuousConcurrent
      && continuousTaskQueueRef.current.length > 0
    ) {
      const nextTask = continuousTaskQueueRef.current.shift()
      if (!nextTask) return

      if (pluginRuntime.hasCompletedRequest(nextTask.tool.name, nextTask.key)) {
        continuousTaskKeySetRef.current.delete(nextTask.key)
        continue
      }

      continuousInFlightCountRef.current += 1
      void pluginRuntime.runToolCall(nextTask.tool, {
        trigger: 'continuous',
        requestSignature: nextTask.key,
        skipIfAlreadyCompleted: true,
      }).finally(() => {
        continuousInFlightCountRef.current = Math.max(0, continuousInFlightCountRef.current - 1)
        continuousTaskKeySetRef.current.delete(nextTask.key)
        processContinuousQueue()
      })
    }
  }, [enableContinuousAutoRunOwner, maxContinuousConcurrent, pluginRuntime])

  const enqueueContinuousTasks = useCallback((tools: GatewayToolDescriptor[]) => {
    if (!enableContinuousAutoRunOwner) return

    for (const tool of tools) {
      const requestSignature = pluginRuntime.getRequestSignature(tool)
      if (!requestSignature) continue

      if (pluginRuntime.hasCompletedRequest(tool.name, requestSignature)) continue
      if (continuousTaskKeySetRef.current.has(requestSignature)) continue

      continuousTaskKeySetRef.current.add(requestSignature)
      continuousTaskQueueRef.current.push({
        key: requestSignature,
        tool,
      })
    }

    processContinuousQueue()
  }, [enableContinuousAutoRunOwner, pluginRuntime, processContinuousQueue])

  useEffect(() => {
    setToolResultQueueState((prev) => {
      if (!prev.byContextKey[file.path]) return prev
      if (prev.contextOrder[0] === file.path) return prev
      return {
        ...prev,
        contextOrder: [file.path, ...prev.contextOrder.filter((item) => item !== file.path)],
      }
    })
  }, [file.path, setToolResultQueueState])

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    if (file.kind !== 'file' || !rootHandle) return
    if (previewViewState !== 'ready') return

    const continuousTools = fileActionTools.filter((tool) => continuousEnabledToolNames.has(tool.name))
    if (continuousTools.length === 0) return

    enqueueContinuousTasks(continuousTools)
  }, [
    continuousEnabledToolNames,
    enableContinuousAutoRunOwner,
    enqueueContinuousTasks,
    file.kind,
    fileActionTools,
    previewViewState,
    rootHandle,
  ])

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    processContinuousQueue()
  }, [enableContinuousAutoRunOwner, processContinuousQueue])

  const railActions = useMemo(
    () => pluginRuntime.railActions.map((action) => ({
      ...action,
      highlighted: continuousEnabledToolNames.has(action.toolName),
    })),
    [continuousEnabledToolNames, pluginRuntime.railActions]
  )

  const workbenchNode = useMemo(() => {
    const tool = pluginRuntime.activeWorkbenchTool
    if (!tool || !hasWorkbenchMetadata(tool)) return null

    return (
      <PluginToolWorkbench
        tool={tool}
        optionValues={toolWorkbenchState.optionValuesByTool[tool.name]}
        onOptionChange={pluginRuntime.handleWorkbenchOptionChange}
        onRunAction={pluginRuntime.handleRunWorkbenchAction}
        surfaceVariant={surfaceVariant}
        subzone="PreviewToolWorkbench"
      />
    )
  }, [
    pluginRuntime.activeWorkbenchTool,
    pluginRuntime.handleRunWorkbenchAction,
    pluginRuntime.handleWorkbenchOptionChange,
    surfaceVariant,
    toolWorkbenchState.optionValuesByTool,
  ])

  if (!showActionRail && !showResultPanel) {
    return null
  }

  return (
    <>
      {showActionRail && (
        <PluginActionRail
          actions={railActions}
          surfaceVariant={surfaceVariant}
          side="left"
          subzone="PreviewActionRail"
          onActionHoverChange={pluginRuntime.handleWorkbenchContextChange}
        />
      )}

      {showResultPanel && (
        <PluginToolResultPanel
          workbench={workbenchNode}
          items={currentFileQueue}
          onToggleItemCollapsed={pluginRuntime.handleToggleResultItemCollapsed}
          surfaceVariant={surfaceVariant}
          side="left"
          subzone="PreviewToolResultPanel"
          emptyHint="点击左侧工具按钮后，结果会显示在这里。"
        />
      )}
    </>
  )
}
