import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useKeyboardShortcuts, usePreviewTagShortcuts } from '@/config/shortcutStore'
import {
  formatShortcutBindingsForDisplay,
  getShortcutBindingsForAction,
  shortcutActionDisplayDescriptors,
  type ShortcutActionId,
} from '@/config/shortcuts'
import { resolveActiveDigitAssignment } from '@/features/plugin-runtime/utils/annotationSchema'
import {
  getAnnotationDisplayStoreVersion,
  getGlobalAnnotationTagOptions,
  getGlobalAnnotationTagOptionsState,
  preloadGlobalAnnotationTagOptions,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'
import type { ShortcutBinding } from '@/lib/keyboard'

export type ShortcutHelpGroup = 'app' | 'grid' | 'preview' | 'tag'
export type ShortcutHelpStatusKind = 'available' | 'unavailable' | 'unbound'

export interface ShortcutHelpEntry {
  id: string
  group: ShortcutHelpGroup
  label: string
  bindings: string[]
  statusKind: ShortcutHelpStatusKind
  statusText: string
  order: number
}

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

interface ShortcutEntryStatus {
  statusKind: Exclude<ShortcutHelpStatusKind, 'unbound'>
  statusText: string
}

function serializeShortcutBinding(binding: ShortcutBinding): string {
  return JSON.stringify({
    key: binding.key ?? null,
    code: binding.code ?? null,
    ctrl: binding.ctrl ?? null,
    meta: binding.meta ?? null,
    alt: binding.alt ?? null,
    shift: binding.shift ?? null,
    primary: binding.primary ?? null,
  })
}

function appendPriorityNote(statusText: string, hasPriorityNote: boolean): string {
  if (!hasPriorityNote) return statusText
  return `${statusText}；激活时优先`
}

function buildBuiltInStatus(params: {
  actionId: ShortcutActionId
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
  hasDigitAssignment: boolean
  digitAssignmentFieldKey: string | null
}): ShortcutEntryStatus {
  const {
    actionId,
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
    hasDigitAssignment,
    digitAssignmentFieldKey,
  } = params

  const hasVisibleItems = visibleItemCount > 0
  const hasGridSelection = selectedGridCount > 0

  switch (actionId) {
    case 'app_open_directory':
      return {
        statusKind: 'available',
        statusText: '全局可用',
      }
    case 'app_navigate_up':
      return currentPath
        ? {
          statusKind: 'available',
          statusText: '当前目录',
        }
        : {
          statusKind: 'unavailable',
          statusText: '已在根目录',
        }
    case 'app_undo_delete':
      return canUndoDelete
        ? {
          statusKind: 'available',
          statusText: '当前有可撤销删除',
        }
        : {
          statusKind: 'unavailable',
          statusText: '当前无可撤销删除',
        }
    case 'grid_select_all':
    case 'grid_move_right':
    case 'grid_move_left':
    case 'grid_move_down':
    case 'grid_move_up':
    case 'grid_page_down':
    case 'grid_page_up':
    case 'grid_open_selected':
      return hasVisibleItems
        ? {
          statusKind: 'available',
          statusText: '当前列表',
        }
        : {
          statusKind: 'unavailable',
          statusText: '当前列表无可见项',
        }
    case 'grid_clear_selection':
      if (hasOpenPreview) {
        return {
          statusKind: 'unavailable',
          statusText: '预览打开时 Esc 优先关闭预览',
        }
      }
      return hasGridSelection
        ? {
          statusKind: 'available',
          statusText: '当前有勾选项',
        }
        : {
          statusKind: 'unavailable',
          statusText: '当前无勾选项',
        }
    case 'preview_close':
      return hasOpenPreview
        ? {
          statusKind: 'available',
          statusText: '当前预览已打开',
        }
        : {
          statusKind: 'unavailable',
          statusText: '当前无打开预览',
        }
    case 'preview_toggle_autoplay':
    case 'preview_toggle_playback_order':
    case 'preview_prev':
    case 'preview_next':
      return hasActiveMediaPreview
        ? {
          statusKind: 'available',
          statusText: '当前媒体预览',
        }
        : {
          statusKind: 'unavailable',
          statusText: hasOpenPreview ? '当前预览不是媒体' : '当前无媒体预览',
        }
    case 'preview_toggle_video_play_pause':
    case 'preview_seek_backward':
    case 'preview_seek_forward':
    case 'preview_cycle_video_playback_rate':
      return hasActiveVideoPreview
        ? {
          statusKind: 'available',
          statusText: '当前视频预览',
        }
        : {
          statusKind: 'unavailable',
          statusText: hasOpenPreview ? '当前预览不是视频' : '当前无视频预览',
        }
    case 'preview_soft_delete':
      if (!hasActivePreviewFile) {
        return {
          statusKind: 'unavailable',
          statusText: '当前无可删除预览',
        }
      }
      return canSoftDeletePreview
        ? {
          statusKind: 'available',
          statusText: '当前预览文件',
        }
        : {
          statusKind: 'unavailable',
          statusText: '软删除能力不可用',
        }
    case 'preview_annotation_assign_digit':
      if (!hasActivePreviewFile) {
        return {
          statusKind: 'unavailable',
          statusText: '当前无可标注预览',
        }
      }
      if (!canManagePreviewTags) {
        return {
          statusKind: 'unavailable',
          statusText: '标注能力不可用',
        }
      }
      if (!hasDigitAssignment) {
        return {
          statusKind: 'unavailable',
          statusText: '当前未配置数字标注字段',
        }
      }
      return {
        statusKind: 'available',
        statusText: digitAssignmentFieldKey ? `当前字段：${digitAssignmentFieldKey}` : '当前预览文件',
      }
    case 'preview_open_annotation_tag_editor':
      if (!hasActivePreviewFile) {
        return {
          statusKind: 'unavailable',
          statusText: '当前无可标注预览',
        }
      }
      return canManagePreviewTags
        ? {
          statusKind: 'available',
          statusText: '当前预览可绑定标签',
        }
        : {
          statusKind: 'unavailable',
          statusText: '标签管理能力不可用',
        }
    default:
      return {
        statusKind: 'unavailable',
        statusText: '当前不可用',
      }
  }
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

  useEffect(() => {
    if (configuredPreviewTagShortcuts.length === 0) return
    void preloadGlobalAnnotationTagOptions()
  }, [configuredPreviewTagShortcuts.length])

  const globalTagOptionsState = getGlobalAnnotationTagOptionsState()
  const availableTagKeys = useMemo(() => {
    void annotationDisplayStoreVersion
    return new Set(getGlobalAnnotationTagOptions().map((option) => option.tagKey))
  }, [annotationDisplayStoreVersion])

  const digitAssignment = useMemo(() => resolveActiveDigitAssignment(rootId), [rootId])

  return useMemo(() => {
    const previewBindingKeys = new Set<string>()
    const builtInEntries: ShortcutHelpEntry[] = shortcutActionDisplayDescriptors.map((descriptor) => {
      const bindings = getShortcutBindingsForAction(keyboardShortcuts, descriptor.actionId)
      if (descriptor.group === 'preview') {
        bindings.forEach((binding) => {
          previewBindingKeys.add(serializeShortcutBinding(binding))
        })
      }

      if (bindings.length === 0) {
        return {
          id: descriptor.actionId,
          group: descriptor.group,
          label: descriptor.label,
          bindings: [],
          statusKind: 'unbound',
          statusText: '当前未配置绑定',
          order: descriptor.order,
        }
      }

      const status = buildBuiltInStatus({
        actionId: descriptor.actionId,
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
        hasDigitAssignment: Boolean(digitAssignment),
        digitAssignmentFieldKey: digitAssignment?.fieldKey ?? null,
      })

      return {
        id: descriptor.actionId,
        group: descriptor.group,
        label: descriptor.label,
        bindings: formatShortcutBindingsForDisplay(bindings),
        statusKind: status.statusKind,
        statusText: status.statusText,
        order: descriptor.order,
      }
    })

    const tagEntries: ShortcutHelpEntry[] = configuredPreviewTagShortcuts
      .map((shortcut, index) => {
        const hasPriorityNote = shortcut.bindings.some((binding) => (
          previewBindingKeys.has(serializeShortcutBinding(binding))
        ))

        let status: ShortcutEntryStatus
        if (!hasActivePreviewFile) {
          status = {
            statusKind: 'unavailable',
            statusText: '当前无可标注预览',
          }
        } else if (!canManagePreviewTags) {
          status = {
            statusKind: 'unavailable',
            statusText: '标签管理能力不可用',
          }
        } else if (globalTagOptionsState.status !== 'ready' && !globalTagOptionsState.error) {
          status = {
            statusKind: 'unavailable',
            statusText: '逻辑标签候选加载中',
          }
        } else if (!availableTagKeys.has(shortcut.tagKey)) {
          status = {
            statusKind: 'unavailable',
            statusText: '目标逻辑标签不存在',
          }
        } else {
          status = {
            statusKind: 'available',
            statusText: '当前预览可绑定该标签',
          }
        }

        return {
          id: shortcut.actionId,
          group: 'tag' as const,
          label: `绑定标签：${shortcut.key} = ${shortcut.value}`,
          bindings: formatShortcutBindingsForDisplay(shortcut.bindings),
          statusKind: status.statusKind,
          statusText: appendPriorityNote(status.statusText, hasPriorityNote),
          order: index,
        }
      })
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'))
      .map((entry, index) => ({
        ...entry,
        order: index,
      }))

    return [...builtInEntries, ...tagEntries]
  }, [
    availableTagKeys,
    canManagePreviewTags,
    canSoftDeletePreview,
    configuredPreviewTagShortcuts,
    canUndoDelete,
    currentPath,
    digitAssignment,
    globalTagOptionsState.error,
    globalTagOptionsState.status,
    hasActiveMediaPreview,
    hasActivePreviewFile,
    hasActiveVideoPreview,
    hasOpenPreview,
    keyboardShortcuts,
    selectedGridCount,
    visibleItemCount,
  ])
}
