import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveFileGridKeyboardIntent,
  resolveFileGridViewportMetrics,
  shouldLoadNextFileGridPage,
} from '../../src/features/explorer/lib/fileGridViewportModel.ts'

test('File Grid Viewport Model resolves columns, rows, and page size from the viewport', () => {
  assert.deepEqual(resolveFileGridViewportMetrics({
    dimensions: { width: 500, height: 300 },
    cardSize: { width: 120, height: 120 },
    gap: 12,
    fileCount: 10,
  }), {
    columnCount: 3,
    rowCount: 4,
    pageSize: 6,
    cellWidth: 132,
    cellHeight: 132,
  })
})

test('File Grid Viewport Model requests the next Listing Page near the rendered tail', () => {
  assert.equal(shouldLoadNextFileGridPage({
    hasNextPage: true,
    isLoadingNextPage: false,
    canLoadNextPage: true,
    fileCount: 30,
    rowCount: 5,
    overscanRowStopIndex: 2,
  }), false)

  assert.equal(shouldLoadNextFileGridPage({
    hasNextPage: true,
    isLoadingNextPage: false,
    canLoadNextPage: true,
    fileCount: 30,
    rowCount: 5,
    overscanRowStopIndex: 3,
  }), true)
})

test('File Grid Viewport Model resolves keyboard navigation intents with clamped indexes', () => {
  assert.deepEqual(resolveFileGridKeyboardIntent({
    action: 'move-down',
    currentIndex: 4,
    fileCount: 10,
    columnCount: 3,
    pageSize: 6,
    selectedCount: 0,
    canClearSelectionWithEscape: true,
  }), {
    kind: 'focus-item',
    index: 7,
  })

  assert.deepEqual(resolveFileGridKeyboardIntent({
    action: 'page-down',
    currentIndex: 7,
    fileCount: 10,
    columnCount: 3,
    pageSize: 6,
    selectedCount: 0,
    canClearSelectionWithEscape: true,
  }), {
    kind: 'focus-item',
    index: 9,
  })

  assert.deepEqual(resolveFileGridKeyboardIntent({
    action: 'clear-selection',
    currentIndex: 7,
    fileCount: 10,
    columnCount: 3,
    pageSize: 6,
    selectedCount: 0,
    canClearSelectionWithEscape: true,
  }), {
    kind: 'none',
  })

  assert.deepEqual(resolveFileGridKeyboardIntent({
    action: 'clear-selection',
    currentIndex: 7,
    fileCount: 10,
    columnCount: 3,
    pageSize: 6,
    selectedCount: 2,
    canClearSelectionWithEscape: true,
  }), {
    kind: 'clear-selection',
  })
})
