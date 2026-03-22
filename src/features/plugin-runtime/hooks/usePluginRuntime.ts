import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { isUnlimited, toolResultQueueConfig } from '@/config/toolResultQueue'
import type { GatewayToolDescriptor, ToolActionAnnotation, ToolOptionAnnotation } from '@/lib/gateway'
import { dispatchSystemTool, type DispatchSystemToolResult } from '@/lib/actionDispatcher'
import type {
  PluginActionRailItem,
  PluginActionState,
  PluginResultQueueItem,
  PluginResultQueueState,
  PluginResultTrigger,
  PluginScope,
  PluginToolCallOutcome,
  PluginWorkbenchState,
  ToolWorkbenchOptionValue,
} from '@/features/plugin-runtime/types'

const QUEUE_ID_RANDOM_MAX = 1_000_000

interface RunToolCallOptions {
  trigger: PluginResultTrigger
  actionKey?: string
  actionLabel?: string
  additionalArgs?: Record<string, unknown>
  requestSignature?: string
  skipIfAlreadyCompleted?: boolean
}

interface UsePluginRuntimeOptions {
  scope: PluginScope
  tools: GatewayToolDescriptor[]
  contextKey: string
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  resultQueueState: PluginResultQueueState
  setResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  workbenchState: PluginWorkbenchState
  setWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  buildBaseArguments: () => Record<string, unknown> | null
  canRunTool?: (tool: GatewayToolDescriptor) => boolean
  onMutationCommitted?: (params: { tool: GatewayToolDescriptor; result: DispatchSystemToolResult }) => void | Promise<void>
}

function createQueueItemId(toolName: string): string {
  return `${Date.now()}-${Math.floor(Math.random() * QUEUE_ID_RANDOM_MAX)}-${toolName}`
}

function touchContextOrder(contextOrder: string[], contextKey: string): string[] {
  return [contextKey, ...contextOrder.filter((item) => item !== contextKey)]
}

function trimQueueByItemLimit(queue: PluginResultQueueItem[]): PluginResultQueueItem[] {
  if (isUnlimited(toolResultQueueConfig.maxItemsPerFile)) {
    return queue
  }
  return queue.slice(0, Math.max(toolResultQueueConfig.maxItemsPerFile, 0))
}

