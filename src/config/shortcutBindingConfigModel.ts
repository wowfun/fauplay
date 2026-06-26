import type { ShortcutBinding } from '@/lib/keyboard'

export type ShortcutConfigBindingValue = string[] | 'none'

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

export function serializeShortcutBinding(binding: ShortcutBinding): string {
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

export function parseShortcutBindingValue(params: {
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
