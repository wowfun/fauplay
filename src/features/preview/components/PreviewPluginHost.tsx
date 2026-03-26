import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import { CONTINUOUS_CALL_OPTION_KEY, toolContinuousCallConfig, toEffectiveMaxContinuousConcurrent } from '@/config/toolContinuousCall'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import { getBoundRootPath } from '@/lib/reveal'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
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
  toolPanelWidthPx: number
  onToolPanelWidthChange: (nextWidthPx: number) => void
  onMutationCommitted?: (params?: PreviewMutationCommitParams) => void | Promise<void>
  enableAnnotationTagShortcutOwner?: boolean
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
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

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
}

function readFirstResultRelativePath(result: unknown): string | null {
  if (!isRecord(result)) return null
  if (!Array.isArray(result.items) || result.items.length === 0) return null
  const first = result.items[0]
  if (!isRecord(first) || typeof first.relativePath !== 'string') return null
  const normalized = normalizeRelativePath(first.relativePath)
  return normalized || null
}

function resolvePreviewBaseArguments(file: FileItem): Record<string, unknown> | null {
  if (file.kind !== 'file') return null
  if (file.sourceType === 'root_trash' || file.sourceType === 'global_recycle') {
    const items = [{
      sourceType: file.sourceType,
      ...(typeof file.recycleId === 'string' && file.recycleId.trim() ? { recycleId: file.recycleId.trim() } : {}),
      ...(typeof file.absolutePath === 'string' && file.absolutePath.trim() ? { absolutePath: file.absolutePath.trim() } : {}),
    }]
    return { items }
  }

  const relativePath = typeof file.sourceRelativePath === 'string' && file.sourceRelativePath.trim()
    ? file.sourceRelativePath.trim()
    : (!isAbsolutePathLike(file.path) ? file.path : '')
  if (!relativePath) {
    if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
      return {}
    }
    return null
  }

  return {
    relativePath,
    ...(typeof file.sourceRootPath === 'string' && file.sourceRootPath.trim() ? { rootPath: file.sourceRootPath.trim() } : {}),
  }
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
}: PreviewPluginHostProps) {
  const keyboardShortcuts = useKeyboardShortcuts()
  const continuousTaskQueueRef = useRef<ContinuousToolTask[]>([])
  const continuousTaskKeySetRef = useRef<Set<string>>(new Set())
  const continuousInFlightCountRef = useRef(0)
  const normalizedFilePath = useMemo(
    () => file.path.split('/').filter(Boolean).join('/'),
    [file.path]
  )
  const currentBoundRootPath = useMemo(
    () => (rootId ? getBoundRootPath(rootId) : null),
    [rootId]
  )
  const isCrossRootProjection = useMemo(() => (
    Boolean(file.sourceRootPath && file.sourceRootPath !== currentBoundRootPath)
  ), [currentBoundRootPath, file.sourceRootPath])
  const isTrashContext = useMemo(
    () => (
      file.sourceType === 'root_trash'
      || file.sourceType === 'global_recycle'
      || normalizedFilePath === '@trash'
      || normalizedFilePath === '.trash'
      || normalizedFilePath.startsWith('.trash/')
    ),
    [file.sourceType, normalizedFilePath]
  )
  const contextualTools = useMemo(() => {
    const filteredTools = isTrashContext
      ? previewActionTools.filter((tool) => tool.name === 'fs.restore')
      : (isCrossRootProjection
        ? previewActionTools.filter((tool) => (
          tool.name === 'fs.softDelete' || tool.name === 'data.findDuplicateFiles'
        ))
        : previewActionTools.filter((tool) => tool.name !== 'fs.restore'))
    return orderToolsWithSoftDeleteLast(filteredTools)
  }, [isCrossRootProjection, isTrashContext, previewActionTools])
  const previewBaseArguments = useMemo(
    () => resolvePreviewBaseArguments(file),
    [file]
  )
  const hasRelativeToolContext = useMemo(
    () => Boolean(previewBaseArguments && typeof previewBaseArguments.relativePath === 'string'),
    [previewBaseArguments]
  )
  const canRunProjectedMutationTool = useCallback((tool: GatewayToolDescriptor) => {
    if (file.kind !== 'file') return false
    if (file.sourceType === 'root_trash' || file.sourceType === 'global_recycle') {
      return tool.name === 'fs.restore'
    }
    if (!hasRelativeToolContext) {
      return tool.name === 'fs.softDelete' && typeof file.absolutePath === 'string' && file.absolutePath.trim().length > 0
    }
    return true
  }, [file, hasRelativeToolContext])

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
    canRunTool: useCallback((tool: GatewayToolDescriptor) => canRunProjectedMutationTool(tool), [canRunProjectedMutationTool]),
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
  const resolveToolArguments = useCallback((tool: GatewayToolDescriptor, extraArgs?: Record<string, unknown>): Record<string, unknown> | null => {
    if (tool.name === 'fs.softDelete') {
      if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
        return {
          absolutePaths: [file.absolutePath.trim()],
          ...(extraArgs ?? {}),
        }
      }
      if (previewBaseArguments) {
        return {
          ...previewBaseArguments,
          ...(extraArgs ?? {}),
        }
      }
      return null
    }

    if (tool.name === 'fs.restore') {
      if (previewBaseArguments) {
        return {
          ...previewBaseArguments,
          ...(extraArgs ?? {}),
        }
      }
      return null
    }

    if (!previewBaseArguments) {
      return null
    }

    return {
      ...previewBaseArguments,
      ...(extraArgs ?? {}),
    }
  }, [file.absolutePath, previewBaseArguments])
  const handledAutoProjectionIdRef = useRef<string | null>(null)

  useEffect(() => {
    const autoProjectionItem = pluginRuntime.currentQueue.find((item) => (
      item.status === 'success'
      && item.projection?.entry === 'auto'
    ))
    if (!autoProjectionItem?.projection) return
    if (handledAutoProjectionIdRef.current === autoProjectionItem.id) return
    handledAutoProjectionIdRef.current = autoProjectionItem.id
    onActivateProjection(autoProjectionItem.projection)
  }, [onActivateProjection, pluginRuntime.currentQueue])
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
    const previewWorkbenchTool = tool.name === 'local.data'
      ? {
        ...tool,
        toolActions: tool.toolActions.filter((action) => action.arguments?.operation !== 'ensureFileEntries'),
      }
      : tool

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

    if (!rootHandle || !rootId) return
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
              onActivateProjection(item.projection)
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
