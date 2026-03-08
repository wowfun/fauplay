import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { CONTINUOUS_CALL_OPTION_KEY, toolContinuousCallConfig, toEffectiveMaxContinuousConcurrent } from '@/config/toolContinuousCall'
import { isUnlimited, toolResultQueueConfig } from '@/config/toolResultQueue'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import { getMediaType } from '@/lib/thumbnail'
import type { FileItem } from '@/types'
import type { GatewayToolDescriptor, ToolActionAnnotation, ToolOptionAnnotation } from '@/lib/gateway'
import type { PreviewToolWorkbenchState, ToolWorkbenchOptionValue } from '@/features/preview/types/toolWorkbench'
import type { PreviewToolResultQueueItem, PreviewToolResultQueueState, PreviewToolResultTrigger } from '@/features/preview/types/toolResult'
import {
  PreviewActionRail,
  type PreviewActionRailItem,
  type PreviewActionState,
} from './PreviewActionRail'
import { PreviewFeedbackOverlay } from './PreviewFeedbackOverlay'
import { PreviewMediaViewport } from './PreviewMediaViewport'
import { PreviewToolResultPanel } from './PreviewToolResultPanel'
import { PreviewToolWorkbench } from './PreviewToolWorkbench'

interface MediaPreviewCanvasProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  previewActionTools: GatewayToolDescriptor[]
  previewUrl: string | null
  isLoading: boolean
  error: string | null
  onOpenFullscreen?: () => void
  autoPlayVideo?: boolean
  isFullscreen?: boolean
  onVideoEnded?: () => void
  onVideoPlaybackError?: () => void
  toolResultQueueState: PreviewToolResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PreviewToolResultQueueState>>
  toolWorkbenchState: PreviewToolWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PreviewToolWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
}

type MediaPreviewViewState = 'loading' | 'error' | 'ready' | 'empty'
const QUEUE_ID_RANDOM_MAX = 1_000_000

interface ContinuousToolTask {
  key: string
  tool: GatewayToolDescriptor
  relativePath: string
  requestSignature: string
}

interface RunToolCallOptions {
  trigger: PreviewToolResultTrigger
  relativePath: string
  actionKey?: string
  actionLabel?: string
  additionalArgs?: Record<string, unknown>
  requestSignature?: string
}

type RunToolCallOutcome = 'executed' | 'skipped'

function createQueueItemId(toolName: string): string {
  return `${Date.now()}-${Math.floor(Math.random() * QUEUE_ID_RANDOM_MAX)}-${toolName}`
}

function touchFileOrder(fileOrder: string[], filePath: string): string[] {
  return [filePath, ...fileOrder.filter((item) => item !== filePath)]
}

function trimQueueByItemLimit(queue: PreviewToolResultQueueItem[]): PreviewToolResultQueueItem[] {
  if (isUnlimited(toolResultQueueConfig.maxItemsPerFile)) {
    return queue
  }
  return queue.slice(0, Math.max(toolResultQueueConfig.maxItemsPerFile, 0))
}

function trimQueueStateByFileLimit(state: PreviewToolResultQueueState): PreviewToolResultQueueState {
  if (isUnlimited(toolResultQueueConfig.maxFiles) || state.fileOrder.length <= toolResultQueueConfig.maxFiles) {
    return state
  }

  const keepFilePaths = state.fileOrder.slice(0, Math.max(toolResultQueueConfig.maxFiles, 0))
  const byFilePath: Record<string, PreviewToolResultQueueItem[]> = {}

  for (const filePath of keepFilePaths) {
    const queue = state.byFilePath[filePath]
    if (queue) {
      byFilePath[filePath] = queue
    }
  }

  return {
    byFilePath,
    fileOrder: keepFilePaths,
  }
}

function resolveToolActionState(
  queue: PreviewToolResultQueueItem[],
  toolName: string,
  hasRootHandle: boolean
): PreviewActionState {
  const latest = queue.find((item) => item.toolName === toolName)
  if (latest?.status === 'error') return 'error'
  if (latest?.status === 'loading') return 'loading'
  return hasRootHandle ? 'default' : 'disabled'
}

function toRailErrorHint(latest: PreviewToolResultQueueItem | undefined): string | null {
  if (!latest || latest.status !== 'error') return null
  return '执行失败，查看结果面板'
}

