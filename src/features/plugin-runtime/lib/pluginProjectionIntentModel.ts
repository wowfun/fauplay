import type { PluginResultQueueItem } from '../types/index.ts'
import type { ResultProjection } from '../../../types/index.ts'

export type PluginProjectionActivationIntent =
  | {
    kind: 'none'
  }
  | {
    kind: 'activate'
    resultId: string
    toolName: string
    projection: ResultProjection
  }

export type PluginDuplicateProjectionDismissIntent =
  | {
    kind: 'none'
  }
  | {
    kind: 'dismiss'
    resultId: string
    toolName: string
  }

interface ResolvePluginProjectionActivationIntentParams {
  queueItems: readonly PluginResultQueueItem[]
  handledResultId: string | null
}

interface ResolvePluginDuplicateProjectionDismissIntentParams {
  queueItems: readonly PluginResultQueueItem[]
  handledResultId: string | null
}

const DUPLICATE_TOOL_NAME = 'data.findDuplicateFiles'

export function resolvePluginProjectionActivationIntent({
  queueItems,
  handledResultId,
}: ResolvePluginProjectionActivationIntentParams): PluginProjectionActivationIntent {
  const latestDuplicateResult = findLatestDuplicateResult(queueItems)
  const autoProjectionItem = queueItems.find((item) => (
    item.status === 'success'
    && item.projection?.entry === 'auto'
    && !isStaleDuplicateProjection(item, latestDuplicateResult)
  ))

  if (!autoProjectionItem?.projection) {
    return { kind: 'none' }
  }
  if (handledResultId === autoProjectionItem.id) {
    return { kind: 'none' }
  }

  return {
    kind: 'activate',
    resultId: autoProjectionItem.id,
    toolName: autoProjectionItem.toolName,
    projection: autoProjectionItem.projection,
  }
}

export function resolvePluginDuplicateProjectionDismissIntent({
  queueItems,
  handledResultId,
}: ResolvePluginDuplicateProjectionDismissIntentParams): PluginDuplicateProjectionDismissIntent {
  const latestDuplicateResult = findLatestDuplicateResult(queueItems)
  if (!latestDuplicateResult) return { kind: 'none' }
  if (latestDuplicateResult.projection) return { kind: 'none' }
  if (handledResultId === latestDuplicateResult.id) return { kind: 'none' }

  return {
    kind: 'dismiss',
    resultId: latestDuplicateResult.id,
    toolName: latestDuplicateResult.toolName,
  }
}

function findLatestDuplicateResult(
  queueItems: readonly PluginResultQueueItem[]
): PluginResultQueueItem | undefined {
  return queueItems.find((item) => (
    item.toolName === DUPLICATE_TOOL_NAME
    && item.status === 'success'
  ))
}

function isStaleDuplicateProjection(
  item: PluginResultQueueItem,
  latestDuplicateResult: PluginResultQueueItem | undefined
): boolean {
  return Boolean(
    item.toolName === DUPLICATE_TOOL_NAME
    && latestDuplicateResult
    && latestDuplicateResult.id !== item.id
    && !latestDuplicateResult.projection
  )
}
