import type { ShortcutBinding } from '@/lib/keyboard'

export type ShortcutActionId =
  | 'app_open_directory'
  | 'app_navigate_up'
  | 'app_undo_delete'
  | 'preview_toggle_autoplay'
  | 'preview_toggle_playback_order'
  | 'preview_toggle_video_play_pause'
  | 'preview_seek_backward'
  | 'preview_seek_forward'
  | 'preview_cycle_video_playback_rate'
  | 'preview_soft_delete'
  | 'preview_annotation_assign_digit'
  | 'preview_open_annotation_tag_editor'
  | 'preview_prev'
  | 'preview_next'
  | 'preview_close'
  | 'grid_select_all'
  | 'grid_clear_selection'
  | 'grid_move_right'
  | 'grid_move_left'
  | 'grid_move_down'
  | 'grid_move_up'
  | 'grid_page_down'
  | 'grid_page_up'
  | 'grid_open_selected'

export interface KeyboardShortcuts {
  app: {
    openDirectory: ShortcutBinding[]
    navigateUp: ShortcutBinding[]
    undoDelete: ShortcutBinding[]
  }
  preview: {
    toggleAutoPlay: ShortcutBinding[]
    togglePlaybackOrder: ShortcutBinding[]
    toggleVideoPlayPause: ShortcutBinding[]
    seekBackward: ShortcutBinding[]
    seekForward: ShortcutBinding[]
    cycleVideoPlaybackRate: ShortcutBinding[]
    softDelete: ShortcutBinding[]
    annotationAssignByDigit: ShortcutBinding[]
    openAnnotationTagEditor: ShortcutBinding[]
    prev: ShortcutBinding[]
    next: ShortcutBinding[]
    close: ShortcutBinding[]
  }
  grid: {
    selectAll: ShortcutBinding[]
    clearSelection: ShortcutBinding[]
    moveRight: ShortcutBinding[]
    moveLeft: ShortcutBinding[]
    moveDown: ShortcutBinding[]
    moveUp: ShortcutBinding[]
    pageDown: ShortcutBinding[]
    pageUp: ShortcutBinding[]
    openSelected: ShortcutBinding[]
  }
}

export type ShortcutDisplayGroup = keyof KeyboardShortcuts

export interface ShortcutActionDisplayDescriptor {
  actionId: ShortcutActionId
  group: ShortcutDisplayGroup
  label: string
  order: number
}

export type ShortcutActionTarget = {
  group: keyof KeyboardShortcuts
  action: string
  implicitBinding: Partial<ShortcutBinding>
  label: string
  order: number
}

