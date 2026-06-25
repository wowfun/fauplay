import rawShortcutConfig from '@/config/shortcuts.json'
import type { ShortcutBinding } from '@/lib/keyboard'
import {
  cloneKeyboardShortcuts,
  cloneShortcutBindings,
  createEmptyKeyboardShortcuts,
  setShortcutActionBindings,
  shortcutActionIds,
  shortcutActionTargets,
} from './shortcutActionCatalog.ts'
import type {
  KeyboardShortcuts,
  ShortcutActionId,
} from './shortcutActionCatalog.ts'

export {
  cloneKeyboardShortcuts,
  getShortcutActionTarget,
  getShortcutBindingsForAction,
  shortcutActionDisplayDescriptors,
} from './shortcutActionCatalog.ts'
export type {
  KeyboardShortcuts,
  ShortcutActionDisplayDescriptor,
  ShortcutActionId,
  ShortcutDisplayGroup,
} from './shortcutActionCatalog.ts'

export type ShortcutConfigBindingValue = string[] | 'none'
export type TagShortcutActionId = `tag:${string}`

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

export interface ParsedShortcutConfigLayer {
  source: string
  bindingsByAction: Partial<Record<ShortcutActionId, ShortcutBinding[] | null>>
  previewTagBindingsByActionId: Partial<Record<TagShortcutActionId, ConfiguredPreviewTagShortcut | null>>
  warnings: string[]
}

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
    bindings: cloneShortcutBindings(shortcut.bindings),
  }))
}
