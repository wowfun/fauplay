import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import type { FileItem } from '@/types'
import type { PreviewHeaderAnnotationTag } from '@/features/preview/components/PreviewHeaderBar'
import {
  getAnnotationDisplayStoreVersion,
  getFileLogicalTags,
  getGlobalAnnotationTagOptions,
  getGlobalAnnotationTagOptionsState,
  patchAnnotationTagBinding,
  patchAnnotationTagUnbinding,
  preloadFileAnnotationDisplaySnapshot,
  preloadAnnotationDisplaySnapshot,
  preloadGlobalAnnotationTagOptions,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'
import {
  resolvePreviewAnnotationTagMutationPlan,
  type PreviewAnnotationTagMutationOperation,
  type PreviewAnnotationTagMutationTag,
} from '@/features/preview/lib/previewAnnotationTagMutationModel'

interface UsePreviewAnnotationTagActionsOptions {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  canUseAnnotationContext: boolean
  canManageAnnotationTags: boolean
  annotationTagManageUnavailableReason: string | null
}

export function usePreviewAnnotationTagActions({
  file,
  rootHandle,
  rootId,
  canUseAnnotationContext,
  canManageAnnotationTags,
  annotationTagManageUnavailableReason,
}: UsePreviewAnnotationTagActionsOptions) {
  useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )

  useEffect(() => {
    if (!rootId || !canUseAnnotationContext) return
    void preloadAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      rootLabel: null,
    })
  }, [canUseAnnotationContext, rootHandle, rootId])

  useEffect(() => {
    if (!rootId || !file || file.kind !== 'file' || !canUseAnnotationContext) return
    void preloadFileAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      rootLabel: null,
      relativePath: file.path,
      force: true,
    })
  }, [canUseAnnotationContext, file, rootHandle, rootId])

  const refreshCurrentPreviewFileTags = useCallback(async () => {
    if (!file || file.kind !== 'file' || !rootId || !canUseAnnotationContext) return
    await preloadFileAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      rootLabel: null,
      relativePath: file.path,
      force: true,
    })
  }, [canUseAnnotationContext, file, rootHandle, rootId])

  const refreshGlobalAnnotationTagOptions = useCallback(async () => {
    await preloadGlobalAnnotationTagOptions({
      force: true,
    })
  }, [])

  const runAnnotationTagMutation = useCallback(async (
    operation: PreviewAnnotationTagMutationOperation,
    tag: PreviewAnnotationTagMutationTag,
  ) => {
    const plan = resolvePreviewAnnotationTagMutationPlan({
      file,
      rootId,
      rootHandleAvailable: Boolean(rootHandle),
      canManageAnnotationTags,
      unavailableReason: annotationTagManageUnavailableReason,
      operation,
      tag,
    })
    if (!plan.ok) {
      throw new Error(plan.error)
    }

    const rollback = operation === 'bind'
      ? patchAnnotationTagBinding({
        rootId: plan.rootId,
        relativePath: plan.relativePath,
        key: plan.tag.key,
        value: plan.tag.value,
      })
      : patchAnnotationTagUnbinding({
        rootId: plan.rootId,
        relativePath: plan.relativePath,
        key: plan.tag.key,
        value: plan.tag.value,
      })

    try {
      const result = await dispatchSystemTool({
        toolName: 'local.data',
        rootHandle: rootHandle!,
        rootId: plan.rootId,
        additionalArgs: plan.toolArgs,
      })

      if (!result.ok) {
        throw new Error(result.error || (operation === 'bind' ? '标签绑定失败' : '标签删除失败'))
      }

      await Promise.allSettled([
        refreshCurrentPreviewFileTags(),
        refreshGlobalAnnotationTagOptions(),
      ])
    } catch (error) {
      rollback?.()
      await Promise.allSettled([
        refreshCurrentPreviewFileTags(),
        refreshGlobalAnnotationTagOptions(),
      ])
      throw error
    }
  }, [
    annotationTagManageUnavailableReason,
    canManageAnnotationTags,
    file,
    refreshCurrentPreviewFileTags,
    refreshGlobalAnnotationTagOptions,
    rootHandle,
    rootId,
  ])

  const handleRequestAnnotationTagOptions = useCallback(() => {
    if (!canManageAnnotationTags) return
    void preloadGlobalAnnotationTagOptions()
  }, [canManageAnnotationTags])

  const handleBindAnnotationTag = useCallback((tag: PreviewAnnotationTagMutationTag) => {
    return runAnnotationTagMutation('bind', tag)
  }, [runAnnotationTagMutation])

  const handleUnbindAnnotationTag = useCallback((tag: PreviewHeaderAnnotationTag) => {
    return runAnnotationTagMutation('unbind', tag)
  }, [runAnnotationTagMutation])

  const annotationTags: PreviewHeaderAnnotationTag[] = (
    file && file.kind === 'file' && rootId && canUseAnnotationContext
      ? getFileLogicalTags(rootId, file.path).map((tag) => ({
        tagKey: tag.tagKey,
        key: tag.key,
        value: tag.value,
        sources: tag.sources,
        hasMetaAnnotation: tag.hasMetaAnnotation,
        representativeSource: tag.representativeSource,
      }))
      : []
  )

  const annotationTagOptions = getGlobalAnnotationTagOptions()
  const annotationTagOptionsState = getGlobalAnnotationTagOptionsState()

  return {
    annotationTags,
    annotationTagOptions,
    annotationTagOptionsState,
    refreshCurrentPreviewFileTags,
    refreshGlobalAnnotationTagOptions,
    handleRequestAnnotationTagOptions,
    handleBindAnnotationTag,
    handleUnbindAnnotationTag,
  }
}