function toSortedSerializable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toSortedSerializable(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item !== 'undefined')
    .sort(([a], [b]) => a.localeCompare(b))

  const normalized: Record<string, unknown> = {}
  for (const [key, item] of entries) {
    normalized[key] = toSortedSerializable(item)
  }

  return normalized
}

function toRequestSignature(params: {
  toolName: string
  relativePath: string
  actionKey?: string
  additionalArgs?: Record<string, unknown>
}): string {
  return JSON.stringify({
    toolName: params.toolName,
    relativePath: params.relativePath,
    actionKey: params.actionKey ?? null,
    additionalArgs: toSortedSerializable(params.additionalArgs ?? {}),
  })
}

function shouldSkipContinuousCall(
  queue: PreviewToolResultQueueItem[],
  toolName: string,
  requestSignature: string
): boolean {
  return queue.some((item) => (
    item.toolName === toolName
    && item.requestSignature === requestSignature
    && (item.status === 'success' || item.status === 'error')
  ))
}

function hasWorkbenchMetadata(tool: GatewayToolDescriptor): boolean {
  return tool.toolOptions.length > 0 || tool.toolActions.length > 0
}

function findToolOption(tool: GatewayToolDescriptor, optionKey: string): ToolOptionAnnotation | null {
  return tool.toolOptions.find((option) => option.key === optionKey) ?? null
}

function resolveToolOptionValue(
  tool: GatewayToolDescriptor,
  optionKey: string,
  optionState: Record<string, ToolWorkbenchOptionValue> | undefined
): ToolWorkbenchOptionValue | undefined {
  const option = findToolOption(tool, optionKey)
  if (!option) return undefined

  const currentValue = optionState?.[optionKey]
  if (option.type === 'boolean') {
    if (typeof currentValue === 'boolean') return currentValue
    return typeof option.defaultValue === 'boolean' ? option.defaultValue : false
  }

  const values = option.values ?? []
  if (typeof currentValue === 'string' && values.some((value) => value.value === currentValue)) {
    return currentValue
  }
  if (typeof option.defaultValue === 'string' && values.some((value) => value.value === option.defaultValue)) {
    return option.defaultValue
  }
  return values[0]?.value
}

function isContinuousCallEnabled(
  tool: GatewayToolDescriptor,
  optionValuesByTool: Record<string, Record<string, ToolWorkbenchOptionValue>>
): boolean {
  const option = findToolOption(tool, CONTINUOUS_CALL_OPTION_KEY)
  if (!option || option.type !== 'boolean') return false
  const value = resolveToolOptionValue(tool, CONTINUOUS_CALL_OPTION_KEY, optionValuesByTool[tool.name])
  return value === true
}

