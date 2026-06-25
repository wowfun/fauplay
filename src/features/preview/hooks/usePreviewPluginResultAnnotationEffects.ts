import { useEffect, useRef } from 'react'
import type { PluginResultQueueItem } from '@/features/plugin-runtime/types'
import type { FileItem } from '@/types'
import {
  patchAnnotationSetValue,
  preloadFileAnnotationDisplaySnapshot,
} from '@/features/preview/utils/annotationDisplayStore'
import {
  resolveLocalDataAnnotationEffect,
  resolveVisionFaceAnnotationEffect,
} from '@/features/preview/lib/previewPluginResultAnnotationEffectModel'

interface UsePreviewPluginResultAnnotationEffectsOptions {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  canUseAnnotationContext: boolean
  currentFileQueue: readonly PluginResultQueueItem[]
}

export function usePreviewPluginResultAnnotationEffects({
  file,
  rootHandle,
  rootId,
  canUseAnnotationContext,
  currentFileQueue,
}: UsePreviewPluginResultAnnotationEffectsOptions): void {
  const handledLocalDataQueueItemIdRef = useRef<string | null>(null)
  const handledVisionFaceQueueItemIdRef = useRef<string | null>(null)

  useEffect(() => {
    const effect = resolveLocalDataAnnotationEffect({
      file,
      rootId,
      canUseAnnotationContext,
      queueItems: currentFileQueue,
      handledQueueItemId: handledLocalDataQueueItemIdRef.current,
    })

    if (effect.kind === 'reset-handled-queue-item') {
      handledLocalDataQueueItemIdRef.current = null
      return
    }

    if (effect.kind === 'none') return
    handledLocalDataQueueItemIdRef.current = effect.handledQueueItemId

    if (effect.kind === 'patch-annotation-set-value') {
      patchAnnotationSetValue({
        rootId: effect.rootId,
        relativePath: effect.relativePath,
        fieldKey: effect.fieldKey,
        value: effect.value,
      })
      return
    }

    void preloadFileAnnotationDisplaySnapshot({
      rootId: effect.rootId,
      rootHandle,
      rootLabel: null,
      relativePath: effect.relativePath,
      force: true,
    })
  }, [canUseAnnotationContext, currentFileQueue, file, rootHandle, rootId])

  useEffect(() => {
    const effect = resolveVisionFaceAnnotationEffect({
      file,
      rootId,
      canUseAnnotationContext,
      queueItems: currentFileQueue,
      handledQueueItemId: handledVisionFaceQueueItemIdRef.current,
    })

    if (effect.kind === 'reset-handled-queue-item') {
      handledVisionFaceQueueItemIdRef.current = null
      return
    }

    if (effect.kind === 'none') return
    handledVisionFaceQueueItemIdRef.current = effect.handledQueueItemId

    void preloadFileAnnotationDisplaySnapshot({
      rootId: effect.rootId,
      rootHandle,
      rootLabel: null,
      relativePath: effect.relativePath,
      force: true,
    })
  }, [canUseAnnotationContext, currentFileQueue, file, rootHandle, rootId])
}
