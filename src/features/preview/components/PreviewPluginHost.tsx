import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import { CONTINUOUS_CALL_OPTION_KEY, toolContinuousCallConfig, toEffectiveMaxContinuousConcurrent } from '@/config/toolContinuousCall'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import type { RuntimeToolDescriptor } from '@/lib/runtimeApi'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import { withToolScopedProjection } from '@/lib/projection'
import { getBoundRootPath } from '@/lib/reveal'
import { getFilePreviewKind } from '@/lib/filePreview'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
import {
  resolvePreviewPluginContextModel,
  resolvePreviewPluginToolArguments,
  resolvePreviewPluginToolRunnable,
} from '@/features/preview/lib/previewPluginContextModel'
import { resolvePreviewPluginMutationCommitParams } from '@/features/preview/lib/previewPluginMutationModel'
import { resolvePreviewPluginWorkbenchTool } from '@/features/preview/lib/previewPluginWorkbenchModel'
import type { FileItem, ResultProjection } from '@/types'
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
import { resolveActiveDigitAssignment } from '@/features/plugin-runtime/utils/annotationSchema'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'

interface PreviewPluginHostProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  previewActionTools: RuntimeToolDescriptor[]
  previewViewState: 'loading' | 'error' | 'ready' | 'empty'
  surfaceVariant: 'preview-lightbox' | 'preview-panel'
  toolResultQueueState: PluginResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  toolWorkbenchState: PluginWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  toolPanelWidthPx: number
  onToolPanelWidthChange: (nextWidthPx: number) => void
  onMutationCommitted?: (params?: PreviewMutationCommitParams) => void | Promise<void>
  enableAnnotationTagShortcutOwner?: boolean
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
  onDismissProjectionTool: (toolName: string) => void
}

