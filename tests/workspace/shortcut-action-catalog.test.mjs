import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmptyKeyboardShortcuts,
  getShortcutActionTarget,
  getShortcutBindingsForAction,
  setShortcutActionBindings,
  shortcutActionDisplayDescriptors,
} from '../../src/config/shortcutActionCatalog.ts'

test('Shortcut Action Catalog resolves action metadata by action id', () => {
  assert.deepEqual(getShortcutActionTarget('preview_next'), {
    group: 'preview',
    action: 'next',
    implicitBinding: {
      ctrl: false,
      meta: false,
      alt: false,
    },
    label: '下一个媒体项',
    order: 110,
  })
})

test('Shortcut Action Catalog sets and reads cloned action bindings', () => {
  const shortcuts = createEmptyKeyboardShortcuts()
  setShortcutActionBindings(shortcuts, 'preview_next', [{ key: 'arrowright' }])

  const bindings = getShortcutBindingsForAction(shortcuts, 'preview_next')
  bindings[0].key = 'mutated'

  assert.deepEqual(getShortcutBindingsForAction(shortcuts, 'preview_next'), [
    { key: 'arrowright' },
  ])
})

test('Shortcut Action Catalog exposes display descriptors in group order', () => {
  assert.deepEqual(shortcutActionDisplayDescriptors.slice(0, 3).map((descriptor) => descriptor.actionId), [
    'app_open_directory',
    'app_navigate_up',
    'app_undo_delete',
  ])
})
