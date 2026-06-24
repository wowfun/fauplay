import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAddressSuggestionDisplayPath,
  buildAddressSuggestions,
  buildRootPathDisplayText,
  getAddressSuggestionSourceLabel,
  parseDraftPathSuggestionContext,
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
