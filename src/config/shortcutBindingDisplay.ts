import type { ShortcutBinding } from '../lib/keyboard.ts'

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

export function describeShortcutBinding(binding: ShortcutBinding): string {
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