export function MediaPreviewCanvas({
  file,
  rootHandle,
  previewActionTools,
  previewUrl,
  isLoading,
  error,
  onOpenFullscreen,
  autoPlayVideo = false,
  isFullscreen = false,
  onVideoEnded,
  onVideoPlaybackError,
  toolResultQueueState,
  setToolResultQueueState,
  toolWorkbenchState,
  setToolWorkbenchState,
  enableContinuousAutoRunOwner,
}: MediaPreviewCanvasProps) {
  const [playbackError, setPlaybackError] = useState(false)
  const continuousTaskQueueRef = useRef<ContinuousToolTask[]>([])
  const continuousTaskKeySetRef = useRef<Set<string>>(new Set())
  const continuousInFlightCountRef = useRef(0)
  const toolResultQueueStateRef = useRef(toolResultQueueState)

  const isImage = getMediaType(file.name) === 'image'
  const isVideo = getMediaType(file.name) === 'video'
  const panelBorderClass = isFullscreen ? 'border-white/10' : 'border-border'
  const railButtonClass = isFullscreen
    ? 'p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-50 text-white'
    : 'p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50'
  const highlightedRailButtonClass = isFullscreen
    ? 'bg-white/20 ring-1 ring-white/60 translate-y-[1px]'
    : 'bg-accent/70 ring-1 ring-primary/60 translate-y-[1px]'
  const emptyTextClass = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const errorTextClass = isFullscreen ? 'text-red-300' : 'text-destructive'
  const fileActionTools = useMemo(() => {
    if (file.kind !== 'file') return []
    return previewActionTools.filter((tool) => tool.scopes.includes('file'))
  }, [file.kind, previewActionTools])
  const showActionRail = fileActionTools.length > 0
  const showResultPanel = fileActionTools.length > 0
  const previewViewState: MediaPreviewViewState = isLoading
    ? 'loading'
    : error
      ? 'error'
      : previewUrl && (isImage || isVideo)
        ? 'ready'
        : 'empty'
  const maxContinuousConcurrent = useMemo(
    () => toEffectiveMaxContinuousConcurrent(toolContinuousCallConfig.maxConcurrent),
    []
  )

  const currentFileQueue = useMemo(
    () => toolResultQueueState.byFilePath[file.path] ?? [],
    [toolResultQueueState.byFilePath, file.path]
  )

  useEffect(() => {
    toolResultQueueStateRef.current = toolResultQueueState
  }, [toolResultQueueState])

  const continuousEnabledToolNames = useMemo(
    () => new Set(
      fileActionTools
        .filter((tool) => isContinuousCallEnabled(tool, toolWorkbenchState.optionValuesByTool))
        .map((tool) => tool.name)
    ),
    [fileActionTools, toolWorkbenchState.optionValuesByTool]
  )

  const activeWorkbenchTool = useMemo(() => {
    if (fileActionTools.length === 0) return null

    const active = fileActionTools.find((tool) => tool.name === toolWorkbenchState.activeToolName)
    if (active) return active

    return fileActionTools.find((tool) => hasWorkbenchMetadata(tool)) ?? null
  }, [fileActionTools, toolWorkbenchState.activeToolName])

  const runToolCall = useCallback(async (tool: GatewayToolDescriptor, options: RunToolCallOptions): Promise<RunToolCallOutcome> => {
    if (!rootHandle || !options.relativePath) return 'skipped'

    const mergedAdditionalArgs = {
      ...(options.additionalArgs ?? {}),
      ...(options.actionKey ? { actionKey: options.actionKey } : {}),
    }
    const requestSignature = options.requestSignature ?? toRequestSignature({
      toolName: tool.name,
      relativePath: options.relativePath,
      actionKey: options.actionKey,
      additionalArgs: mergedAdditionalArgs,
    })

    if (options.trigger === 'continuous') {
      const latestQueue = toolResultQueueStateRef.current.byFilePath[options.relativePath] ?? []
      if (shouldSkipContinuousCall(latestQueue, tool.name, requestSignature)) {
        return 'skipped'
      }
    }

    const queueItemId = createQueueItemId(tool.name)
    const startedAt = Date.now()
    const queueItemTitle = options.actionLabel ? `${tool.title || tool.name} · ${options.actionLabel}` : (tool.title || tool.name)

    setToolResultQueueState((prev) => {
      const previousQueue = prev.byFilePath[options.relativePath] ?? []
      const collapsedHistory = previousQueue.map((item) => (
        item.toolName === tool.name
          ? { ...item, collapsed: true }
          : item
      ))

      const nextQueue = trimQueueByItemLimit([
        {
          id: queueItemId,
          filePath: options.relativePath,
          toolName: tool.name,
          title: queueItemTitle,
          trigger: options.trigger,
          actionKey: options.actionKey,
          requestSignature,
          status: 'loading',
          startedAt,
          collapsed: false,
        },
        ...collapsedHistory,
      ])

      const nextState: PreviewToolResultQueueState = {
        byFilePath: {
          ...prev.byFilePath,
          [options.relativePath]: nextQueue,
        },
        fileOrder: touchFileOrder(prev.fileOrder, options.relativePath),
      }

      return trimQueueStateByFileLimit(nextState)
    })

    const dispatchResult = await dispatchSystemTool({
      toolName: tool.name,
      rootHandle,
      relativePath: options.relativePath,
      additionalArgs: Object.keys(mergedAdditionalArgs).length > 0 ? mergedAdditionalArgs : undefined,
    })
    const finishedAt = Date.now()

    setToolResultQueueState((prev) => {
      const currentQueue = prev.byFilePath[options.relativePath] ?? []
      let hasMatched = false
      const nextQueue = currentQueue.map((item) => {
        if (item.id !== queueItemId) return item
        hasMatched = true

        if (dispatchResult.ok) {
          return {
            ...item,
            status: 'success' as const,
            result: dispatchResult.result,
            error: undefined,
            errorCode: undefined,
            finishedAt,
          }
        }

        return {
          ...item,
          status: 'error' as const,
          result: undefined,
          error: dispatchResult.error || `${tool.title || tool.name} 失败`,
          errorCode: dispatchResult.errorCode,
          finishedAt,
        }
      })

      if (!hasMatched) return prev

      return {
        ...prev,
        byFilePath: {
          ...prev.byFilePath,
          [options.relativePath]: nextQueue,
        },
      }
    })

    return 'executed'
  }, [rootHandle, setToolResultQueueState])

  const processContinuousQueue = useCallback(() => {
    if (!enableContinuousAutoRunOwner) return

    while (
      continuousInFlightCountRef.current < maxContinuousConcurrent
      && continuousTaskQueueRef.current.length > 0
    ) {
      const nextTask = continuousTaskQueueRef.current.shift()
      if (!nextTask) return

      const latestQueue = toolResultQueueStateRef.current.byFilePath[nextTask.relativePath] ?? []
      if (shouldSkipContinuousCall(latestQueue, nextTask.tool.name, nextTask.requestSignature)) {
        continuousTaskKeySetRef.current.delete(nextTask.key)
        continue
      }

      continuousInFlightCountRef.current += 1
      void runToolCall(nextTask.tool, {
        trigger: 'continuous',
        relativePath: nextTask.relativePath,
        requestSignature: nextTask.requestSignature,
      }).finally(() => {
        continuousInFlightCountRef.current = Math.max(0, continuousInFlightCountRef.current - 1)
        continuousTaskKeySetRef.current.delete(nextTask.key)
        processContinuousQueue()
      })
    }
  }, [enableContinuousAutoRunOwner, maxContinuousConcurrent, runToolCall])

  const enqueueContinuousTasks = useCallback((tools: GatewayToolDescriptor[], relativePath: string) => {
    if (!enableContinuousAutoRunOwner) return

    for (const tool of tools) {
      const requestSignature = toRequestSignature({
        toolName: tool.name,
        relativePath,
        additionalArgs: undefined,
      })
      const currentQueue = toolResultQueueStateRef.current.byFilePath[relativePath] ?? []
      if (shouldSkipContinuousCall(currentQueue, tool.name, requestSignature)) continue

      const taskKey = requestSignature
      if (continuousTaskKeySetRef.current.has(taskKey)) continue

      continuousTaskKeySetRef.current.add(taskKey)
      continuousTaskQueueRef.current.push({
        key: taskKey,
        tool,
        relativePath,
        requestSignature,
      })
    }

    processContinuousQueue()
  }, [enableContinuousAutoRunOwner, processContinuousQueue])

  useEffect(() => {
    setToolResultQueueState((prev) => {
      if (!prev.byFilePath[file.path]) return prev
      if (prev.fileOrder[0] === file.path) return prev
      return {
        ...prev,
        fileOrder: touchFileOrder(prev.fileOrder, file.path),
      }
    })
  }, [file.path, setToolResultQueueState])

  useEffect(() => {
    setPlaybackError(false)
  }, [file.path])

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    if (file.kind !== 'file' || !rootHandle) return
    if (previewViewState !== 'ready') return

    const continuousTools = fileActionTools.filter((tool) => continuousEnabledToolNames.has(tool.name))
    if (continuousTools.length === 0) return

    enqueueContinuousTasks(continuousTools, file.path)
  }, [
    enableContinuousAutoRunOwner,
    file.kind,
    file.path,
    rootHandle,
    previewViewState,
    fileActionTools,
    continuousEnabledToolNames,
    enqueueContinuousTasks,
  ])

  useEffect(() => {
    if (!enableContinuousAutoRunOwner) return
    processContinuousQueue()
  }, [enableContinuousAutoRunOwner, processContinuousQueue])

  const handleToolAction = useCallback((tool: GatewayToolDescriptor) => {
    if (file.kind !== 'file') return
    void runToolCall(tool, {
      trigger: 'manual',
      relativePath: file.path,
    })
  }, [file.kind, file.path, runToolCall])

  const handleRunWorkbenchAction = useCallback((tool: GatewayToolDescriptor, action: ToolActionAnnotation) => {
    if (file.kind !== 'file') return

    setToolWorkbenchState((prev) => ({
      ...prev,
      activeToolName: tool.name,
    }))

    void runToolCall(tool, {
      trigger: 'manual',
      relativePath: file.path,
      actionKey: action.key,
      actionLabel: action.label,
    })
  }, [file.kind, file.path, runToolCall, setToolWorkbenchState])

  const handleWorkbenchOptionChange = useCallback((toolName: string, optionKey: string, value: ToolWorkbenchOptionValue) => {
    setToolWorkbenchState((prev) => ({
      ...prev,
      activeToolName: toolName,
      optionValuesByTool: {
        ...prev.optionValuesByTool,
        [toolName]: {
          ...(prev.optionValuesByTool[toolName] ?? {}),
          [optionKey]: value,
        },
      },
    }))
  }, [setToolWorkbenchState])

  const handleWorkbenchContextChange = useCallback((toolName: string) => {
    setToolWorkbenchState((prev) => {
      if (prev.activeToolName === toolName) return prev
      return {
        ...prev,
        activeToolName: toolName,
      }
    })
  }, [setToolWorkbenchState])

  const handleToggleResultItemCollapsed = useCallback((id: string) => {
    setToolResultQueueState((prev) => {
      const currentQueue = prev.byFilePath[file.path] ?? []
      let hasMatched = false
      const nextQueue = currentQueue.map((item) => {
        if (item.id !== id) return item
        hasMatched = true
        return {
          ...item,
          collapsed: !item.collapsed,
        }
      })

      if (!hasMatched) return prev
      return {
        ...prev,
        byFilePath: {
          ...prev.byFilePath,
          [file.path]: nextQueue,
        },
      }
    })
  }, [file.path, setToolResultQueueState])

  const railActions = useMemo<PreviewActionRailItem[]>(() => {
    return fileActionTools.map((tool) => {
      const latestQueueItem = currentFileQueue.find((item) => item.toolName === tool.name)
      const title = tool.title || tool.name

      return {
        toolName: tool.name,
        title,
        onClick: () => {
          handleWorkbenchContextChange(tool.name)
          handleToolAction(tool)
        },
        disabled: latestQueueItem?.status === 'loading' || !rootHandle,
        actionState: resolveToolActionState(currentFileQueue, tool.name, Boolean(rootHandle)),
        error: toRailErrorHint(latestQueueItem),
        icon: tool.icon,
        highlighted: continuousEnabledToolNames.has(tool.name),
      }
    })
  }, [
    currentFileQueue,
    fileActionTools,
    handleToolAction,
    handleWorkbenchContextChange,
    rootHandle,
    continuousEnabledToolNames,
  ])

  const workbenchNode = useMemo(() => {
    if (!activeWorkbenchTool || !hasWorkbenchMetadata(activeWorkbenchTool)) return null
    return (
      <PreviewToolWorkbench
        tool={activeWorkbenchTool}
        optionValues={toolWorkbenchState.optionValuesByTool[activeWorkbenchTool.name]}
        onOptionChange={handleWorkbenchOptionChange}
        onRunAction={handleRunWorkbenchAction}
        isFullscreen={isFullscreen}
      />
    )
  }, [
    activeWorkbenchTool,
    handleWorkbenchOptionChange,
    handleRunWorkbenchAction,
    isFullscreen,
    toolWorkbenchState.optionValuesByTool,
  ])

  return (
    <div className="flex-1 min-h-0 flex" data-preview-state={previewViewState}>
      {showActionRail && (
        <PreviewActionRail
          actions={railActions}
          railButtonClass={railButtonClass}
          highlightedRailButtonClass={highlightedRailButtonClass}
          borderClass={panelBorderClass}
          errorTextClass={errorTextClass}
          onActionHoverChange={handleWorkbenchContextChange}
        />
      )}

      {showResultPanel && (
        <PreviewToolResultPanel
          workbench={workbenchNode}
          items={currentFileQueue}
          onToggleItemCollapsed={handleToggleResultItemCollapsed}
          isFullscreen={isFullscreen}
        />
      )}

      <PreviewMediaViewport
        file={file}
        previewUrl={previewUrl}
        isLoading={isLoading}
        error={error}
        isImage={isImage}
        isVideo={isVideo}
        emptyTextClass={emptyTextClass}
        errorTextClass={errorTextClass}
        onOpenFullscreen={onOpenFullscreen}
        autoPlayVideo={autoPlayVideo}
        onVideoEnded={onVideoEnded}
        onVideoRenderError={() => {
          setPlaybackError(true)
          onVideoPlaybackError?.()
        }}
      >
        <PreviewFeedbackOverlay showPlaybackError={playbackError && isVideo} />
      </PreviewMediaViewport>
    </div>
  )
}
