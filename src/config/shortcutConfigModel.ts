import type { ShortcutBinding } from '@/lib/keyboard'
import {
  cloneShortcutBindings,
  createEmptyKeyboardShortcuts,
  setShortcutActionBindings,
  shortcutActionIds,
  shortcutActionTargets,
  type KeyboardShortcuts,
  type ShortcutActionId,
} from './shortcutActionCatalog.ts'
import { describeShortcutBinding } from './shortcutBindingDisplay.ts'
import {
  parseShortcutBindingValue,
  serializeShortcutBinding,
  type ShortcutConfigBindingValue,
} from './shortcutBindingConfigModel.ts'
import {
  parseTagShortcutActionId,
  previewTagShortcutImplicitBinding,
  type ConfiguredPreviewTagShortcut,
  type TagShortcutActionId,
} from './previewTagShortcutConfigModel.ts'

export type {
  ConfiguredPreviewTagShortcut,
  ShortcutConfigBindingValue,
  TagShortcutActionId,
}

export interface ShortcutConfigFileV1 {
  version: 1
  keybinds: Record<string, ShortcutConfigBindingValue>
}

export interface ParsedShortcutConfigLayer {
  source: string
  bindingsByAction: Partial<Record<ShortcutActionId, ShortcutBinding[] | null>>
  previewTagBindingsByActionId: Partial<Record<TagShortcutActionId, ConfiguredPreviewTagShortcut | null>>
  warnings: string[]
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

export function resolveKeyboardShortcuts(layers: readonly ParsedShortcutConfigLayer[]): KeyboardShortcuts {
  const shortcuts = createEmptyKeyboardShortcuts()

  for (const layer of layers) {
    for (const actionId of shortcutActionIds) {
      if (!(actionId in layer.bindingsByAction)) continue
      const nextBindings = layer.bindingsByAction[actionId]
      setShortcutActionBindings(shortcuts, actionId, nextBindings ?? [])
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
      bindings: cloneShortcutBindings(shortcut.bindings),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
