import { isUnlimited, toolResultQueueConfig } from '@/config/toolResultQueue'
import type { PluginResultQueueItem, PluginResultQueueState, PluginResultTrigger } from '@/features/plugin-runtime/types'
import type { ResultProjection } from '@/types'

const QUEUE_ID_RANDOM_MAX = 1_000_000

interface EnqueueLoadingResultParams {
  queueItemId: string
  contextKey: string
  toolName: string
  title: string
  trigger: PluginResultTrigger
  actionKey?: string
  requestSignature: string
  startedAt: number
}

interface FinalizeQueueItemParams {
  contextKey: string
  queueItemId: string
  status: 'success' | 'error'
  finishedAt: number
  result?: unknown
  projection?: ResultProjection
  error?: string
  errorCode?: string
}

export function createQueueItemId(toolName: string): string {
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

export function shouldSkipCompletedRequest(
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

export function enqueueLoadingResult(
  state: PluginResultQueueState,
  params: EnqueueLoadingResultParams
): PluginResultQueueState {
  const previousQueue = state.byContextKey[params.contextKey] ?? []
  const collapsedHistory = previousQueue.map((item) => (
    item.toolName === params.toolName
      ? { ...item, collapsed: true }
      : item
  ))

  const nextQueue = trimQueueByItemLimit([
    {
      id: params.queueItemId,
      contextKey: params.contextKey,
      toolName: params.toolName,
      title: params.title,
      trigger: params.trigger,
      actionKey: params.actionKey,
      requestSignature: params.requestSignature,
      status: 'loading',
      startedAt: params.startedAt,
      collapsed: false,
    },
    ...collapsedHistory,
  ])

  return trimQueueStateByContextLimit({
    byContextKey: {
      ...state.byContextKey,
      [params.contextKey]: nextQueue,
    },
    contextOrder: touchContextOrder(state.contextOrder, params.contextKey),
  })
}

export function finalizeQueueItem(
  state: PluginResultQueueState,
  params: FinalizeQueueItemParams
): PluginResultQueueState {
  const queue = state.byContextKey[params.contextKey] ?? []
  let hasMatched = false
  const nextQueue = queue.map((item) => {
    if (item.id !== params.queueItemId) return item
    hasMatched = true

    if (params.status === 'success') {
      return {
        ...item,
        status: 'success' as const,
        result: params.result,
        projection: params.projection,
        error: undefined,
        errorCode: undefined,
        finishedAt: params.finishedAt,
      }
    }

    return {
      ...item,
      status: 'error' as const,
      result: undefined,
      projection: undefined,
      error: params.error,
      errorCode: params.errorCode,
      finishedAt: params.finishedAt,
    }
  })

  if (!hasMatched) return state

  return {
    ...state,
    byContextKey: {
      ...state.byContextKey,
      [params.contextKey]: nextQueue,
    },
  }
}

export function toggleQueueItemCollapsed(
  state: PluginResultQueueState,
  params: { contextKey: string; id: string }
): PluginResultQueueState {
  const queue = state.byContextKey[params.contextKey] ?? []
  let hasMatched = false
  const nextQueue = queue.map((item) => {
    if (item.id !== params.id) return item
    hasMatched = true
    return {
      ...item,
      collapsed: !item.collapsed,
    }
  })

  if (!hasMatched) return state

  return {
    ...state,
    byContextKey: {
      ...state.byContextKey,
      [params.contextKey]: nextQueue,
    },
  }
}
