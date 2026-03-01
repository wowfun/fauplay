export interface ShortcutBinding {
  key?: string
  code?: string
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
  primary?: boolean
}

function normalizeKeyboardValue(value: string): string {
  if (value === ' ') return 'space'
  return value.toLowerCase()
}

function matchesModifier(actual: boolean, expected?: boolean): boolean {
  if (expected === undefined) return true
  return actual === expected
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (binding.key !== undefined && normalizeKeyboardValue(event.key) !== normalizeKeyboardValue(binding.key)) {
    return false
  }

  if (binding.code !== undefined && normalizeKeyboardValue(event.code) !== normalizeKeyboardValue(binding.code)) {
    return false
  }

  if (binding.primary !== undefined) {
    const hasPrimaryModifier = event.ctrlKey || event.metaKey
    if (hasPrimaryModifier !== binding.primary) {
      return false
    }
  }

  return (
    matchesModifier(event.ctrlKey, binding.ctrl) &&
    matchesModifier(event.metaKey, binding.meta) &&
    matchesModifier(event.altKey, binding.alt) &&
    matchesModifier(event.shiftKey, binding.shift)
  )
}

export function matchesAnyShortcut(event: KeyboardEvent, bindings: readonly ShortcutBinding[]): boolean {
  return bindings.some((binding) => matchesShortcut(event, binding))
}