export const shortcutActionTargets: Record<ShortcutActionId, ShortcutActionTarget> = {
  app_open_directory: {
    group: 'app',
    action: 'openDirectory',
    implicitBinding: { primary: true },
    label: '选择文件夹',
    order: 10,
  },
  app_navigate_up: {
    group: 'app',
    action: 'navigateUp',
    implicitBinding: {},
    label: '返回上一级目录',
    order: 20,
  },
  app_undo_delete: {
    group: 'app',
    action: 'undoDelete',
    implicitBinding: { primary: true },
    label: '撤销最近删除',
    order: 30,
  },
  preview_toggle_autoplay: {
    group: 'preview',
    action: 'toggleAutoPlay',
    implicitBinding: { ctrl: false, meta: false, alt: false },
    label: '切换自动播放',
    order: 10,
  },
  preview_toggle_playback_order: {
    group: 'preview',
    action: 'togglePlaybackOrder',
    implicitBinding: { ctrl: false, meta: false, alt: false },
    label: '切换遍历模式',
    order: 20,
  },
  preview_toggle_video_play_pause: {
    group: 'preview',
    action: 'toggleVideoPlayPause',
    implicitBinding: { ctrl: false, meta: false, alt: false, shift: false },
    label: '视频播放/暂停',
    order: 30,
  },
  preview_seek_backward: {
    group: 'preview',
    action: 'seekBackward',
    implicitBinding: { ctrl: false, meta: false, alt: false, shift: false },
    label: '视频快退',
    order: 40,
  },
  preview_seek_forward: {
    group: 'preview',
    action: 'seekForward',
    implicitBinding: { ctrl: false, meta: false, alt: false, shift: false },
    label: '视频快进',
    order: 50,
  },
  preview_cycle_video_playback_rate: {
    group: 'preview',
    action: 'cycleVideoPlaybackRate',
    implicitBinding: { ctrl: false, meta: false, alt: false, shift: false },
    label: '循环切换视频倍速',
    order: 60,
  },
  preview_soft_delete: {
    group: 'preview',
    action: 'softDelete',
    implicitBinding: { ctrl: false, meta: false, alt: false },
    label: '软删除当前预览文件',
    order: 70,
  },
  preview_annotation_assign_digit: {
    group: 'preview',
    action: 'annotationAssignByDigit',
    implicitBinding: { ctrl: false, meta: false, alt: false, shift: false },
    label: '快速标注当前文件',
    order: 80,
  },
  preview_open_annotation_tag_editor: {
    group: 'preview',
    action: 'openAnnotationTagEditor',
    implicitBinding: {},
    label: '打开标签绑定面板',
    order: 90,
  },
  preview_prev: {
    group: 'preview',
    action: 'prev',
    implicitBinding: { ctrl: false, meta: false, alt: false },
    label: '上一个媒体项',
    order: 100,
  },
  preview_next: {
    group: 'preview',
    action: 'next',
    implicitBinding: { ctrl: false, meta: false, alt: false },
    label: '下一个媒体项',
    order: 110,
  },
  preview_close: {
    group: 'preview',
    action: 'close',
    implicitBinding: {},
    label: '关闭预览',
    order: 120,
  },
  grid_select_all: {
    group: 'grid',
    action: 'selectAll',
    implicitBinding: { primary: true },
    label: '全选当前可见项',
    order: 10,
  },
  grid_clear_selection: {
    group: 'grid',
    action: 'clearSelection',
    implicitBinding: {},
    label: '清空勾选集合',
    order: 20,
  },
  grid_move_right: {
    group: 'grid',
    action: 'moveRight',
    implicitBinding: {},
    label: '网格向右移动',
    order: 30,
  },
  grid_move_left: {
    group: 'grid',
    action: 'moveLeft',
    implicitBinding: {},
    label: '网格向左移动',
    order: 40,
  },
  grid_move_down: {
    group: 'grid',
    action: 'moveDown',
    implicitBinding: {},
    label: '网格向下移动',
    order: 50,
  },
  grid_move_up: {
    group: 'grid',
    action: 'moveUp',
    implicitBinding: {},
    label: '网格向上移动',
    order: 60,
  },
  grid_page_down: {
    group: 'grid',
    action: 'pageDown',
    implicitBinding: {},
    label: '网格向下翻页',
    order: 70,
  },
  grid_page_up: {
    group: 'grid',
    action: 'pageUp',
    implicitBinding: {},
    label: '网格向上翻页',
    order: 80,
  },
  grid_open_selected: {
    group: 'grid',
    action: 'openSelected',
    implicitBinding: {},
    label: '打开当前选中项',
    order: 90,
  },
}

export const shortcutActionIds = Object.keys(shortcutActionTargets) as ShortcutActionId[]

export function getShortcutActionTarget(actionId: ShortcutActionId): ShortcutActionTarget {
  const target = shortcutActionTargets[actionId]
  return {
    ...target,
    implicitBinding: { ...target.implicitBinding },
  }
}

export function createEmptyKeyboardShortcuts(): KeyboardShortcuts {
  return {
    app: {
      openDirectory: [],
      navigateUp: [],
      undoDelete: [],
    },
    preview: {
      toggleAutoPlay: [],
      togglePlaybackOrder: [],
      toggleVideoPlayPause: [],
      seekBackward: [],
      seekForward: [],
      cycleVideoPlaybackRate: [],
      softDelete: [],
      annotationAssignByDigit: [],
      openAnnotationTagEditor: [],
      prev: [],
      next: [],
      close: [],
    },
    grid: {
      selectAll: [],
      clearSelection: [],
      moveRight: [],
      moveLeft: [],
      moveDown: [],
      moveUp: [],
      pageDown: [],
      pageUp: [],
      openSelected: [],
    },
  }
}

