import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { keyboardShortcuts } from '@/config/shortcuts'
import { CONTINUOUS_CALL_OPTION_KEY, toolContinuousCallConfig, toEffectiveMaxContinuousConcurrent } from '@/config/toolContinuousCall'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import type { FileItem } from '@/types'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import { PluginActionRail } from '@/features/plugin-runtime/components/PluginActionRail'
import type { StructuredToolCallAction } from '@/features/plugin-runtime/components/PluginResultStructuredView'
import { PluginToolResultPanel } from '@/features/plugin-runtime/components/PluginToolResultPanel'
import { PluginToolWorkbench } from '@/features/plugin-runtime/components/PluginToolWorkbench'
import {
  hasWorkbenchMetadata,
  isBooleanToolOptionEnabled,
  usePluginRuntime,
} from '@/features/plugin-runtime/hooks/usePluginRuntime'
import { orderToolsWithSoftDeleteLast } from '@/features/plugin-runtime/utils/toolOrdering'
import { resolveActiveDigitAssignment } from '@/features/plugin-runtime/utils/annotationSchema'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'

interface PreviewPluginHostProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  previewActionTools: GatewayToolDescriptor[]
  previewViewState: 'loading' | 'error' | 'ready' | 'empty'
  surfaceVariant: 'preview-lightbox' | 'preview-panel'
  toolResultQueueState: PluginResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  toolWorkbenchState: PluginWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  onMutationCommitted?: (params?: PreviewMutationCommitParams) => void | Promise<void>
}

interface ContinuousToolTask {
  key: string
  tool: GatewayToolDescriptor
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

export function PreviewPluginHost({
  file,
  rootHandle,
  rootId,
  previewActionTools,
  previewViewState,
  surfaceVariant,
  toolResultQueueState,
  setToolResultQueueState,
  toolWorkbenchState,
  setToolWorkbenchState,
  enableContinuousAutoRunOwner,
  toolPanelCollapsed,
  onToggleToolPanelCollapsed,
  onMutationCommitted,
}: PreviewPluginHostProps) {
  const continuousTaskQueueRef = useRef<ContinuousToolTask[]>([])
  const continuousTaskKeySetRef = useRef<Set<string>>(new Set())
  const continuousInFlightCountRef = useRef(0)
  const normalizedFilePath = useMemo(
    () => file.path.split('/').filter(Boolean).join('/'),
    [file.path]
  )
  const isTrashContext = useMemo(
    () => normalizedFilePath === '.trash' || normalizedFilePath.startsWith('.trash/'),
    [normalizedFilePath]
  )
  const contextualTools = useMemo(() => {
    const filteredTools = previewActionTools.filter((tool) => {
      if (tool.name === 'fs.softDelete') return !isTrashContext
      if (tool.name === 'fs.restore') return isTrashContext
      return true
    })
    return orderToolsWithSoftDeleteLast(filteredTools)
  }, [isTrashContext, previewActionTools])

  const pluginRuntime = usePluginRuntime({
    scope: 'file',
    tools: contextualTools,
    contextKey: file.path,
    rootHandle,
    rootId,
    resultQueueState: toolResultQueueState,
    setResultQueueState: setToolResultQueueState,
    workbenchState: toolWorkbenchState,
    setWorkbenchState: setToolWorkbenchState,
    buildBaseArguments: useCallback(() => {
      if (file.kind !== 'file') return null
      return { relativePath: file.path }
    }, [file.kind, file.path]),
    canRunTool: useCallback(() => file.kind === 'file', [file.kind]),
    onMutationCommitted: onMutationCommitted
      ? async ({ tool, result }) => {
        const mutationParams: PreviewMutationCommitParams = {
          mutationToolName: tool.name,
        }
        if (tool.name === 'fs.softDelete') {
          mutationParams.deletedRelativePath = readFirstResultRelativePath(result.result) ?? file.path
        }
        await onMutationCommitted(mutationParams)
      }
      : undefined,
  })
  const runToolCall = pluginRuntime.runToolCall

  const fileActionTools = pluginRuntime.scopedTools
  const toolByName = useMemo(() => {
    const map = new Map<string, GatewayToolDescriptor>()
    for (const tool of fileActionTools) {
      map.set(tool.name, tool)
    }
    return map
  }, [fileActionTools])
  const softDeleteTool = useMemo(
    () => fileActionTools.find((tool) => tool.name === 'fs.softDelete') ?? null,
    [fileActionTools]
  )
  const annotationTool = useMemo(
    () => fileActionTools.find((tool) => tool.name === 'meta.annotation') ?? null,
    [fileActionTools]
  )
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

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    if (file.kind !== 'file') return
    if (!softDeleteTool) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.repeat) return
      if (isTypingTarget(event.target)) return
      if (!matchesAnyShortcut(event, keyboardShortcuts.preview.softDelete)) return

