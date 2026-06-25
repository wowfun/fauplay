import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useKeyboardShortcuts, usePreviewTagShortcuts } from '@/config/shortcutStore'
import {
  resolveShortcutHelpEntries,
  type ShortcutHelpEntry,
} from '@/features/explorer/lib/shortcutHelpEntriesModel'
import {
  getAnnotationSchemaStoreVersion,
  resolveActiveDigitAssignment,
  subscribeAnnotationSchemaStore,
} from '@/features/plugin-runtime/utils/annotationSchema'
import {
  getAnnotationDisplayStoreVersion,
  getGlobalAnnotationTagOptions,
  getGlobalAnnotationTagOptionsState,
  preloadGlobalAnnotationTagOptions,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'

export type {
  ShortcutHelpEntry,
  ShortcutHelpGroup,
  ShortcutHelpStatusKind,
} from '@/features/explorer/lib/shortcutHelpEntriesModel'

interface UseShortcutHelpEntriesParams {
  rootId?: string | null
  currentPath: string
  canUndoDelete: boolean
  visibleItemCount: number
  selectedGridCount: number
  hasOpenPreview: boolean
  hasActivePreviewFile: boolean
  hasActiveMediaPreview: boolean
  hasActiveVideoPreview: boolean
  canManagePreviewTags: boolean
  canSoftDeletePreview: boolean
}

export function useShortcutHelpEntries({
  rootId,
  currentPath,
  canUndoDelete,
  visibleItemCount,
  selectedGridCount,
  hasOpenPreview,
  hasActivePreviewFile,
  hasActiveMediaPreview,
  hasActiveVideoPreview,
  canManagePreviewTags,
  canSoftDeletePreview,
}: UseShortcutHelpEntriesParams): ShortcutHelpEntry[] {
  const keyboardShortcuts = useKeyboardShortcuts()
  const configuredPreviewTagShortcuts = usePreviewTagShortcuts()
  const annotationDisplayStoreVersion = useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )
  const annotationSchemaStoreVersion = useSyncExternalStore(
    subscribeAnnotationSchemaStore,
    getAnnotationSchemaStoreVersion,
    getAnnotationSchemaStoreVersion
  )

  useEffect(() => {
    if (configuredPreviewTagShortcuts.length === 0) return
    void preloadGlobalAnnotationTagOptions()
  }, [configuredPreviewTagShortcuts.length])

  const globalTagOptionsState = useMemo(() => {
    void annotationDisplayStoreVersion
    return getGlobalAnnotationTagOptionsState()
  }, [annotationDisplayStoreVersion])
  const availableTagKeys = useMemo(() => {
    void annotationDisplayStoreVersion
    return new Set(getGlobalAnnotationTagOptions().map((option) => option.tagKey))
  }, [annotationDisplayStoreVersion])

  const digitAssignment = useMemo(() => {
    void annotationSchemaStoreVersion
    return resolveActiveDigitAssignment(rootId)
  }, [annotationSchemaStoreVersion, rootId])

  return useMemo(() => resolveShortcutHelpEntries({
    keyboardShortcuts,
    configuredPreviewTagShortcuts,
    availableTagKeys,
    globalTagOptionsState,
    digitAssignment,
    currentPath,
    canUndoDelete,
    visibleItemCount,
    selectedGridCount,
    hasOpenPreview,
    hasActivePreviewFile,
    hasActiveMediaPreview,
    hasActiveVideoPreview,
    canManagePreviewTags,
    canSoftDeletePreview,
  }), [
    availableTagKeys,
    canManagePreviewTags,
    canSoftDeletePreview,
    configuredPreviewTagShortcuts,
    canUndoDelete,
    currentPath,
    digitAssignment,
    globalTagOptionsState,
    hasActiveMediaPreview,
    hasActivePreviewFile,
    hasActiveVideoPreview,
    hasOpenPreview,
    keyboardShortcuts,
    selectedGridCount,
    visibleItemCount,
  ])
}
