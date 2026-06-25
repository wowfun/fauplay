import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAddressBreadcrumbItems,
  buildAddressSuggestionDisplayPath,
  buildAddressSuggestions,
  buildRootPathDisplayText,
  createAddressChildPath,
  getAddressSuggestionSourceLabel,
  moveAddressSuggestionIndex,
  parseDraftPathSuggestionContext,
  resolveAddressEditKeyboardIntent,
  resolveAddressSuggestionCompletionIndex,
  shouldShowAddressSuggestionPanel,
  sortAddressFavoriteFolders,
  sortAddressPathHistory,
} from '../../src/features/explorer/lib/addressPathModel.ts'

test('Address Path Model parses draft paths into a lookup base and prefix', () => {
  assert.deepEqual(parseDraftPathSuggestionContext('albums/ra'), {
    basePath: 'albums',
    prefix: 'ra',
    normalizedInput: 'albums/ra',
    hasTrailingSlash: false,
  })

  assert.deepEqual(parseDraftPathSuggestionContext('albums/raw/'), {
    basePath: 'albums/raw',
    prefix: '',
    normalizedInput: 'albums/raw',
    hasTrailingSlash: true,
  })
})

test('Address Path Model builds deduped suggestions from child directories, favorites, and history', () => {
  const suggestions = buildAddressSuggestions({
    context: parseDraftPathSuggestionContext('albums/r'),
    childDirectories: ['raw', 'rendered', 'notes'],
    favoriteFolders: [
      {
        rootId: 'local-root',
        rootName: 'Photos',
        path: 'albums/raw',
        favoritedAt: 20,
      },
      {
        rootId: 'other-root',
        rootName: 'Archive',
        path: 'albums/restored',
        favoritedAt: 10,
      },
    ],
    recentPathHistory: [
      {
        rootId: 'local-root',
        rootName: 'Photos',
        path: 'albums/raw/2026',
        visitedAt: 30,
      },
      {
        rootId: 'local-root',
        rootName: 'Photos',
        path: 'albums/rendered',
        visitedAt: 25,
      },
    ],
    currentRootId: 'local-root',
    currentRootLabel: 'Photos',
    maxItems: 12,
  })

  assert.deepEqual(
    suggestions.map((item) => ({
      path: item.path,
      source: item.source,
      rootId: item.rootId,
    })),
    [
      {
        path: 'albums/raw',
        source: 'directory',
        rootId: 'local-root',
      },
      {
        path: 'albums/rendered',
        source: 'directory',
        rootId: 'local-root',
      },
      {
        path: 'albums/restored',
        source: 'favorite',
        rootId: 'other-root',
      },
      {
        path: 'albums/raw/2026',
        source: 'history',
        rootId: 'local-root',
      },
    ],
  )
})

test('Address Path Model formats same-root and cross-root display labels', () => {
  assert.equal(buildRootPathDisplayText('Photos', ''), 'Photos')
  assert.equal(buildRootPathDisplayText('Photos', 'albums/raw'), 'Photos/albums/raw')

  assert.equal(
    buildAddressSuggestionDisplayPath({
      path: 'albums/raw',
      source: 'favorite',
      rootId: 'local-root',
      rootName: 'Photos',
      favoriteEntry: null,
      historyEntry: null,
    }, 'local-root', 'Photos'),
    'albums/raw',
  )

  assert.equal(
    buildAddressSuggestionDisplayPath({
      path: 'albums/restored',
      source: 'favorite',
      rootId: 'other-root',
      rootName: 'Archive',
      favoriteEntry: null,
      historyEntry: null,
    }, 'local-root', 'Photos'),
    'Archive/albums/restored',
  )
})

test('Address Path Model labels suggestion sources for the toolbar', () => {
  assert.equal(getAddressSuggestionSourceLabel('directory'), '目录')
  assert.equal(getAddressSuggestionSourceLabel('favorite'), '收藏')
  assert.equal(getAddressSuggestionSourceLabel('history'), '历史')
})

