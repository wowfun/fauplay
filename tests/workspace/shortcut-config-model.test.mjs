import assert from 'node:assert/strict'
import test from 'node:test'

import {
  detectShortcutConflictWarnings,
  parseShortcutConfigLayer,
  resolveConfiguredPreviewTagShortcuts,
  resolveKeyboardShortcuts,
} from '../../src/config/shortcutConfigModel.ts'

test('Shortcut Config Model parses shortcut layers and resolves preview tag overrides', () => {
  const baseLayer = parseShortcutConfigLayer({
    version: 1,
    keybinds: {
      preview_next: ['right', 'd'],
      preview_prev: ['left'],
      'tag:rating=5': ['5'],
    },
  }, 'base')
  const overrideLayer = parseShortcutConfigLayer({
    version: 1,
    keybinds: {
      preview_next: ['shift+right'],
      preview_prev: 'none',
      'tag:rating=5': 'none',
      'tag:subject=portrait': ['shift+1'],
    },
  }, 'override')

  assert.deepEqual(baseLayer.warnings, [])
  assert.deepEqual(overrideLayer.warnings, [])

  const shortcuts = resolveKeyboardShortcuts([baseLayer, overrideLayer])
  assert.deepEqual(shortcuts.preview.next, [
    { key: 'arrowright', ctrl: false, meta: false, alt: false, shift: true },
  ])
  assert.deepEqual(shortcuts.preview.prev, [])

  assert.deepEqual(resolveConfiguredPreviewTagShortcuts([baseLayer, overrideLayer]), [
    {
      actionId: 'tag:subject=portrait',
      key: 'subject',
      value: 'portrait',
      tagKey: 'subject=portrait',
      bindings: [
        { key: '1', ctrl: false, meta: false, alt: false, shift: true },
      ],
    },
  ])
})

test('Shortcut Config Model reports conflicts between catalog and preview tag shortcuts', () => {
  const layer = parseShortcutConfigLayer({
    version: 1,
    keybinds: {
      preview_next: ['right'],
      'tag:rating=5': ['right'],
    },
  }, 'root')

  const shortcuts = resolveKeyboardShortcuts([layer])
  const tagShortcuts = resolveConfiguredPreviewTagShortcuts([layer])

  assert.deepEqual(detectShortcutConflictWarnings(shortcuts, tagShortcuts), [
    'Shortcut conflict on "right": preview_next, tag:rating=5',
  ])
})