interface ContinuousToolTask {
  key: string
  tool: RuntimeToolDescriptor
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
  toolPanelWidthPx,
  onToolPanelWidthChange,
  onMutationCommitted,
  enableAnnotationTagShortcutOwner = false,
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
}: PreviewPluginHostProps) {
  const keyboardShortcuts = useKeyboardShortcuts()
  const continuousTaskQueueRef = useRef<ContinuousToolTask[]>([])
  const continuousTaskKeySetRef = useRef<Set<string>>(new Set())
  const continuousInFlightCountRef = useRef(0)
  const currentBoundRootPath = useMemo(
    () => (rootId ? getBoundRootPath(rootId) : null),
    [rootId]
  )
  const {
    contextualTools,
    previewBaseArguments,
    isTrashContext,
  } = useMemo(() => resolvePreviewPluginContextModel({
    file,
    rootId,
    currentBoundRootPath,
    previewActionTools,
  }), [currentBoundRootPath, file, previewActionTools, rootId])
  const canRunProjectedMutationTool = useCallback((tool: RuntimeToolDescriptor) => {
    return resolvePreviewPluginToolRunnable({
      file,
      previewBaseArguments,
      tool,
    })
  }, [file, previewBaseArguments])

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
    buildBaseArguments: useCallback(() => previewBaseArguments, [previewBaseArguments]),
    canRunTool: useCallback((tool: RuntimeToolDescriptor) => canRunProjectedMutationTool(tool), [canRunProjectedMutationTool]),
    onMutationCommitted: onMutationCommitted
      ? async ({ tool, result }) => {
        const mutationParams = resolvePreviewPluginMutationCommitParams({
          toolName: tool.name,
          result,
          file,
          activeProjectionId: activeProjection?.id,
        })
        await onMutationCommitted(mutationParams)
      }
      : undefined,
  })
  const runToolCall = pluginRuntime.runToolCall

  const fileActionTools = pluginRuntime.scopedTools
  const toolByName = useMemo(() => {
    const map = new Map<string, RuntimeToolDescriptor>()
    for (const tool of fileActionTools) {
      map.set(tool.name, tool)
    }
    return map
  }, [fileActionTools])
  const resolveToolArguments = useCallback((
    tool: RuntimeToolDescriptor,
    extraArgs?: Record<string, unknown>
  ): Record<string, unknown> | null => {
    return resolvePreviewPluginToolArguments({
      file,
      previewBaseArguments,
      tool,
      extraArgs,
    })
  }, [file, previewBaseArguments])
  const handledAutoProjectionIdRef = useRef<string | null>(null)
  const handledDuplicateProjectionDismissResultIdRef = useRef<string | null>(null)

  useEffect(() => {
    handledAutoProjectionIdRef.current = null
    handledDuplicateProjectionDismissResultIdRef.current = null
  }, [file.path])

  useEffect(() => {
    const latestDuplicateResult = pluginRuntime.currentQueue.find((item) => (
      item.toolName === 'data.findDuplicateFiles'
      && item.status === 'success'
    ))
    const autoProjectionItem = pluginRuntime.currentQueue.find((item) => (
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
  }, [onActivateProjection, pluginRuntime.currentQueue])

  useEffect(() => {
    const latestDuplicateResult = pluginRuntime.currentQueue.find((item) => (
      item.toolName === 'data.findDuplicateFiles'
      && item.status === 'success'
    ))
    if (!latestDuplicateResult) return
    if (latestDuplicateResult.projection) return
    if (handledDuplicateProjectionDismissResultIdRef.current === latestDuplicateResult.id) return

    handledDuplicateProjectionDismissResultIdRef.current = latestDuplicateResult.id
    onDismissProjectionTool(latestDuplicateResult.toolName)
  }, [onDismissProjectionTool, pluginRuntime.currentQueue])
  const softDeleteTool = useMemo(
    () => fileActionTools.find((tool) => tool.name === 'fs.softDelete') ?? null,
    [fileActionTools]
  )
  const annotationTool = useMemo(
    () => fileActionTools.find((tool) => tool.name === 'local.data') ?? null,
    [fileActionTools]
  )
  const { getMatchingPreviewTagShortcut } = useResolvedPreviewTagShortcuts({
    rootId,
    relativePath: (
      previewBaseArguments
      && typeof previewBaseArguments.relativePath === 'string'
      ? previewBaseArguments.relativePath
      : null
    ),
    enabled: enableAnnotationTagShortcutOwner
      && file.kind === 'file'
      && annotationTool !== null
      && !isTrashContext,
  })
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

  const enqueueContinuousTasks = useCallback((tools: RuntimeToolDescriptor[]) => {
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
    if (file.kind !== 'file' || !pluginRuntime.hasExecutionContext) return
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
    pluginRuntime.hasExecutionContext,
    previewViewState,
  ])

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    processContinuousQueue()
  }, [enableContinuousAutoRunOwner, processContinuousQueue])

  useEffect(() => {
    if (!enableAnnotationTagShortcutOwner) return
    if (file.kind !== 'file') return
    if (!annotationTool) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.repeat) return
      if (isTypingTarget(event.target)) return

      const matchedShortcut = getMatchingPreviewTagShortcut(event)
      if (!matchedShortcut) return

      event.preventDefault()
      if (matchedShortcut.alreadyBound) return

      void runToolCall(annotationTool, {
        trigger: 'manual',
        actionLabel: `${matchedShortcut.key}=${matchedShortcut.value}`,
        additionalArgs: {
          operation: 'bindAnnotationTag',
          key: matchedShortcut.key,
          value: matchedShortcut.value,
        },
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [annotationTool, enableAnnotationTagShortcutOwner, file.kind, getMatchingPreviewTagShortcut, runToolCall])

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    if (file.kind !== 'file') return
    if (!softDeleteTool) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.repeat) return
      if (isTypingTarget(event.target)) return
      if (getMatchingPreviewTagShortcut(event)) return
      if (!matchesAnyShortcut(event, keyboardShortcuts.preview.softDelete)) return

      event.preventDefault()
      const additionalArgs = resolveToolArguments(softDeleteTool)
      if (!additionalArgs) return
      void runToolCall(softDeleteTool, {
        trigger: 'manual',
        additionalArgs,
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    enableContinuousAutoRunOwner,
    file.kind,
    getMatchingPreviewTagShortcut,
    keyboardShortcuts,
    resolveToolArguments,
    runToolCall,
    softDeleteTool,
  ])

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    if (file.kind !== 'file') return
    if (!annotationTool) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.repeat) return
      if (isTypingTarget(event.target)) return
      if (getMatchingPreviewTagShortcut(event)) return
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
          operation: 'setAnnotationValue',
          fieldKey: assignment.fieldKey,
          value,
          source: 'hotkey',
        },
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [annotationTool, enableContinuousAutoRunOwner, file.kind, getMatchingPreviewTagShortcut, keyboardShortcuts, rootId, runToolCall])

  const railActions = useMemo(
    () => pluginRuntime.railActions.map((action) => ({
      ...action,
      highlighted: continuousEnabledToolNames.has(action.toolName),
      onClick: () => {
        const tool = toolByName.get(action.toolName)
        if (!tool) return
        const additionalArgs = resolveToolArguments(tool)
        if (!additionalArgs) return
        pluginRuntime.handleWorkbenchContextChange(tool.name)
        void pluginRuntime.runToolCall(tool, {
          trigger: 'manual',
          additionalArgs,
        })
      },
    })),
    [continuousEnabledToolNames, pluginRuntime, resolveToolArguments, toolByName]
  )

  const workbenchNode = useMemo(() => {
    const tool = pluginRuntime.activeWorkbenchTool
    if (!tool || !hasWorkbenchMetadata(tool)) return null
    const previewKind = file.kind === 'file' ? getFilePreviewKind(file.name) : 'unsupported'
    const previewWorkbenchTool = resolvePreviewPluginWorkbenchTool({
      tool,
      previewKind,
    })

    return (
      <PluginToolWorkbench
        tool={previewWorkbenchTool}
        optionValues={toolWorkbenchState.optionValuesByTool[previewWorkbenchTool.name]}
        onOptionChange={pluginRuntime.handleWorkbenchOptionChange}
        onRunAction={(toolItem, action) => {
          const additionalArgs = resolveToolArguments(toolItem, action.arguments)
          if (!additionalArgs) return
          pluginRuntime.handleWorkbenchContextChange(toolItem.name)
          void pluginRuntime.runToolCall(toolItem, {
            trigger: 'manual',
            actionKey: action.key,
            actionLabel: action.label,
            additionalArgs,
          })
        }}
        onRunCustomToolCall={(toolItem, params) => {
          const additionalArgs = resolveToolArguments(toolItem, params.additionalArgs)
          if (!additionalArgs) return
          pluginRuntime.handleWorkbenchContextChange(toolItem.name)
          void pluginRuntime.runToolCall(toolItem, {
            trigger: 'manual',
            actionLabel: params.actionLabel,
            additionalArgs,
          })
        }}
        rootId={rootId}
        annotationTargetPath={previewBaseArguments && typeof previewBaseArguments.relativePath === 'string'
          ? previewBaseArguments.relativePath
          : null}
        surfaceVariant={surfaceVariant}
        subzone="PreviewToolWorkbench"
      />
    )
  }, [
    file.kind,
    file.name,
    pluginRuntime,
    previewBaseArguments,
    resolveToolArguments,
    rootId,
    surfaceVariant,
    toolWorkbenchState.optionValuesByTool,
  ])

  const handleResultAction = useCallback((params: { item: { toolName: string }; action: StructuredToolCallAction }) => {
    const { item, action } = params
    if (action.type !== 'tool-call') return

    const targetTool = toolByName.get(item.toolName)
    if (!targetTool) return
    const additionalArgs = resolveToolArguments(targetTool, action.arguments)
    if (!additionalArgs) return

    if (action.execution === 'enqueue') {
      void pluginRuntime.runToolCall(targetTool, {
        trigger: 'manual',
        additionalArgs,
      })
      return
    }

    if (!pluginRuntime.hasExecutionContext || !rootId) return
    void dispatchSystemTool({
      toolName: item.toolName,
      rootHandle,
      rootId,
      additionalArgs,
    })
  }, [pluginRuntime, resolveToolArguments, rootHandle, rootId, toolByName])

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
          onActivateProjection={({ item }) => {
            if (item.projection) {
              onActivateProjection(withToolScopedProjection(item.projection, item.toolName))
            }
          }}
          activeProjectionId={activeProjection?.id ?? null}
          surfaceVariant={surfaceVariant}
          side="left"
          subzone="PreviewToolResultPanel"
          emptyHint="点击左侧工具按钮后，结果会显示在这里。"
          panelWidthPx={toolPanelWidthPx}
          minPanelWidthPx={320}
          maxPanelWidthPx={640}
          onPanelWidthChange={onToolPanelWidthChange}
        />
      )}
    </>
  )
}
