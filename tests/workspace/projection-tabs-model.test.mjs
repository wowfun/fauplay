import assert from 'node:assert/strict'
import test from 'node:test'

import {
  pruneProjectionAfterDeletedAbsolutePaths,
  resolveProjectionActivationPlan,
  resolveProjectionFocusedPathByIdUpdate,
  resolveProjectionFileInteractionPlan,
  resolveProjectionPanelDisplayTogglePlan,
  resolveProjectionRuleByIdUpdate,
  resolveProjectionSelectedPathsByIdUpdate,
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

test('Projection Tabs Model updates tab-scoped records without unnecessary churn', () => {
  const selectedPathsById = {
    first: ['a.jpg'],
    second: ['b.jpg'],
  }
  assert.equal(
    resolveProjectionSelectedPathsByIdUpdate(selectedPathsById, 'first', ['a.jpg']),
    selectedPathsById,
  )
  assert.deepEqual(
    resolveProjectionSelectedPathsByIdUpdate(selectedPathsById, 'first', []),
    { second: ['b.jpg'] },
  )
  assert.deepEqual(
    resolveProjectionSelectedPathsByIdUpdate(selectedPathsById, 'third', ['c.jpg']),
    {
      first: ['a.jpg'],
      second: ['b.jpg'],
      third: ['c.jpg'],
    },
  )

  const duplicateRuleById = {
    first: 'keep_newest',
  }
  assert.equal(
    resolveProjectionRuleByIdUpdate(duplicateRuleById, 'first', 'keep_newest'),
    duplicateRuleById,
  )
  assert.deepEqual(
    resolveProjectionRuleByIdUpdate(duplicateRuleById, 'first', null),
    {},
  )
  assert.deepEqual(
    resolveProjectionRuleByIdUpdate(duplicateRuleById, 'second', 'keep_oldest'),
    {
      first: 'keep_newest',
      second: 'keep_oldest',
    },
  )

  const focusedPathById = {
    first: 'a.jpg',
  }
  assert.equal(
    resolveProjectionFocusedPathByIdUpdate(focusedPathById, 'first', 'a.jpg'),
    focusedPathById,
  )
  assert.deepEqual(
    resolveProjectionFocusedPathByIdUpdate(focusedPathById, 'first', null),
    {},
  )
  assert.deepEqual(
    resolveProjectionFocusedPathByIdUpdate(focusedPathById, 'second', 'b.jpg'),
    {
      first: 'a.jpg',
      second: 'b.jpg',
    },
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

test('Projection Tabs Model activates a sanitized projection with preferred preview alignment', () => {
  const existing = projection('existing', [file('existing/a.jpg')])
  const nextProjection = projection('duplicates', [
    file('albums/a.jpg', { absolutePath: '/root/albums/a.jpg' }),
    file('albums/b.jpg', { absolutePath: '/root/albums/b.jpg' }),
  ])

  assert.deepEqual(resolveProjectionActivationPlan({
    projectionTabs: [existing],
    target: {
      kind: 'projection',
      projection: nextProjection,
    },
    projectionFocusedPathById: {
      duplicates: 'albums/b.jpg',
    },
    deletedAbsolutePaths: new Set(['/root/albums/a.jpg']),
  }), {
    kind: 'activate',
    projectionTabs: [
      existing,
      projection('duplicates', [
        file('albums/b.jpg', { absolutePath: '/root/albums/b.jpg' }),
      ]),
    ],
    activeProjectionTabId: 'duplicates',
    activeSurface: { kind: 'projection', tabId: 'duplicates' },
    lastProjectionTabId: 'duplicates',
    shouldOpenResultPanel: true,
    previewAlignment: {
      kind: 'projection',
      path: 'albums/b.jpg',
    },
  })
})

test('Projection Tabs Model activates fallback tabs when reopening the result panel', () => {
  const first = projection('first', [file('first/a.jpg')])
  const last = projection('last', [file('last/a.jpg'), file('last/b.jpg')])

  assert.deepEqual(resolveProjectionActivationPlan({
    projectionTabs: [first, last],
    target: {
      kind: 'fallback',
      activeProjectionTabId: null,
      lastProjectionTabId: 'last',
    },
    projectionFocusedPathById: {
      last: 'last/b.jpg',
    },
  }), {
    kind: 'activate',
    projectionTabs: [first, last],
    activeProjectionTabId: 'last',
    activeSurface: { kind: 'projection', tabId: 'last' },
    lastProjectionTabId: 'last',
    shouldOpenResultPanel: true,
    previewAlignment: {
      kind: 'projection',
      path: 'last/b.jpg',
    },
  })

  assert.deepEqual(resolveProjectionActivationPlan({
    projectionTabs: [first, last],
    target: {
      kind: 'fallback',
      activeProjectionTabId: 'missing',
      lastProjectionTabId: 'also-missing',
    },
    projectionFocusedPathById: {},
  }), {
    kind: 'activate',
    projectionTabs: [first, last],
    activeProjectionTabId: 'first',
    activeSurface: { kind: 'projection', tabId: 'first' },
    lastProjectionTabId: 'first',
    shouldOpenResultPanel: true,
    previewAlignment: {
      kind: 'projection',
      path: 'first/a.jpg',
    },
  })
})

test('Projection Tabs Model resolves result panel display toggles with preview alignment', () => {
  const first = projection('first', [file('first/a.jpg')])
  const last = projection('last', [file('last/a.jpg'), file('last/b.jpg')])

  assert.deepEqual(resolveProjectionPanelDisplayTogglePlan({
    projectionTabs: [first, last],
    activeProjectionTabId: 'missing',
    projectionFocusedPathById: {
      last: 'last/b.jpg',
    },
    currentDisplayMode: 'normal',
    lastNormalHeightPx: 320,
  }), {
    nextDisplayMode: 'maximized',
    nextHeightPx: null,
    activation: {
      activeProjectionTabId: 'first',
      activeSurface: { kind: 'projection', tabId: 'first' },
      lastProjectionTabId: 'first',
      previewAlignment: {
        kind: 'projection',
        path: 'first/a.jpg',
      },
    },
  })

  assert.deepEqual(resolveProjectionPanelDisplayTogglePlan({
    projectionTabs: [first, last],
    activeProjectionTabId: 'last',
    projectionFocusedPathById: {
      last: 'last/b.jpg',
    },
    currentDisplayMode: 'maximized',
    lastNormalHeightPx: 320,
  }), {
    nextDisplayMode: 'normal',
    nextHeightPx: 320,
    activation: {
      activeProjectionTabId: 'last',
      activeSurface: { kind: 'projection', tabId: 'last' },
      lastProjectionTabId: 'last',
      previewAlignment: {
        kind: 'projection',
        path: 'last/b.jpg',
      },
    },
  })
})

test('Projection Tabs Model toggles result panel display without projection activation when no tabs exist', () => {
  assert.deepEqual(resolveProjectionPanelDisplayTogglePlan({
    projectionTabs: [],
    activeProjectionTabId: null,
    projectionFocusedPathById: {},
    currentDisplayMode: 'normal',
    lastNormalHeightPx: 320,
  }), {
    nextDisplayMode: 'maximized',
    nextHeightPx: null,
    activation: null,
  })
})

test('Projection Tabs Model ignores missing explicit tab activation', () => {
  const first = projection('first', [file('first/a.jpg')])

  assert.deepEqual(resolveProjectionActivationPlan({
    projectionTabs: [first],
    target: {
      kind: 'tab',
      tabId: 'missing',
    },
    projectionFocusedPathById: {},
  }), {
    kind: 'none',
  })
})

test('Projection Tabs Model resolves projection item click interactions', () => {
  const clickedFile = file('albums/a.jpg')

  assert.deepEqual(resolveProjectionFileInteractionPlan({
    activeProjectionTabId: 'projection-1',
    item: clickedFile,
    trigger: 'click',
  }), {
    kind: 'activate-item',
    activeProjectionTabId: 'projection-1',
    activeSurface: { kind: 'projection', tabId: 'projection-1' },
    lastProjectionTabId: 'projection-1',
    focusedPath: 'albums/a.jpg',
    openFile: {
      target: 'primary',
      file: clickedFile,
    },
  })

  assert.deepEqual(resolveProjectionFileInteractionPlan({
    activeProjectionTabId: 'projection-1',
    item: {
      name: 'albums',
      path: 'albums',
      kind: 'directory',
    },
    trigger: 'click',
  }), {
    kind: 'activate-item',
    activeProjectionTabId: 'projection-1',
    activeSurface: { kind: 'projection', tabId: 'projection-1' },
    lastProjectionTabId: 'projection-1',
    focusedPath: null,
    openFile: null,
  })
})

test('Projection Tabs Model resolves projection item double-click interactions', () => {
  const targetFile = file('albums/a.jpg')

  assert.deepEqual(resolveProjectionFileInteractionPlan({
    activeProjectionTabId: 'projection-1',
    item: targetFile,
    trigger: 'double-click',
  }), {
    kind: 'activate-item',
    activeProjectionTabId: 'projection-1',
    activeSurface: { kind: 'projection', tabId: 'projection-1' },
    lastProjectionTabId: 'projection-1',
    focusedPath: 'albums/a.jpg',
    openFile: {
      target: 'secondary',
      file: targetFile,
    },
  })

  assert.deepEqual(resolveProjectionFileInteractionPlan({
    activeProjectionTabId: 'projection-1',
    item: {
      name: 'albums',
      path: 'albums',
      kind: 'directory',
    },
    trigger: 'double-click',
  }), {
    kind: 'none',
  })

  assert.deepEqual(resolveProjectionFileInteractionPlan({
    activeProjectionTabId: null,
    item: targetFile,
    trigger: 'click',
  }), {
    kind: 'none',
  })
})