export function cloneShortcutBindings(bindings: readonly ShortcutBinding[]): ShortcutBinding[] {
  return bindings.map((binding) => ({ ...binding }))
}

export function cloneKeyboardShortcuts(shortcuts: KeyboardShortcuts): KeyboardShortcuts {
  return {
    app: {
      openDirectory: cloneShortcutBindings(shortcuts.app.openDirectory),
      navigateUp: cloneShortcutBindings(shortcuts.app.navigateUp),
      undoDelete: cloneShortcutBindings(shortcuts.app.undoDelete),
    },
    preview: {
      toggleAutoPlay: cloneShortcutBindings(shortcuts.preview.toggleAutoPlay),
      togglePlaybackOrder: cloneShortcutBindings(shortcuts.preview.togglePlaybackOrder),
      toggleVideoPlayPause: cloneShortcutBindings(shortcuts.preview.toggleVideoPlayPause),
      seekBackward: cloneShortcutBindings(shortcuts.preview.seekBackward),
      seekForward: cloneShortcutBindings(shortcuts.preview.seekForward),
      cycleVideoPlaybackRate: cloneShortcutBindings(shortcuts.preview.cycleVideoPlaybackRate),
      softDelete: cloneShortcutBindings(shortcuts.preview.softDelete),
      annotationAssignByDigit: cloneShortcutBindings(shortcuts.preview.annotationAssignByDigit),
      openAnnotationTagEditor: cloneShortcutBindings(shortcuts.preview.openAnnotationTagEditor),
      prev: cloneShortcutBindings(shortcuts.preview.prev),
      next: cloneShortcutBindings(shortcuts.preview.next),
      close: cloneShortcutBindings(shortcuts.preview.close),
    },
    grid: {
      selectAll: cloneShortcutBindings(shortcuts.grid.selectAll),
      clearSelection: cloneShortcutBindings(shortcuts.grid.clearSelection),
      moveRight: cloneShortcutBindings(shortcuts.grid.moveRight),
      moveLeft: cloneShortcutBindings(shortcuts.grid.moveLeft),
      moveDown: cloneShortcutBindings(shortcuts.grid.moveDown),
      moveUp: cloneShortcutBindings(shortcuts.grid.moveUp),
      pageDown: cloneShortcutBindings(shortcuts.grid.pageDown),
      pageUp: cloneShortcutBindings(shortcuts.grid.pageUp),
      openSelected: cloneShortcutBindings(shortcuts.grid.openSelected),
    },
  }
}

export function setShortcutActionBindings(
  shortcuts: KeyboardShortcuts,
  actionId: ShortcutActionId,
  bindings: readonly ShortcutBinding[],
) {
  const target = shortcutActionTargets[actionId]
  ;(shortcuts[target.group] as Record<string, ShortcutBinding[]>)[target.action] = cloneShortcutBindings(bindings)
}

export const shortcutActionDisplayDescriptors: ShortcutActionDisplayDescriptor[] = shortcutActionIds
  .map((actionId) => ({
    actionId,
    group: shortcutActionTargets[actionId].group,
    label: shortcutActionTargets[actionId].label,
    order: shortcutActionTargets[actionId].order,
  }))
  .sort((left, right) => {
    if (left.group !== right.group) {
      return left.group.localeCompare(right.group)
    }
    if (left.order !== right.order) {
      return left.order - right.order
    }
    return left.actionId.localeCompare(right.actionId)
  })

export function getShortcutBindingsForAction(
  shortcuts: KeyboardShortcuts,
  actionId: ShortcutActionId,
): ShortcutBinding[] {
  const target = shortcutActionTargets[actionId]
  const bindings = (shortcuts[target.group] as Record<string, ShortcutBinding[]>)[target.action] ?? []
  return cloneShortcutBindings(bindings)
}
