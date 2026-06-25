import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveFileGridRenderWindow,
  resolveFileGridSelectedPathState,
  resolveFileGridThumbnailPriority,
  resolveFileGridTransientSelectionState,
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

test('File Grid Viewport Model reuses unchanged render windows and marks visible cells', () => {
  const renderWindow = {
    overscanColumnStartIndex: 0,
    overscanColumnStopIndex: 3,
    overscanRowStartIndex: 0,
    overscanRowStopIndex: 5,
    visibleColumnStartIndex: 1,
    visibleColumnStopIndex: 2,
    visibleRowStartIndex: 1,
    visibleRowStopIndex: 4,
  }

  assert.equal(resolveFileGridRenderWindow(renderWindow, { ...renderWindow }), renderWindow)
  assert.deepEqual(resolveFileGridRenderWindow(renderWindow, {
    ...renderWindow,
    visibleRowStopIndex: 5,
  }), {
    ...renderWindow,
    visibleRowStopIndex: 5,
  })

  assert.equal(resolveFileGridThumbnailPriority({
    rowIndex: 2,
    columnIndex: 1,
    renderWindow,
  }), 'visible')
  assert.equal(resolveFileGridThumbnailPriority({
    rowIndex: 2,
    columnIndex: 3,
    renderWindow,
  }), 'nearby')
})

test('File Grid Viewport Model repairs selected path state after Listing changes', () => {
  const files = [
    { path: 'a.jpg' },
    { path: 'b.jpg' },
    { path: 'c.jpg' },
  ]

  assert.deepEqual(resolveFileGridSelectedPathState({
    files,
    selectedIndex: 0,
    selectedPath: 'c.jpg',
  }), {
    selectedIndex: 2,
    selectedPath: 'c.jpg',
  })

  assert.deepEqual(resolveFileGridSelectedPathState({
    files,
    selectedIndex: 7,
    selectedPath: 'missing.jpg',
  }), {
    selectedIndex: 2,
    selectedPath: 'c.jpg',
  })

  assert.deepEqual(resolveFileGridSelectedPathState({
    files: [],
    selectedIndex: 2,
    selectedPath: 'c.jpg',
  }), {
    selectedIndex: 0,
    selectedPath: null,
  })
})

test('File Grid Viewport Model keeps transient selection paths only while visible', () => {
  const files = [
    { path: 'a.jpg' },
    { path: 'b.jpg' },
  ]

  assert.deepEqual(resolveFileGridTransientSelectionState({
    files,
    selectionAnchorPath: 'a.jpg',
    pendingPreviewPathDuringRange: 'b.jpg',
  }), {
    selectionAnchorPath: 'a.jpg',
    pendingPreviewPathDuringRange: 'b.jpg',
    shouldResetAnchor: false,
  })

  assert.deepEqual(resolveFileGridTransientSelectionState({
    files,
    selectionAnchorPath: 'missing.jpg',
    pendingPreviewPathDuringRange: 'gone.jpg',
  }), {
    selectionAnchorPath: null,
    pendingPreviewPathDuringRange: null,
    shouldResetAnchor: true,
  })
})
