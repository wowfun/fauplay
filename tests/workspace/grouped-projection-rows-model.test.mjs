import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGroupedProjectionRowsModel,
  resolveGroupedProjectionItemInteraction,
  resolveGroupedProjectionKeyboardIntent,
  resolveGroupedProjectionRangeSelection,
  resolveGroupedProjectionSelectedPathState,
  resolveGroupedProjectionVisibleSelectionState,
  resolveGroupedProjectionVerticalNeighborIndex,
} from '../../src/features/workspace/lib/groupedProjectionRowsModel.ts'

function file(path, groupId) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    groupId,
  }
}

function directory(path, groupId) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'directory',
    groupId,
  }
}

test('Grouped Projection Rows Model preserves column intent when navigating between Duplicate Sets', () => {
  const model = buildGroupedProjectionRowsModel([
    file('set-a/one.jpg', 'set-a'),
    file('set-a/two.jpg', 'set-a'),
    file('set-a/three.jpg', 'set-a'),
    file('set-b/one.jpg', 'set-b'),
    file('set-b/two.jpg', 'set-b'),
    file('set-c/one.jpg', 'set-c'),
    file('set-c/two.jpg', 'set-c'),
    file('set-c/three.jpg', 'set-c'),
  ])

  assert.deepEqual(model.rows.map((row) => ({
    groupId: row.groupId,
    indexes: row.items.map((item) => item.index),
  })), [
    { groupId: 'set-a', indexes: [0, 1, 2] },
    { groupId: 'set-b', indexes: [3, 4] },
    { groupId: 'set-c', indexes: [5, 6, 7] },
  ])
  assert.equal(resolveGroupedProjectionVerticalNeighborIndex(model, 2, 1), 4)
  assert.equal(resolveGroupedProjectionVerticalNeighborIndex(model, 4, 1), 6)
  assert.equal(resolveGroupedProjectionVerticalNeighborIndex(model, 4, -1), 1)
})

test('Grouped Projection Rows Model selects a contiguous visible range from the active anchor', () => {
  const files = [
    file('set-a/one.jpg', 'set-a'),
    file('set-a/two.jpg', 'set-a'),
    file('set-b/one.jpg', 'set-b'),
    file('set-b/two.jpg', 'set-b'),
  ]

  assert.deepEqual(resolveGroupedProjectionRangeSelection({
    files,
    targetIndex: 99,
    anchorPath: 'set-a/two.jpg',
    fallbackPath: 'set-a/one.jpg',
  }), {
    clampedIndex: 3,
    targetPath: 'set-b/two.jpg',
    selectedPaths: [
      'set-a/two.jpg',
      'set-b/one.jpg',
      'set-b/two.jpg',
    ],
  })
})

test('Grouped Projection Rows Model preserves only visible transient selection state', () => {
  const files = [
    file('set-a/one.jpg', 'set-a'),
    file('set-b/one.jpg', 'set-b'),
  ]

  assert.deepEqual(resolveGroupedProjectionVisibleSelectionState({
    files,
    selectedPaths: [
      'set-a/one.jpg',
      'set-a/deleted.jpg',
      'set-b/one.jpg',
    ],
    selectionAnchorPath: 'set-a/deleted.jpg',
    pendingPreviewPathDuringRange: 'set-b/deleted.jpg',
  }), {
    selectedPaths: [
      'set-a/one.jpg',
      'set-b/one.jpg',
    ],
    selectionAnchorPath: null,
    pendingPreviewPathDuringRange: null,
  })
})

test('Grouped Projection Rows Model repairs selected path focus after visible files change', () => {
  const files = [
    file('set-a/one.jpg', 'set-a'),
    file('set-b/one.jpg', 'set-b'),
  ]

  assert.deepEqual(resolveGroupedProjectionSelectedPathState({
    files,
    selectedIndex: 4,
    selectedPath: 'set-z/deleted.jpg',
  }), {
    selectedIndex: 1,
    selectedPath: 'set-b/one.jpg',
  })

  assert.deepEqual(resolveGroupedProjectionSelectedPathState({
    files: [],
    selectedIndex: 1,
    selectedPath: 'set-b/one.jpg',
  }), {
    selectedIndex: 0,
    selectedPath: null,
  })
})

test('Grouped Projection Rows Model resolves keyboard intents across Duplicate Set rows', () => {
  const model = buildGroupedProjectionRowsModel([
    file('set-a/one.jpg', 'set-a'),
    file('set-a/two.jpg', 'set-a'),
    file('set-a/three.jpg', 'set-a'),
    file('set-b/one.jpg', 'set-b'),
    file('set-b/two.jpg', 'set-b'),
    file('set-c/one.jpg', 'set-c'),
    file('set-c/two.jpg', 'set-c'),
    file('set-c/three.jpg', 'set-c'),
  ])

  assert.deepEqual(resolveGroupedProjectionKeyboardIntent({
    model,
    action: 'move-down',
    currentIndex: 2,
    fileCount: 8,
    pageRowCount: 2,
    selectedCount: 0,
    canClearSelectionWithEscape: true,
  }), {
    kind: 'focus-item',
    index: 4,
  })

  assert.deepEqual(resolveGroupedProjectionKeyboardIntent({
    model,
    action: 'page-down',
    currentIndex: 2,
    fileCount: 8,
    pageRowCount: 2,
    selectedCount: 0,
    canClearSelectionWithEscape: true,
  }), {
    kind: 'focus-item',
    index: 7,
  })

  assert.deepEqual(resolveGroupedProjectionKeyboardIntent({
    model,
    action: 'clear-selection',
    currentIndex: 2,
    fileCount: 8,
    pageRowCount: 2,
    selectedCount: 0,
    canClearSelectionWithEscape: true,
  }), {
    kind: 'none',
  })
})

test('Grouped Projection Rows Model resolves item interaction intents before UI effects', () => {
  const photo = file('set-a/photo.jpg', 'set-a')
  const folder = directory('set-a/folder', 'set-a')

  assert.deepEqual(resolveGroupedProjectionItemInteraction({
    kind: 'toggle-checked',
    file: photo,
    index: 2,
    shiftKey: true,
  }), {
    kind: 'range-select',
    index: 2,
    markedPath: 'set-a/photo.jpg',
  })

  assert.deepEqual(resolveGroupedProjectionItemInteraction({
    kind: 'item-click',
    file: photo,
    index: 2,
    shiftKey: false,
    toggleModifier: true,
  }), {
    kind: 'toggle-check',
    path: 'set-a/photo.jpg',
    anchorPath: 'set-a/photo.jpg',
    markedIndex: 2,
  })

  assert.deepEqual(resolveGroupedProjectionItemInteraction({
    kind: 'item-click',
    file: folder,
    index: 3,
    shiftKey: false,
    toggleModifier: false,
  }), {
    kind: 'open-directory',
    dirName: 'folder',
    anchorPath: 'set-a/folder',
    markedIndex: 3,
  })

  assert.deepEqual(resolveGroupedProjectionItemInteraction({
    kind: 'item-double-click',
    file: photo,
    index: 2,
    canOpenFileInSecondaryTarget: true,
  }), {
    kind: 'open-file-secondary',
    file: photo,
    markedIndex: 2,
  })

  assert.deepEqual(resolveGroupedProjectionItemInteraction({
    kind: 'item-double-click',
    file: folder,
    index: 3,
    canOpenFileInSecondaryTarget: true,
  }), {
    kind: 'none',
  })
})