      event.preventDefault()
      void runToolCall(softDeleteTool, {
        trigger: 'manual',
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enableContinuousAutoRunOwner, file.kind, runToolCall, softDeleteTool])

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    if (file.kind !== 'file') return
    if (!annotationTool) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.repeat) return
      if (isTypingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (!matchesAnyShortcut(event, keyboardShortcuts.preview.annotationAssignByDigit)) return

      const digit = event.key
      if (!/^[0-9]$/.test(digit)) return

      const assignment = resolveActiveDigitAssignment(rootId)
      if (!assignment) return
      const value = assignment.valueByDigit[digit]
      if (!value) return

      event.preventDefault()
      void runToolCall(annotationTool, {
        trigger: 'manual',
        actionLabel: `${assignment.fieldKey}=${value}`,
        additionalArgs: {
          operation: 'setValue',
          fieldKey: assignment.fieldKey,
          value,
          source: 'hotkey',
        },
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [annotationTool, enableContinuousAutoRunOwner, file.kind, rootId, runToolCall])

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
        onRunCustomToolCall={(toolItem, params) => {
          pluginRuntime.handleWorkbenchContextChange(toolItem.name)
          void pluginRuntime.runToolCall(toolItem, {
            trigger: 'manual',
            actionLabel: params.actionLabel,
            additionalArgs: params.additionalArgs,
          })
        }}
        rootId={rootId}
        annotationTargetPath={file.kind === 'file' ? file.path : null}
        surfaceVariant={surfaceVariant}
        subzone="PreviewToolWorkbench"
      />
    )
  }, [
    file.kind,
    file.path,
    pluginRuntime,
    rootId,
    surfaceVariant,
    toolWorkbenchState.optionValuesByTool,
  ])

  const handleResultAction = useCallback((params: { item: { toolName: string }; action: StructuredToolCallAction }) => {
    const { item, action } = params
    if (action.type !== 'tool-call') return

    const targetTool = toolByName.get(item.toolName)
    if (!targetTool) return

    if (action.execution === 'enqueue') {
      void pluginRuntime.runToolCall(targetTool, {
        trigger: 'manual',
        additionalArgs: action.arguments,
      })
      return
    }

    if (!rootHandle || !rootId) return
    void dispatchSystemTool({
      toolName: item.toolName,
      rootHandle,
      rootId,
      additionalArgs: action.arguments ?? {},
    })
  }, [pluginRuntime, rootHandle, rootId, toolByName])

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
          panelToggle={{
            collapsed: toolPanelCollapsed,
            onToggle: onToggleToolPanelCollapsed,
            expandLabel: '展开预览工具面板',
            collapseLabel: '收起预览工具面板',
          }}
        />
      )}

      {showResultPanel && !toolPanelCollapsed && (
        <PluginToolResultPanel
          workbench={workbenchNode}
          items={currentFileQueue}
          onToggleItemCollapsed={pluginRuntime.handleToggleResultItemCollapsed}
          onResultAction={handleResultAction}
          surfaceVariant={surfaceVariant}
          side="left"
          subzone="PreviewToolResultPanel"
          emptyHint="点击左侧工具按钮后，结果会显示在这里。"
        />
      )}
    </>
  )
}
