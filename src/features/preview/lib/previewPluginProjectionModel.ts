import type { PluginResultQueueItem } from '@/features/plugin-runtime/types'
import type { ResultProjection } from '@/types'

export type PreviewPluginProjectionActivationIntent =
  | {
    kind: 'none'
  }
  | {
    kind: 'activate'
    resultId: string
    toolName: string
    projection: ResultProjection
  }

export type PreviewPluginDuplicateProjectionDismissIntent =
  | {
    kind: 'none'
  }
  | {
    kind: 'dismiss'
    resultId: string
    toolName: string
  }

interface ResolvePreviewPluginProjectionActivationIntentParams {
  queueItems: readonly PluginResultQueueItem[]
  handledResultId: string | null
}

interface ResolvePreviewPluginDuplicateProjectionDismissIntentParams {
  queueItems: readonly PluginResultQueueItem[]
  handledResultId: string | null
}

const DUPLICATE_TOOL_NAME = 'data.findDuplicateFiles'

export function resolvePreviewPluginProjectionActivationIntent({
  queueItems,
  handledResultId,
}: ResolvePreviewPluginProjectionActivationIntentParams): PreviewPluginProjectionActivationIntent {
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

export function resolvePreviewPluginDuplicateProjectionDismissIntent({
  queueItems,
  handledResultId,
}: ResolvePreviewPluginDuplicateProjectionDismissIntentParams): PreviewPluginDuplicateProjectionDismissIntent {
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
