import type { PluginResultQueueItem } from '../../plugin-runtime/types/index.ts'
import {
  type PluginDuplicateProjectionDismissIntent,
  type PluginProjectionActivationIntent,
  resolvePluginDuplicateProjectionDismissIntent,
  resolvePluginProjectionActivationIntent,
} from '../../plugin-runtime/lib/pluginProjectionIntentModel.ts'

export type PreviewPluginProjectionActivationIntent = PluginProjectionActivationIntent

export type PreviewPluginDuplicateProjectionDismissIntent = PluginDuplicateProjectionDismissIntent

interface ResolvePreviewPluginProjectionActivationIntentParams {
  queueItems: readonly PluginResultQueueItem[]
  handledResultId: string | null
}

interface ResolvePreviewPluginDuplicateProjectionDismissIntentParams {
  queueItems: readonly PluginResultQueueItem[]
  handledResultId: string | null
}

export function resolvePreviewPluginProjectionActivationIntent({
  queueItems,
  handledResultId,
}: ResolvePreviewPluginProjectionActivationIntentParams): PreviewPluginProjectionActivationIntent {
  return resolvePluginProjectionActivationIntent({ queueItems, handledResultId })
}

export function resolvePreviewPluginDuplicateProjectionDismissIntent({
  queueItems,
  handledResultId,
}: ResolvePreviewPluginDuplicateProjectionDismissIntentParams): PreviewPluginDuplicateProjectionDismissIntent {
  return resolvePluginDuplicateProjectionDismissIntent({ queueItems, handledResultId })
}
