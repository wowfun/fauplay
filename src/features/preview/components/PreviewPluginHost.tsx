import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import type { RuntimeToolDescriptor } from '@/lib/runtimeApi'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import { withToolScopedProjection } from '@/lib/projection'
import { getBoundRootPath } from '@/lib/reveal'
import { getFilePreviewKind } from '@/lib/filePreview'
import { usePreviewContinuousToolRunner } from '@/features/preview/hooks/usePreviewContinuousToolRunner'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
import {
  resolvePreviewPluginContextModel,
  resolvePreviewPluginToolArguments,
  resolvePreviewPluginToolRunnable,
} from '@/features/preview/lib/previewPluginContextModel'
import { resolvePreviewPluginMutationCommitParams } from '@/features/preview/lib/previewPluginMutationModel'
import {
  resolvePreviewPluginDuplicateProjectionDismissIntent,
  resolvePreviewPluginProjectionActivationIntent,
} from '@/features/preview/lib/previewPluginProjectionModel'
import { resolvePreviewPluginShortcutIntent } from '@/features/preview/lib/previewPluginShortcutIntentModel'
import { resolvePreviewPluginWorkbenchTool } from '@/features/preview/lib/previewPluginWorkbenchModel'
import type { FileItem, ResultProjection } from '@/types'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import { PluginActionRail } from '@/features/plugin-runtime/components/PluginActionRail'
import type { StructuredToolCallAction } from '@/features/plugin-runtime/components/PluginResultStructuredView'
import { PluginToolResultPanel } from '@/features/plugin-runtime/components/PluginToolResultPanel'
import { PluginToolWorkbench } from '@/features/plugin-runtime/components/PluginToolWorkbench'
import {
  hasWorkbenchMetadata,
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
    const intent = resolvePreviewPluginProjectionActivationIntent({
      queueItems: pluginRuntime.currentQueue,
      handledResultId: handledAutoProjectionIdRef.current,
    })
    if (intent.kind === 'none') return

    handledAutoProjectionIdRef.current = intent.resultId
    onActivateProjection(withToolScopedProjection(intent.projection, intent.toolName))
  }, [onActivateProjection, pluginRuntime.currentQueue])

  useEffect(() => {
    const intent = resolvePreviewPluginDuplicateProjectionDismissIntent({
      queueItems: pluginRuntime.currentQueue,
      handledResultId: handledDuplicateProjectionDismissResultIdRef.current,
    })
    if (intent.kind === 'none') return

    handledDuplicateProjectionDismissResultIdRef.current = intent.resultId
    onDismissProjectionTool(intent.toolName)
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
  const { continuousEnabledToolNames } = usePreviewContinuousToolRunner({
    enabled: enableContinuousAutoRunOwner,
    fileKind: file.kind,
    previewViewState,
    tools: fileActionTools,
    optionValuesByTool: toolWorkbenchState.optionValuesByTool,
    hasExecutionContext: pluginRuntime.hasExecutionContext,
    getRequestSignature: pluginRuntime.getRequestSignature,
    hasCompletedRequest: pluginRuntime.hasCompletedRequest,
    runToolCall: pluginRuntime.runToolCall,
  })

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
    if (file.kind !== 'file') return
    if (!annotationTool && !softDeleteTool) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const intent = resolvePreviewPluginShortcutIntent({
        event: {
          defaultPrevented: event.defaultPrevented,
          repeat: event.repeat,
          isTypingTarget: isTypingTarget(event.target),
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          matchesSoftDeleteShortcut: matchesAnyShortcut(event, keyboardShortcuts.preview.softDelete),
          matchesAnnotationDigitShortcut: matchesAnyShortcut(event, keyboardShortcuts.preview.annotationAssignByDigit),
        },
        fileKind: file.kind,
        enableAnnotationTagShortcutOwner,
        enableContinuousAutoRunOwner,
        annotationToolAvailable: annotationTool !== null,
        softDeleteToolAvailable: softDeleteTool !== null,
        matchedTagShortcut: getMatchingPreviewTagShortcut(event),
        activeDigitAssignment: resolveActiveDigitAssignment(rootId),
      })

      if (intent.kind === 'none') return
      event.preventDefault()
      if (intent.kind === 'consume') return

      if (intent.kind === 'run-annotation-tool') {
        if (!annotationTool) return
        void runToolCall(annotationTool, {
          trigger: 'manual',
          actionLabel: intent.actionLabel,
          additionalArgs: intent.additionalArgs,
        })
        return
      }

      if (!softDeleteTool) return
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
    annotationTool,
    enableAnnotationTagShortcutOwner,
    enableContinuousAutoRunOwner,
    file.kind,
    getMatchingPreviewTagShortcut,
    keyboardShortcuts,
    resolveToolArguments,
    rootId,
    runToolCall,
    softDeleteTool,
  ])

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
