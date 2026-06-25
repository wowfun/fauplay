import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGroupedProjectionRowsModel,
  resolveGroupedProjectionKeyboardIntent,
  resolveGroupedProjectionRangeSelection,
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
