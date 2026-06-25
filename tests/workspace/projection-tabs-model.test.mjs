import assert from 'node:assert/strict'
import test from 'node:test'

import {
  pruneProjectionAfterDeletedAbsolutePaths,
  resolveProjectionTabCloseState,
} from '../../src/features/workspace/lib/projectionTabs.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function projection(id, files) {
  return {
    id,
    title: id,
    files,
  }
}

test('Projection Tabs Model filters deleted absolute paths before activating a projection', () => {
  const original = projection('duplicates', [
    file('albums/a.jpg', { absolutePath: '/root/albums/a.jpg' }),
    file('albums/b.jpg', { absolutePath: '/root/albums/b.jpg' }),
  ])

  assert.equal(
    pruneProjectionAfterDeletedAbsolutePaths(original, new Set()),
    original,
  )

  assert.deepEqual(
    pruneProjectionAfterDeletedAbsolutePaths(original, new Set(['/root/albums/a.jpg'])),
    projection('duplicates', [
      file('albums/b.jpg', { absolutePath: '/root/albums/b.jpg' }),
    ]),
  )

  assert.equal(
    pruneProjectionAfterDeletedAbsolutePaths(original, new Set([
      '/root/albums/a.jpg',
      '/root/albums/b.jpg',
    ])),
    null,
  )
})

test('Projection Tabs Model selects the next neighboring tab when closing the active projection tab', () => {
  const first = projection('first', [file('first/a.jpg')])
  const closing = projection('closing', [file('closing/a.jpg')])
  const next = projection('next', [file('next/a.jpg'), file('next/b.jpg')])

  assert.deepEqual(resolveProjectionTabCloseState({
    projectionTabs: [first, closing, next],
    projectionSelectedPathsById: {
      closing: ['closing/a.jpg'],
      next: ['next/b.jpg'],
    },
    duplicateSelectionRuleByProjectionId: {
      closing: 'keep_newest',
      next: 'keep_oldest',
    },
    projectionFocusedPathById: {
      closing: 'closing/a.jpg',
      next: 'next/b.jpg',
    },
    activeSurface: { kind: 'projection', tabId: 'closing' },
    lastProjectionTabId: 'closing',
    closingTabId: 'closing',
  }), {
    projectionTabs: [first, next],
    projectionSelectedPathsById: {
      next: ['next/b.jpg'],
    },
    duplicateSelectionRuleByProjectionId: {
      next: 'keep_oldest',
    },
    projectionFocusedPathById: {
      next: 'next/b.jpg',
    },
    activeProjectionTabId: 'next',
    activeSurface: { kind: 'projection', tabId: 'next' },
    lastProjectionTabId: 'next',
    shouldCloseResultPanel: false,
    previewAlignment: {
      kind: 'projection',
      path: 'next/b.jpg',
    },
  })
})

test('Projection Tabs Model returns to the directory surface when the last projection tab closes', () => {
  const only = projection('only', [file('only/a.jpg')])

  assert.deepEqual(resolveProjectionTabCloseState({
    projectionTabs: [only],
    projectionSelectedPathsById: {
      only: ['only/a.jpg'],
    },
    duplicateSelectionRuleByProjectionId: {
      only: 'keep_current_or_first',
    },
    projectionFocusedPathById: {
      only: 'only/a.jpg',
    },
    activeSurface: { kind: 'projection', tabId: 'only' },
    lastProjectionTabId: 'only',
    closingTabId: 'only',
  }), {
    projectionTabs: [],
    projectionSelectedPathsById: {},
    duplicateSelectionRuleByProjectionId: {},
    projectionFocusedPathById: {},
    activeProjectionTabId: null,
    activeSurface: { kind: 'directory' },
    lastProjectionTabId: null,
    shouldCloseResultPanel: true,
    previewAlignment: {
      kind: 'directory',
    },
  })
})
