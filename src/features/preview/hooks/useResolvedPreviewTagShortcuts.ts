import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useKeyboardShortcuts, usePreviewTagShortcuts } from '@/config/shortcutStore'
import { detectShortcutConflictWarnings, type ConfiguredPreviewTagShortcut } from '@/config/shortcuts'
import { matchesAnyShortcut } from '@/lib/keyboard'
import {
  getAnnotationDisplayStoreVersion,
  getFileLogicalTags,
  getGlobalAnnotationTagOptions,
  getGlobalAnnotationTagOptionsState,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'

export interface ResolvedPreviewTagShortcut extends ConfiguredPreviewTagShortcut {
  alreadyBound: boolean
}

interface UseResolvedPreviewTagShortcutsParams {
  rootId?: string | null
  relativePath?: string | null
  enabled?: boolean
}

const emittedWarnings = new Set<string>()

function emitWarningOnce(warning: string) {
  if (!warning || emittedWarnings.has(warning)) return
  emittedWarnings.add(warning)
  console.warn(`[shortcuts] ${warning}`)
}

export function useResolvedPreviewTagShortcuts({
  rootId,
  relativePath,
  enabled = true,
}: UseResolvedPreviewTagShortcutsParams) {
  const keyboardShortcuts = useKeyboardShortcuts()
  const configuredPreviewTagShortcuts = usePreviewTagShortcuts()
  const annotationDisplayStoreVersion = useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )

  const globalTagOptionsState = getGlobalAnnotationTagOptionsState()
  const availableTagKeys = useMemo(() => {
    void annotationDisplayStoreVersion
    return new Set(getGlobalAnnotationTagOptions().map((option) => option.tagKey))
  }, [annotationDisplayStoreVersion])

  const currentFileMetaAnnotationTagKeys = useMemo(() => {
    void annotationDisplayStoreVersion
    if (!rootId || !relativePath) return new Set<string>()
    return new Set(
      getFileLogicalTags(rootId, relativePath)
        .filter((tag) => tag.hasMetaAnnotation)
        .map((tag) => tag.tagKey)
    )
  }, [annotationDisplayStoreVersion, relativePath, rootId])

  const resolvedPreviewTagShortcuts = useMemo<ResolvedPreviewTagShortcut[]>(() => {
    if (!enabled || !rootId || !relativePath) return []

    return configuredPreviewTagShortcuts
      .filter((shortcut) => availableTagKeys.has(shortcut.tagKey))
      .map((shortcut) => ({
        ...shortcut,
        alreadyBound: currentFileMetaAnnotationTagKeys.has(shortcut.tagKey),
      }))
  }, [
    availableTagKeys,
    configuredPreviewTagShortcuts,
    currentFileMetaAnnotationTagKeys,
    enabled,
    relativePath,
    rootId,
  ])

  const missingTagWarnings = useMemo(() => {
    if (!enabled) return []
    if (globalTagOptionsState.status !== 'ready' || globalTagOptionsState.error) return []

    return configuredPreviewTagShortcuts
      .filter((shortcut) => !availableTagKeys.has(shortcut.tagKey))
      .map((shortcut) => (
        `Configured tag shortcut "${shortcut.actionId}" ignored because logical tag "${shortcut.key}=${shortcut.value}" is not present in current tag options`
      ))
  }, [availableTagKeys, configuredPreviewTagShortcuts, enabled, globalTagOptionsState.error, globalTagOptionsState.status])

  const conflictWarnings = useMemo(
    () => (enabled ? detectShortcutConflictWarnings(keyboardShortcuts, resolvedPreviewTagShortcuts) : []),
    [enabled, keyboardShortcuts, resolvedPreviewTagShortcuts]
  )

  useEffect(() => {
    for (const warning of [...missingTagWarnings, ...conflictWarnings]) {
      emitWarningOnce(warning)
    }
  }, [conflictWarnings, missingTagWarnings])

  const getMatchingPreviewTagShortcut = useCallback((event: KeyboardEvent): ResolvedPreviewTagShortcut | null => {
    for (const shortcut of resolvedPreviewTagShortcuts) {
      if (matchesAnyShortcut(event, shortcut.bindings)) {
        return shortcut
      }
    }
    return null
  }, [resolvedPreviewTagShortcuts])

  const hasMatchingPreviewTagShortcut = useCallback((event: KeyboardEvent): boolean => {
    return getMatchingPreviewTagShortcut(event) !== null
  }, [getMatchingPreviewTagShortcut])

  return {
    resolvedPreviewTagShortcuts,
    getMatchingPreviewTagShortcut,
    hasMatchingPreviewTagShortcut,
  }
}
