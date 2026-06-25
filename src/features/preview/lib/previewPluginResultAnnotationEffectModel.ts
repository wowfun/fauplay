import type { PluginResultQueueItem } from '../../plugin-runtime/types/index.ts'
import type { FileItem } from '../../../types/index.ts'
import { readPreviewLocalDataSetValueResult } from './previewFileEditModel.ts'

export type PreviewPluginResultAnnotationEffect =
  | { kind: 'none' }
  | { kind: 'reset-handled-queue-item' }
  | {
    kind: 'patch-annotation-set-value'
    handledQueueItemId: string
    rootId: string
    relativePath: string
    fieldKey: string
    value: string
  }
  | {
    kind: 'refresh-file-annotation'
    handledQueueItemId: string
    rootId: string
    relativePath: string
  }

export interface ResolvePreviewPluginResultAnnotationEffectParams {
  file: FileItem | null
  rootId: string | null | undefined
  canUseAnnotationContext: boolean
  queueItems: readonly PluginResultQueueItem[]
  handledQueueItemId: string | null
}

interface ActiveAnnotationContext {
  file: FileItem
  rootId: string
}

function resolveActiveAnnotationContext({
  file,
  rootId,
  canUseAnnotationContext,
}: Pick<
  ResolvePreviewPluginResultAnnotationEffectParams,
  'file' | 'rootId' | 'canUseAnnotationContext'
>): ActiveAnnotationContext | null {
  if (!file || file.kind !== 'file' || !rootId || !canUseAnnotationContext) {
    return null
  }
  return { file, rootId }
}

function findUnhandledSuccessfulQueueItem(
  queueItems: readonly PluginResultQueueItem[],
  toolName: string,
  handledQueueItemId: string | null
): PluginResultQueueItem | null {
  const item = queueItems.find((queueItem) => (
    queueItem.toolName === toolName
    && queueItem.status === 'success'
  ))
  if (!item || handledQueueItemId === item.id) return null
  return item
}

export function resolveLocalDataAnnotationEffect(
  params: ResolvePreviewPluginResultAnnotationEffectParams
): PreviewPluginResultAnnotationEffect {
  const annotationContext = resolveActiveAnnotationContext(params)
  if (!annotationContext) {
    return { kind: 'reset-handled-queue-item' }
  }

  const latestLocalDataSuccess = findUnhandledSuccessfulQueueItem(
    params.queueItems,
    'local.data',
    params.handledQueueItemId
  )
  if (!latestLocalDataSuccess) return { kind: 'none' }

  const setValueResult = readPreviewLocalDataSetValueResult(latestLocalDataSuccess.result)
  if (setValueResult) {
    return {
      kind: 'patch-annotation-set-value',
      handledQueueItemId: latestLocalDataSuccess.id,
      rootId: annotationContext.rootId,
      relativePath: setValueResult.relativePath,
      fieldKey: setValueResult.fieldKey,
      value: setValueResult.value,
    }
  }

  return {
    kind: 'refresh-file-annotation',
    handledQueueItemId: latestLocalDataSuccess.id,
    rootId: annotationContext.rootId,
    relativePath: annotationContext.file.path,
  }
}

export function resolveVisionFaceAnnotationEffect(
  params: ResolvePreviewPluginResultAnnotationEffectParams
): PreviewPluginResultAnnotationEffect {
  const annotationContext = resolveActiveAnnotationContext(params)
  if (!annotationContext) {
    return { kind: 'reset-handled-queue-item' }
  }

  const latestVisionFaceSuccess = findUnhandledSuccessfulQueueItem(
    params.queueItems,
    'vision.face',
    params.handledQueueItemId
  )
  if (!latestVisionFaceSuccess) return { kind: 'none' }

  return {
    kind: 'refresh-file-annotation',
    handledQueueItemId: latestVisionFaceSuccess.id,
    rootId: annotationContext.rootId,
    relativePath: annotationContext.file.path,
  }
}
