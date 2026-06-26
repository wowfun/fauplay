import rawShortcutConfig from '@/config/shortcuts.json'
import {
  cloneKeyboardShortcuts,
  cloneShortcutBindings,
} from './shortcutActionCatalog.ts'
import {
  parseShortcutConfigLayer,
  resolveConfiguredPreviewTagShortcuts,
  resolveKeyboardShortcuts,
  type ConfiguredPreviewTagShortcut,
} from './shortcutConfigModel.ts'

export {
  cloneKeyboardShortcuts,
  getShortcutActionTarget,
  getShortcutBindingsForAction,
  shortcutActionDisplayDescriptors,
} from './shortcutActionCatalog.ts'
export {
  formatShortcutBindingForDisplay,
  formatShortcutBindingsForDisplay,
} from './shortcutBindingDisplay.ts'
export {
  detectShortcutConflictWarnings,
  parseShortcutConfigLayer,
  resolveConfiguredPreviewTagShortcuts,
  resolveKeyboardShortcuts,
} from './shortcutConfigModel.ts'
export type {
  KeyboardShortcuts,
  ShortcutActionDisplayDescriptor,
  ShortcutActionId,
  ShortcutDisplayGroup,
} from './shortcutActionCatalog.ts'
export type {
  ConfiguredPreviewTagShortcut,
  ParsedShortcutConfigLayer,
  ShortcutConfigBindingValue,
  ShortcutConfigFileV1,
  TagShortcutActionId,
} from './shortcutConfigModel.ts'

const defaultShortcutLayer = parseShortcutConfigLayer(rawShortcutConfig, 'src/config/shortcuts.json')

export const defaultShortcutConfigWarnings = defaultShortcutLayer.warnings
export const defaultShortcutConfigLayer = defaultShortcutLayer
export const defaultKeyboardShortcuts = resolveKeyboardShortcuts([defaultShortcutLayer])
export const defaultConfiguredPreviewTagShortcuts = resolveConfiguredPreviewTagShortcuts([defaultShortcutLayer])

export function getDefaultKeyboardShortcuts() {
  return cloneKeyboardShortcuts(defaultKeyboardShortcuts)
}

export function getDefaultConfiguredPreviewTagShortcuts(): ConfiguredPreviewTagShortcut[] {
  return defaultConfiguredPreviewTagShortcuts.map((shortcut) => ({
    ...shortcut,
    bindings: cloneShortcutBindings(shortcut.bindings),
  }))
}