test('Address Path Model builds breadcrumb items from the current Root-relative Path', () => {
  assert.deepEqual(buildAddressBreadcrumbItems('Photos', '/albums//raw/'), [
    { label: 'Photos', path: '' },
    { label: 'albums', path: 'albums' },
    { label: 'raw', path: 'albums/raw' },
  ])

  assert.deepEqual(buildAddressBreadcrumbItems('', ''), [
    { label: '根目录', path: '' },
  ])
})

test('Address Path Model sorts recent history and favorites by newest first', () => {
  assert.deepEqual(sortAddressPathHistory([
    { rootId: 'root-a', rootName: 'Photos', path: 'old', visitedAt: 10 },
    { rootId: 'root-a', rootName: 'Photos', path: 'new', visitedAt: 30 },
    { rootId: 'root-a', rootName: 'Photos', path: 'middle', visitedAt: 20 },
  ]).map((entry) => entry.path), ['new', 'middle', 'old'])

  assert.deepEqual(sortAddressFavoriteFolders([
    { rootId: 'root-a', rootName: 'Photos', path: 'old', favoritedAt: 10 },
    { rootId: 'root-a', rootName: 'Photos', path: 'new', favoritedAt: 30 },
    { rootId: 'root-a', rootName: 'Photos', path: 'middle', favoritedAt: 20 },
  ]).map((entry) => entry.path), ['new', 'middle', 'old'])
})

test('Address Path Model creates child paths for segment dropdown navigation', () => {
  assert.equal(createAddressChildPath('albums/2026', '/raw/'), 'albums/2026/raw')
  assert.equal(createAddressChildPath('', 'raw'), 'raw')
})

test('Address Path Model moves the active suggestion index with wrapping keyboard navigation', () => {
  assert.equal(moveAddressSuggestionIndex(-1, 3, 'next'), 0)
  assert.equal(moveAddressSuggestionIndex(0, 3, 'next'), 1)
  assert.equal(moveAddressSuggestionIndex(2, 3, 'next'), 0)
  assert.equal(moveAddressSuggestionIndex(-1, 3, 'previous'), 2)
  assert.equal(moveAddressSuggestionIndex(0, 3, 'previous'), 2)
  assert.equal(moveAddressSuggestionIndex(1, 0, 'next'), 1)
})

test('Address Path Model resolves suggestion completion and panel visibility', () => {
  assert.equal(resolveAddressSuggestionCompletionIndex(-1, 3), 0)
  assert.equal(resolveAddressSuggestionCompletionIndex(2, 3), 2)
  assert.equal(resolveAddressSuggestionCompletionIndex(3, 3), null)
  assert.equal(resolveAddressSuggestionCompletionIndex(-1, 0), null)

  assert.equal(shouldShowAddressSuggestionPanel('breadcrumb', 'ready', 2), false)
  assert.equal(shouldShowAddressSuggestionPanel('edit', 'idle', 0), false)
  assert.equal(shouldShowAddressSuggestionPanel('edit', 'idle', 1), true)
  assert.equal(shouldShowAddressSuggestionPanel('edit', 'loading', 0), true)
  assert.equal(shouldShowAddressSuggestionPanel('edit', 'error', 0), true)
})

test('Address Path Model resolves address edit keyboard intents', () => {
  assert.deepEqual(resolveAddressEditKeyboardIntent({
    action: 'cancel',
    activeIndex: 1,
    suggestionCount: 3,
  }), {
    kind: 'cancel-edit',
  })

  assert.deepEqual(resolveAddressEditKeyboardIntent({
    action: 'move-next',
    activeIndex: 2,
    suggestionCount: 3,
  }), {
    kind: 'set-active-suggestion-index',
    index: 0,
  })

  assert.deepEqual(resolveAddressEditKeyboardIntent({
    action: 'complete',
    activeIndex: -1,
    suggestionCount: 3,
  }), {
    kind: 'complete-suggestion',
    index: 0,
  })

  assert.deepEqual(resolveAddressEditKeyboardIntent({
    action: 'move-next',
    activeIndex: 0,
    suggestionCount: 0,
  }), {
    kind: 'none',
  })
})
