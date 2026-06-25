import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmptyKeyboardShortcuts,
  setShortcutActionBindings,
} from '../../src/config/shortcutActionCatalog.ts'
import {
  resolveShortcutHelpEntries,
} from '../../src/features/explorer/lib/shortcutHelpEntriesModel.ts'

function createBaseParams(overrides = {}) {
  return {
    keyboardShortcuts: createEmptyKeyboardShortcuts(),
    configuredPreviewTagShortcuts: [],
    availableTagKeys: new Set(),
    globalTagOptionsState: {
      status: 'ready',
      error: null,
    },
    digitAssignment: null,
    currentPath: '',
    canUndoDelete: false,
    visibleItemCount: 0,
    selectedGridCount: 0,
    hasOpenPreview: false,
    hasActivePreviewFile: false,
    hasActiveMediaPreview: false,
    hasActiveVideoPreview: false,
    canManagePreviewTags: false,
    canSoftDeletePreview: false,
    ...overrides,
  }
}

function entryById(entries, id) {
  return entries.find((entry) => entry.id === id)
}

test('Shortcut Help Entries Model marks root navigation availability from the current Root-relative Path', () => {
  const keyboardShortcuts = createEmptyKeyboardShortcuts()
  setShortcutActionBindings(keyboardShortcuts, 'app_navigate_up', [{ key: 'arrowup' }])

  const atRootEntry = entryById(resolveShortcutHelpEntries(createBaseParams({
    keyboardShortcuts,
    currentPath: '',
  })), 'app_navigate_up')
  const nestedEntry = entryById(resolveShortcutHelpEntries(createBaseParams({
    keyboardShortcuts,
    currentPath: 'albums/raw',
  })), 'app_navigate_up')

  assert.deepEqual(atRootEntry, {
    id: 'app_navigate_up',
    group: 'app',
    label: '返回上一级目录',
    bindings: ['Up'],
    statusKind: 'unavailable',
    statusText: '已在根目录',
    order: 20,
  })
  assert.equal(nestedEntry?.statusKind, 'available')
  assert.equal(nestedEntry?.statusText, '当前目录')
})

test('Shortcut Help Entries Model reports the active digit annotation field', () => {
  const keyboardShortcuts = createEmptyKeyboardShortcuts()
  setShortcutActionBindings(keyboardShortcuts, 'preview_annotation_assign_digit', [{ key: '1' }])

  const entry = entryById(resolveShortcutHelpEntries(createBaseParams({
    keyboardShortcuts,
    hasActivePreviewFile: true,
    canManagePreviewTags: true,
    digitAssignment: {
      fieldKey: 'rating',
      valueByDigit: {
        1: 'good',
      },
    },
  })), 'preview_annotation_assign_digit')

  assert.deepEqual(entry, {
    id: 'preview_annotation_assign_digit',
    group: 'preview',
    label: '快速标注当前文件',
    bindings: ['1'],
    statusKind: 'available',
    statusText: '当前字段：rating',
    order: 80,
  })
})

test('Shortcut Help Entries Model appends priority notes for tag shortcuts that share preview bindings', () => {
  const keyboardShortcuts = createEmptyKeyboardShortcuts()
  setShortcutActionBindings(keyboardShortcuts, 'preview_next', [{ key: 'arrowright' }])

  const entries = resolveShortcutHelpEntries(createBaseParams({
    keyboardShortcuts,
    configuredPreviewTagShortcuts: [
      {
        actionId: 'tag:rating=good',
        key: 'rating',
        value: 'good',
        tagKey: 'rating=good',
        bindings: [{ key: 'arrowright' }],
      },
    ],
    availableTagKeys: new Set(['rating=good']),
    hasActivePreviewFile: true,
    canManagePreviewTags: true,
  }))

  assert.deepEqual(entryById(entries, 'tag:rating=good'), {
    id: 'tag:rating=good',
    group: 'tag',
    label: '绑定标签：rating = good',
    bindings: ['Right'],
    statusKind: 'available',
    statusText: '当前预览可绑定该标签；激活时优先',
    order: 0,
  })
})
