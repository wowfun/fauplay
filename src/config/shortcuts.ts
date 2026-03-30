import rawShortcutConfig from '@/config/shortcuts.json'
import type { ShortcutBinding } from '@/lib/keyboard'

export type ShortcutConfigBindingValue = string[] | 'none'
export type TagShortcutActionId = `tag:${string}`

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

export interface ShortcutConfigFileV1 {
  version: 1
  keybinds: Record<string, ShortcutConfigBindingValue>
}

export interface ConfiguredPreviewTagShortcut {
  actionId: TagShortcutActionId
  key: string
  value: string
  tagKey: string
  bindings: ShortcutBinding[]
}

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

export interface ParsedShortcutConfigLayer {
  source: string
  bindingsByAction: Partial<Record<ShortcutActionId, ShortcutBinding[] | null>>
  previewTagBindingsByActionId: Partial<Record<TagShortcutActionId, ConfiguredPreviewTagShortcut | null>>
  warnings: string[]
}

export type ShortcutDisplayGroup = keyof KeyboardShortcuts

export interface ShortcutActionDisplayDescriptor {
  actionId: ShortcutActionId
  group: ShortcutDisplayGroup
  label: string
  order: number
}

type ShortcutActionTarget = {
  group: keyof KeyboardShortcuts
  action: string
  implicitBinding: Partial<ShortcutBinding>
  label: string
  order: number
}

const shortcutActionTargets: Record<ShortcutActionId, ShortcutActionTarget> = {
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

const shortcutActionIds = Object.keys(shortcutActionTargets) as ShortcutActionId[]

const modifierAliases: Record<string, 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'> = {
  alt: 'alt',
  cmd: 'meta',
  command: 'meta',
  control: 'ctrl',
  ctrl: 'ctrl',
  meta: 'meta',
  mod: 'mod',
  option: 'alt',
  shift: 'shift',
}

const namedKeyAliases: Record<string, string> = {
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  arrowup: 'arrowup',
  backspace: 'backspace',
  delete: 'delete',
  down: 'arrowdown',
  enter: 'enter',
  esc: 'escape',
  escape: 'escape',
  left: 'arrowleft',
  pagedown: 'pagedown',
  pageup: 'pageup',
  return: 'enter',
  right: 'arrowright',
  space: 'space',
  up: 'arrowup',
}

const displayNamedKeys: Record<string, string> = {
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  enter: 'return',
}

const uiNamedKeyLabels: Record<string, string> = {
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  arrowup: 'Up',
  backspace: 'Backspace',
  delete: 'Delete',
  enter: 'Enter',
  escape: 'Esc',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  space: 'Space',
}