function trimQueueStateByContextLimit(state: PluginResultQueueState): PluginResultQueueState {
  if (isUnlimited(toolResultQueueConfig.maxFiles) || state.contextOrder.length <= toolResultQueueConfig.maxFiles) {
    return state
  }

  const keepContextKeys = state.contextOrder.slice(0, Math.max(toolResultQueueConfig.maxFiles, 0))
  const byContextKey: Record<string, PluginResultQueueItem[]> = {}

  for (const item of keepContextKeys) {
    const queue = state.byContextKey[item]
    if (queue) {
      byContextKey[item] = queue
    }
  }

  return {
    byContextKey,
    contextOrder: keepContextKeys,
  }
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

function mergeArgs(
  baseArguments: Record<string, unknown>,
  options: { additionalArgs?: Record<string, unknown> }
): Record<string, unknown> {
  return {
    ...baseArguments,
    ...(options.additionalArgs ?? {}),
  }
}

function toToolOptionArguments(
  tool: GatewayToolDescriptor,
  optionValuesByTool: Record<string, Record<string, ToolWorkbenchOptionValue>>
): Record<string, unknown> {
  const optionState = optionValuesByTool[tool.name]
  const args: Record<string, unknown> = {}

  for (const option of tool.toolOptions) {
    if (option.sendToTool !== true) continue
    const value = resolveToolOptionValue(tool, option.key, optionState)
    if (typeof value === 'undefined') continue
    const argumentKey = option.argumentKey || option.key
    args[argumentKey] = value
  }

  return args
}

export function createPluginRequestSignature(params: {
  toolName: string
  contextKey: string
  actionKey?: string
  argumentsPayload: Record<string, unknown>
}): string {
  return JSON.stringify({
    toolName: params.toolName,
    contextKey: params.contextKey,
    actionKey: params.actionKey ?? null,
    argumentsPayload: toSortedSerializable(params.argumentsPayload),
  })
}

function shouldSkipCompletedRequest(
  queue: PluginResultQueueItem[],
  toolName: string,
  requestSignature: string
): boolean {
  return queue.some((item) => (
    item.toolName === toolName
    && item.requestSignature === requestSignature
    && (item.status === 'success' || item.status === 'error')
  ))
}

export function hasWorkbenchMetadata(tool: GatewayToolDescriptor): boolean {
  return tool.toolOptions.length > 0 || tool.toolActions.some((action) => action.visible !== false)
}

export function findToolOption(tool: GatewayToolDescriptor, optionKey: string): ToolOptionAnnotation | null {
  return tool.toolOptions.find((option) => option.key === optionKey) ?? null
}

export function resolveToolOptionValue(
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

  if (option.type === 'string') {
    if (typeof currentValue === 'string') return currentValue
    return typeof option.defaultValue === 'string' ? option.defaultValue : ''
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

export function isBooleanToolOptionEnabled(
  tool: GatewayToolDescriptor,
  optionKey: string,
  optionValuesByTool: Record<string, Record<string, ToolWorkbenchOptionValue>>
): boolean {
  const option = findToolOption(tool, optionKey)
  if (!option || option.type !== 'boolean') return false
  const value = resolveToolOptionValue(tool, optionKey, optionValuesByTool[tool.name])
  return value === true
}

function resolveToolActionState(
  queue: PluginResultQueueItem[],
  toolName: string,
  canRunInContext: boolean
): PluginActionState {
  const latest = queue.find((item) => item.toolName === toolName)
  if (latest?.status === 'error') return 'error'
  if (latest?.status === 'loading') return 'loading'
  return canRunInContext ? 'default' : 'disabled'
}

function toRailErrorHint(latest: PluginResultQueueItem | undefined): string | null {
  if (!latest || latest.status !== 'error') return null
  return '执行失败，查看结果面板'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function shouldTriggerMutationRefresh(tool: GatewayToolDescriptor, dispatchResult: DispatchSystemToolResult): boolean {
  if (tool.mutation !== true || dispatchResult.ok !== true) {
    return false
  }

  const result = dispatchResult.result
  if (isRecord(result) && typeof result.dryRun === 'boolean') {
    return result.dryRun === false
  }

  return true
}

export function usePluginRuntime({
  scope,
  tools,
  contextKey,
  rootHandle,
  rootId,
  resultQueueState,
  setResultQueueState,
  workbenchState,
  setWorkbenchState,
  buildBaseArguments,
  canRunTool,
  onMutationCommitted,
}: UsePluginRuntimeOptions) {
  const resultQueueStateRef = useRef(resultQueueState)

  useEffect(() => {
    resultQueueStateRef.current = resultQueueState
  }, [resultQueueState])

  const scopedTools = useMemo(() => tools.filter((tool) => tool.scopes.includes(scope)), [scope, tools])

  const baseArguments = useMemo(() => buildBaseArguments(), [buildBaseArguments])
  const hasBaseArguments = baseArguments !== null

  const currentQueue = useMemo(
    () => resultQueueState.byContextKey[contextKey] ?? [],
    [resultQueueState.byContextKey, contextKey]
  )

  const activeWorkbenchTool = useMemo(() => {
    if (scopedTools.length === 0) return null

    const active = scopedTools.find((tool) => tool.name === workbenchState.activeToolName)
    if (active) return active

    return scopedTools.find((tool) => hasWorkbenchMetadata(tool)) ?? null
  }, [scopedTools, workbenchState.activeToolName])

  const runToolCall = useCallback(async (
    tool: GatewayToolDescriptor,
    options: RunToolCallOptions
  ): Promise<PluginToolCallOutcome> => {
    if (!rootHandle || !rootId || !baseArguments) return 'skipped'
    if (canRunTool && !canRunTool(tool)) return 'skipped'

    const toolOptionArgs = toToolOptionArguments(tool, workbenchState.optionValuesByTool)
    const argumentsPayload = mergeArgs(baseArguments, {
      additionalArgs: {
        ...toolOptionArgs,
        ...(options.additionalArgs ?? {}),
      },
    })

    const requestSignature = options.requestSignature ?? createPluginRequestSignature({
      toolName: tool.name,
      contextKey,
      actionKey: options.actionKey,
      argumentsPayload,
    })

    if (options.skipIfAlreadyCompleted) {
      const latestQueue = resultQueueStateRef.current.byContextKey[contextKey] ?? []
      if (shouldSkipCompletedRequest(latestQueue, tool.name, requestSignature)) {
        return 'skipped'
      }
    }

    const queueItemId = createQueueItemId(tool.name)
    const startedAt = Date.now()
    const queueItemTitle = options.actionLabel ? `${tool.title || tool.name} · ${options.actionLabel}` : (tool.title || tool.name)

    setResultQueueState((prev) => {
      const previousQueue = prev.byContextKey[contextKey] ?? []
      const collapsedHistory = previousQueue.map((item) => (
        item.toolName === tool.name
          ? { ...item, collapsed: true }
          : item
      ))

      const nextQueue = trimQueueByItemLimit([
        {
          id: queueItemId,
          contextKey,
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

      const nextState: PluginResultQueueState = {
        byContextKey: {
          ...prev.byContextKey,
          [contextKey]: nextQueue,
        },
        contextOrder: touchContextOrder(prev.contextOrder, contextKey),
      }

      return trimQueueStateByContextLimit(nextState)
    })

    const dispatchResult = await dispatchSystemTool({
      toolName: tool.name,
      rootHandle,
      rootId,
      additionalArgs: argumentsPayload,
    })

    const finishedAt = Date.now()

    setResultQueueState((prev) => {
      const queue = prev.byContextKey[contextKey] ?? []
      let hasMatched = false
      const nextQueue = queue.map((item) => {
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
        byContextKey: {
          ...prev.byContextKey,
          [contextKey]: nextQueue,
        },
      }
    })

    if (shouldTriggerMutationRefresh(tool, dispatchResult) && onMutationCommitted) {
      await onMutationCommitted({ tool, result: dispatchResult })
    }

    return 'executed'
  }, [baseArguments, canRunTool, contextKey, onMutationCommitted, rootHandle, rootId, setResultQueueState, workbenchState.optionValuesByTool])

  const handleWorkbenchOptionChange = useCallback((toolName: string, optionKey: string, value: ToolWorkbenchOptionValue) => {
    setWorkbenchState((prev) => ({
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
  }, [setWorkbenchState])

  const handleWorkbenchContextChange = useCallback((toolName: string) => {
    setWorkbenchState((prev) => {
      if (prev.activeToolName === toolName) return prev
      return {
        ...prev,
        activeToolName: toolName,
      }
    })
  }, [setWorkbenchState])

  const handleRunWorkbenchAction = useCallback((tool: GatewayToolDescriptor, action: ToolActionAnnotation) => {
    handleWorkbenchContextChange(tool.name)
    void runToolCall(tool, {
      trigger: 'manual',
      actionKey: action.key,
      actionLabel: action.label,
      additionalArgs: action.arguments,
    })
  }, [handleWorkbenchContextChange, runToolCall])

  const handleToggleResultItemCollapsed = useCallback((id: string) => {
    setResultQueueState((prev) => {
      const queue = prev.byContextKey[contextKey] ?? []
      let hasMatched = false
      const nextQueue = queue.map((item) => {
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
        byContextKey: {
          ...prev.byContextKey,
          [contextKey]: nextQueue,
        },
      }
    })
  }, [contextKey, setResultQueueState])

  const railActions = useMemo<PluginActionRailItem[]>(() => {
    return scopedTools.map((tool) => {
      const latestQueueItem = currentQueue.find((item) => item.toolName === tool.name)
      const title = tool.title || tool.name
      const runnableInContext = hasBaseArguments && (!canRunTool || canRunTool(tool))

      return {
        toolName: tool.name,
        title,
        onClick: () => {
          handleWorkbenchContextChange(tool.name)
          void runToolCall(tool, {
            trigger: 'manual',
          })
        },
        disabled: latestQueueItem?.status === 'loading' || !rootHandle || !rootId || !runnableInContext,
        actionState: resolveToolActionState(currentQueue, tool.name, Boolean(rootHandle && rootId && runnableInContext)),
        error: toRailErrorHint(latestQueueItem),
        iconName: tool.iconName,
      }
    })
  }, [canRunTool, currentQueue, handleWorkbenchContextChange, hasBaseArguments, rootHandle, rootId, runToolCall, scopedTools])

  const getRequestSignature = useCallback((tool: GatewayToolDescriptor, params?: {
    actionKey?: string
    additionalArgs?: Record<string, unknown>
  }): string | null => {
    if (!baseArguments) return null

    const toolOptionArgs = toToolOptionArguments(tool, workbenchState.optionValuesByTool)
    const argumentsPayload = mergeArgs(baseArguments, {
      additionalArgs: {
        ...toolOptionArgs,
        ...(params?.additionalArgs ?? {}),
      },
    })

    return createPluginRequestSignature({
      toolName: tool.name,
      contextKey,
      actionKey: params?.actionKey,
      argumentsPayload,
    })
  }, [baseArguments, contextKey, workbenchState.optionValuesByTool])

  const hasCompletedRequest = useCallback((toolName: string, requestSignature: string): boolean => {
    const queue = resultQueueStateRef.current.byContextKey[contextKey] ?? []
    return shouldSkipCompletedRequest(queue, toolName, requestSignature)
  }, [contextKey])

  return {
    scopedTools,
    currentQueue,
    activeWorkbenchTool,
    railActions,
    runToolCall,
    handleWorkbenchOptionChange,
    handleWorkbenchContextChange,
    handleRunWorkbenchAction,
    handleToggleResultItemCollapsed,
    hasBaseArguments,
    getRequestSignature,
    hasCompletedRequest,
  }
}