const TAG_SHORTCUT_ACTION_PREFIX = 'tag:'
const previewTagShortcutImplicitBinding: Partial<ShortcutBinding> = {
  ctrl: false,
  meta: false,
  alt: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createEmptyKeyboardShortcuts(): KeyboardShortcuts {
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

function cloneBindings(bindings: readonly ShortcutBinding[]): ShortcutBinding[] {
  return bindings.map((binding) => ({ ...binding }))
}

export function cloneKeyboardShortcuts(shortcuts: KeyboardShortcuts): KeyboardShortcuts {
  return {
    app: {
      openDirectory: cloneBindings(shortcuts.app.openDirectory),
      navigateUp: cloneBindings(shortcuts.app.navigateUp),
      undoDelete: cloneBindings(shortcuts.app.undoDelete),
    },
    preview: {
      toggleAutoPlay: cloneBindings(shortcuts.preview.toggleAutoPlay),
      togglePlaybackOrder: cloneBindings(shortcuts.preview.togglePlaybackOrder),
      toggleVideoPlayPause: cloneBindings(shortcuts.preview.toggleVideoPlayPause),
      seekBackward: cloneBindings(shortcuts.preview.seekBackward),
      seekForward: cloneBindings(shortcuts.preview.seekForward),
      cycleVideoPlaybackRate: cloneBindings(shortcuts.preview.cycleVideoPlaybackRate),
      softDelete: cloneBindings(shortcuts.preview.softDelete),
      annotationAssignByDigit: cloneBindings(shortcuts.preview.annotationAssignByDigit),
      openAnnotationTagEditor: cloneBindings(shortcuts.preview.openAnnotationTagEditor),
      prev: cloneBindings(shortcuts.preview.prev),
      next: cloneBindings(shortcuts.preview.next),
      close: cloneBindings(shortcuts.preview.close),
    },
    grid: {
      selectAll: cloneBindings(shortcuts.grid.selectAll),
      clearSelection: cloneBindings(shortcuts.grid.clearSelection),
      moveRight: cloneBindings(shortcuts.grid.moveRight),
      moveLeft: cloneBindings(shortcuts.grid.moveLeft),
      moveDown: cloneBindings(shortcuts.grid.moveDown),
      moveUp: cloneBindings(shortcuts.grid.moveUp),
      pageDown: cloneBindings(shortcuts.grid.pageDown),
      pageUp: cloneBindings(shortcuts.grid.pageUp),
      openSelected: cloneBindings(shortcuts.grid.openSelected),
    },
  }
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

function describeShortcutBinding(binding: ShortcutBinding): string {
  const tokens: string[] = []
  if (binding.primary === true) {
    tokens.push('mod')
  } else {
    if (binding.ctrl === true) tokens.push('ctrl')
    if (binding.meta === true) tokens.push('meta')
  }
  if (binding.alt === true) tokens.push('alt')
  if (binding.shift === true) tokens.push('shift')

  const rawKey = binding.key ?? binding.code ?? ''
  if (rawKey) {
    tokens.push(displayNamedKeys[rawKey] ?? rawKey)
  }

  return tokens.join('+') || 'unknown'
}

function toShortcutDisplayKey(rawKey: string): string {
  if (rawKey in uiNamedKeyLabels) {
    return uiNamedKeyLabels[rawKey] ?? rawKey
  }
  if (rawKey.length === 1 && /^[a-z]$/i.test(rawKey)) {
    return rawKey.toUpperCase()
  }
  return rawKey
}

export function formatShortcutBindingForDisplay(binding: ShortcutBinding): string {
  const tokens: string[] = []
  if (binding.primary === true) {
    tokens.push('Ctrl/Cmd')
  } else {
    if (binding.ctrl === true) tokens.push('Ctrl')
    if (binding.meta === true) tokens.push('Cmd')
  }
  if (binding.alt === true) tokens.push('Alt')
  if (binding.shift === true) tokens.push('Shift')

  const rawKey = binding.key ?? binding.code ?? ''
  if (rawKey) {
    tokens.push(toShortcutDisplayKey(rawKey))
  }

  return tokens.join(' + ') || 'Unknown'
}

export function formatShortcutBindingsForDisplay(bindings: readonly ShortcutBinding[]): string[] {
  return bindings.map((binding) => formatShortcutBindingForDisplay(binding))
}

function normalizeKeyToken(token: string): string | null {
  if (!token) return null
  if (token in namedKeyAliases) {
    return namedKeyAliases[token]
  }
  if (token.length === 1) {
    return token
  }
  return null
}

function toTagShortcutTagKey(key: string, value: string): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function toTagShortcutActionId(key: string, value: string): TagShortcutActionId {
  return `${TAG_SHORTCUT_ACTION_PREFIX}${key}=${value}` as TagShortcutActionId
}

function parseTagShortcutActionId(
  rawActionId: string,
  source: string
): { shortcut: Omit<ConfiguredPreviewTagShortcut, 'bindings'> | null; warning: string | null } | null {
  if (!rawActionId.startsWith(TAG_SHORTCUT_ACTION_PREFIX)) {
    return null
  }

  const rawIdentity = rawActionId.slice(TAG_SHORTCUT_ACTION_PREFIX.length)
  const separatorIndex = rawIdentity.indexOf('=')
  if (separatorIndex <= 0 || separatorIndex === rawIdentity.length - 1) {
    return {
      shortcut: null,
      warning: `${source}: "${rawActionId}" must use "tag:<key>=<value>"`,
    }
  }

  const key = rawIdentity.slice(0, separatorIndex).trim()
  const value = rawIdentity.slice(separatorIndex + 1).trim()
  if (!key || !value) {
    return {
      shortcut: null,
      warning: `${source}: "${rawActionId}" must define both key and value`,
    }
  }

  return {
    shortcut: {
      actionId: toTagShortcutActionId(key, value),
      key,
      value,
      tagKey: toTagShortcutTagKey(key, value),
    },
    warning: null,
  }
}

function parseShortcutBindingString(
  actionId: string,
  rawValue: string,
  source: string,
  implicitBinding: Partial<ShortcutBinding>
): { binding: ShortcutBinding | null; warning: string | null } {
  const normalizedValue = rawValue.trim().toLowerCase()
  if (!normalizedValue) {
    return {
      binding: null,
      warning: `${source}: "${actionId}" contains an empty shortcut token`,
    }
  }

  const rawTokens = normalizedValue.split('+')
  if (rawTokens.some((token) => token.trim().length === 0)) {
    return {
      binding: null,
      warning: `${source}: "${actionId}" has an invalid shortcut "${rawValue}"`,
    }
  }

  let keyToken: string | null = null
  let explicitPrimary = false
  let explicitCtrl = false
  let explicitMeta = false
  let explicitAlt = false
  let explicitShift = false

  for (const rawToken of rawTokens) {
    const token = rawToken.trim().toLowerCase()
    const modifier = modifierAliases[token]
    if (modifier) {
      if (modifier === 'mod') {
        explicitPrimary = true
      } else if (modifier === 'ctrl') {
        explicitCtrl = true
      } else if (modifier === 'meta') {
        explicitMeta = true
      } else if (modifier === 'alt') {
        explicitAlt = true
      } else {
        explicitShift = true
      }
      continue
    }

    const normalizedKey = normalizeKeyToken(token)
    if (!normalizedKey) {
      return {
        binding: null,
        warning: `${source}: "${actionId}" uses unsupported shortcut token "${rawToken}"`,
      }
    }
    if (keyToken !== null) {
      return {
        binding: null,
        warning: `${source}: "${actionId}" must contain exactly one non-modifier key in "${rawValue}"`,
      }
    }
    keyToken = normalizedKey
  }

  if (keyToken === null) {
    return {
      binding: null,
      warning: `${source}: "${actionId}" must define a key in "${rawValue}"`,
    }
  }

  if (explicitPrimary && (explicitCtrl || explicitMeta)) {
    return {
      binding: null,
      warning: `${source}: "${actionId}" cannot mix "mod" with "ctrl" or "meta" in "${rawValue}"`,
    }
  }

  const binding: ShortcutBinding = {
    key: keyToken,
  }

  if (explicitPrimary) binding.primary = true
  if (explicitCtrl) binding.ctrl = true
  if (explicitMeta) binding.meta = true
  if (explicitAlt) binding.alt = true
  if (explicitShift) binding.shift = true

  const hasPrimaryFamilyOverride = (
    binding.primary !== undefined
    || binding.ctrl !== undefined
    || binding.meta !== undefined
  )

  if (!hasPrimaryFamilyOverride) {
    if (implicitBinding.primary !== undefined) {
      binding.primary = implicitBinding.primary
    } else {
      if (implicitBinding.ctrl !== undefined) binding.ctrl = implicitBinding.ctrl
      if (implicitBinding.meta !== undefined) binding.meta = implicitBinding.meta
    }
  }

  if (binding.alt === undefined && implicitBinding.alt !== undefined) {
    binding.alt = implicitBinding.alt
  }
  if (binding.shift === undefined && implicitBinding.shift !== undefined) {
    binding.shift = implicitBinding.shift
  }

  return {
    binding,
    warning: null,
  }
}

function parseShortcutBindingValue(params: {
  actionId: string
  rawValue: unknown
  source: string
  implicitBinding: Partial<ShortcutBinding>
}): { bindings: ShortcutBinding[] | null | undefined; warnings: string[] } {
  const { actionId, rawValue, source, implicitBinding } = params

  if (typeof rawValue === 'string') {
    if (rawValue.trim().toLowerCase() === 'none') {
      return {
        bindings: null,
        warnings: [],
      }
    }
    return {
      bindings: undefined,
      warnings: [`${source}: "${actionId}" must be an array or "none"`],
    }
  }

  if (!Array.isArray(rawValue)) {
    return {
      bindings: undefined,
      warnings: [`${source}: "${actionId}" must be an array or "none"`],
    }
  }

  const warnings: string[] = []
  const nextBindings: ShortcutBinding[] = []
  const seenBindings = new Set<string>()

  for (const item of rawValue) {
    if (typeof item !== 'string') {
      warnings.push(`${source}: "${actionId}" contains a non-string binding and it was ignored`)
      continue
    }

    const parsed = parseShortcutBindingString(actionId, item, source, implicitBinding)
    if (!parsed.binding) {
      if (parsed.warning) warnings.push(parsed.warning)
      continue
    }

    const serialized = serializeShortcutBinding(parsed.binding)
    if (seenBindings.has(serialized)) continue
    seenBindings.add(serialized)
    nextBindings.push(parsed.binding)
  }

  if (nextBindings.length === 0) {
    warnings.push(`${source}: "${actionId}" did not produce any valid bindings and was ignored`)
    return {
      bindings: undefined,
      warnings,
    }
  }

  return {
    bindings: nextBindings,
    warnings,
  }
}

export function parseShortcutConfigLayer(input: unknown, source: string): ParsedShortcutConfigLayer {
  const warnings: string[] = []
  const bindingsByAction: Partial<Record<ShortcutActionId, ShortcutBinding[] | null>> = {}
  const previewTagBindingsByActionId: Partial<Record<TagShortcutActionId, ConfiguredPreviewTagShortcut | null>> = {}

  if (!isRecord(input)) {
    return {
      source,
      bindingsByAction,
      previewTagBindingsByActionId,
      warnings: [`${source}: config root must be an object`],
    }
  }

  if (input.version !== 1) {
    return {
      source,
      bindingsByAction,
      previewTagBindingsByActionId,
      warnings: [`${source}: version must be 1`],
    }
  }

  if (!isRecord(input.keybinds)) {
    return {
      source,
      bindingsByAction,
      previewTagBindingsByActionId,
      warnings: [`${source}: "keybinds" must be an object`],
    }
  }

  for (const [rawActionId, rawValue] of Object.entries(input.keybinds)) {
    if (rawActionId in shortcutActionTargets) {
      const actionId = rawActionId as ShortcutActionId
      const parsedValue = parseShortcutBindingValue({
        actionId,
        rawValue,
        source,
        implicitBinding: shortcutActionTargets[actionId].implicitBinding,
      })
      warnings.push(...parsedValue.warnings)
      if (parsedValue.bindings === undefined) continue
      bindingsByAction[actionId] = parsedValue.bindings
      continue
    }

    const parsedTagShortcut = parseTagShortcutActionId(rawActionId, source)
    if (parsedTagShortcut) {
      if (!parsedTagShortcut.shortcut) {
        if (parsedTagShortcut.warning) warnings.push(parsedTagShortcut.warning)
        continue
      }

      const parsedValue = parseShortcutBindingValue({
        actionId: parsedTagShortcut.shortcut.actionId,
        rawValue,
        source,
        implicitBinding: previewTagShortcutImplicitBinding,
      })
      warnings.push(...parsedValue.warnings)
      if (parsedValue.bindings === undefined) continue
      if (parsedValue.bindings === null) {
        previewTagBindingsByActionId[parsedTagShortcut.shortcut.actionId] = null
        continue
      }

      previewTagBindingsByActionId[parsedTagShortcut.shortcut.actionId] = {
        ...parsedTagShortcut.shortcut,
        bindings: parsedValue.bindings,
      }
      continue
    }

    warnings.push(`${source}: unknown action id "${rawActionId}" ignored`)
  }

  return {
    source,
    bindingsByAction,
    previewTagBindingsByActionId,
    warnings,
  }
}

function setActionBindings(
  shortcuts: KeyboardShortcuts,
  actionId: ShortcutActionId,
  bindings: readonly ShortcutBinding[]
) {
  const target = shortcutActionTargets[actionId]
  ;(shortcuts[target.group] as Record<string, ShortcutBinding[]>)[target.action] = cloneBindings(bindings)
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
  actionId: ShortcutActionId
): ShortcutBinding[] {
  const target = shortcutActionTargets[actionId]
  const bindings = (shortcuts[target.group] as Record<string, ShortcutBinding[]>)[target.action] ?? []
  return cloneBindings(bindings)
}

export function resolveKeyboardShortcuts(layers: readonly ParsedShortcutConfigLayer[]): KeyboardShortcuts {
  const shortcuts = createEmptyKeyboardShortcuts()

  for (const layer of layers) {
    for (const actionId of shortcutActionIds) {
      if (!(actionId in layer.bindingsByAction)) continue
      const nextBindings = layer.bindingsByAction[actionId]
      setActionBindings(shortcuts, actionId, nextBindings ?? [])
    }
  }

  return shortcuts
}

export function resolveConfiguredPreviewTagShortcuts(
  layers: readonly ParsedShortcutConfigLayer[]
): ConfiguredPreviewTagShortcut[] {
  const bindingsByActionId = new Map<TagShortcutActionId, ConfiguredPreviewTagShortcut | null>()

  for (const layer of layers) {
    for (const [actionId, shortcut] of Object.entries(layer.previewTagBindingsByActionId)) {
      bindingsByActionId.set(actionId as TagShortcutActionId, shortcut ?? null)
    }
  }

  return [...bindingsByActionId.values()]
    .filter((shortcut): shortcut is ConfiguredPreviewTagShortcut => shortcut !== null)
    .sort((left, right) => left.actionId.localeCompare(right.actionId))
    .map((shortcut) => ({
      ...shortcut,
      bindings: cloneBindings(shortcut.bindings),
    }))
}

export function detectShortcutConflictWarnings(
  shortcuts: KeyboardShortcuts,
  previewTagShortcuts: readonly ConfiguredPreviewTagShortcut[] = []
): string[] {
  const actionIdsByBinding = new Map<string, string[]>()
  const displayByBinding = new Map<string, string>()

  for (const actionId of shortcutActionIds) {
    const target = shortcutActionTargets[actionId]
    const bindings = (shortcuts[target.group] as Record<string, ShortcutBinding[]>)[target.action] ?? []

    for (const binding of bindings) {
      const serialized = serializeShortcutBinding(binding)
      const actionIds = actionIdsByBinding.get(serialized) ?? []
      actionIds.push(actionId)
      actionIdsByBinding.set(serialized, actionIds)
      if (!displayByBinding.has(serialized)) {
        displayByBinding.set(serialized, describeShortcutBinding(binding))
      }
    }
  }

  for (const shortcut of previewTagShortcuts) {
    for (const binding of shortcut.bindings) {
      const serialized = serializeShortcutBinding(binding)
      const actionIds = actionIdsByBinding.get(serialized) ?? []
      actionIds.push(shortcut.actionId)
      actionIdsByBinding.set(serialized, actionIds)
      if (!displayByBinding.has(serialized)) {
        displayByBinding.set(serialized, describeShortcutBinding(binding))
      }
    }
  }

  const warnings: string[] = []
  for (const [serialized, actionIds] of actionIdsByBinding.entries()) {
    if (actionIds.length <= 1) continue
    warnings.push(
      `Shortcut conflict on "${displayByBinding.get(serialized) ?? serialized}": ${actionIds.join(', ')}`
    )
  }
  return warnings
}

const defaultShortcutLayer = parseShortcutConfigLayer(rawShortcutConfig, 'src/config/shortcuts.json')

export const defaultShortcutConfigWarnings = defaultShortcutLayer.warnings
export const defaultShortcutConfigLayer = defaultShortcutLayer
export const defaultKeyboardShortcuts = resolveKeyboardShortcuts([defaultShortcutLayer])
export const defaultConfiguredPreviewTagShortcuts = resolveConfiguredPreviewTagShortcuts([defaultShortcutLayer])

export function getDefaultKeyboardShortcuts(): KeyboardShortcuts {
  return cloneKeyboardShortcuts(defaultKeyboardShortcuts)
}

export function getDefaultConfiguredPreviewTagShortcuts(): ConfiguredPreviewTagShortcut[] {
  return defaultConfiguredPreviewTagShortcuts.map((shortcut) => ({
    ...shortcut,
    bindings: cloneBindings(shortcut.bindings),
  }))
}
