import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isFavoriteFolderActive,
  parseFavoriteFolders,
  removeFavoriteFolder,
  toggleFavoriteFolder,
  updateFavoriteFolderRootName,
} from '../../src/features/explorer/lib/favoriteFolderModel.ts'

test('Favorite Folder Model parses stored entries and rewrites invalid or stale data', () => {
  const parsed = parseFavoriteFolders(JSON.stringify([
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: 'albums/raw',
      favoritedAt: 10,
    },
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: '/albums/raw/',
      favoritedAt: 20,
    },
    {
      rootId: 'root-b',
      path: 'clips',
      favoritedAt: 30,
    },
    {
      rootId: 'root-c',
      rootName: 'Archive',
      path: 'ignored',
      favoritedAt: 'not-a-number',
    },
  ]), {
    maxItems: 10,
    rootLabelFallback: '根目录',
  })

  assert.equal(parsed.shouldRewrite, true)
  assert.deepEqual(parsed.entries, [
    {
      rootId: 'root-b',
      rootName: '根目录',
      path: 'clips',
      favoritedAt: 30,
    },
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: 'albums/raw',
      favoritedAt: 20,
    },
  ])
})

test('Favorite Folder Model caps deduped entries by newest favorite time', () => {
  const parsed = parseFavoriteFolders(JSON.stringify([
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: 'albums/a',
      favoritedAt: 10,
    },
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: 'albums/b',
      favoritedAt: 30,
    },
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: 'albums/c',
      favoritedAt: 20,
    },
  ]), {
    maxItems: 2,
    rootLabelFallback: '根目录',
  })

  assert.equal(parsed.shouldRewrite, true)
  assert.deepEqual(parsed.entries.map((entry) => entry.path), ['albums/b', 'albums/c'])
})

test('Favorite Folder Model toggles the current root path without keeping duplicates', () => {
  const existing = [
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: 'albums/raw',
      favoritedAt: 10,
    },
  ]

  assert.deepEqual(
    toggleFavoriteFolder(existing, {
      rootId: 'root-a',
      rootName: 'Photos',
      path: '/albums/raw/',
      favoritedAt: 20,
      maxItems: 10,
      rootLabelFallback: '根目录',
      virtualTrashPath: '@trash',
    }),
    [],
  )

  assert.deepEqual(
    toggleFavoriteFolder(existing, {
      rootId: 'root-a',
      rootName: 'Photos',
      path: 'albums/edited',
      favoritedAt: 20,
      maxItems: 10,
      rootLabelFallback: '根目录',
      virtualTrashPath: '@trash',
    }),
    [
      {
        rootId: 'root-a',
        rootName: 'Photos',
        path: 'albums/edited',
        favoritedAt: 20,
      },
      {
        rootId: 'root-a',
        rootName: 'Photos',
        path: 'albums/raw',
        favoritedAt: 10,
      },
    ],
  )
})

test('Favorite Folder Model excludes virtual trash from favorite state', () => {
  const entries = [
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: '@trash',
      favoritedAt: 10,
    },
  ]

  assert.equal(isFavoriteFolderActive(entries, {
    rootId: 'root-a',
    path: '@trash',
    virtualTrashPath: '@trash',
  }), false)
  assert.deepEqual(toggleFavoriteFolder(entries, {
    rootId: 'root-a',
    rootName: 'Photos',
    path: '@trash',
    favoritedAt: 20,
    maxItems: 10,
    rootLabelFallback: '根目录',
    virtualTrashPath: '@trash',
  }), entries)
})

test('Favorite Folder Model detects active Favorite Folders by normalized root path', () => {
  const entries = [
    {
      rootId: 'root-a',
      rootName: 'Photos',
      path: 'albums/raw',
      favoritedAt: 10,
    },
  ]

  assert.equal(isFavoriteFolderActive(entries, {
    rootId: 'root-a',
    path: '/albums/raw/',
    virtualTrashPath: '@trash',
  }), true)
  assert.equal(isFavoriteFolderActive(entries, {
    rootId: 'root-b',
    path: '/albums/raw/',
    virtualTrashPath: '@trash',
  }), false)
})

test('Favorite Folder Model removes entries and refreshes root names by normalized identity', () => {
  const entries = [
    {
      rootId: 'root-a',
      rootName: 'Old Photos',
      path: 'albums/raw',
      favoritedAt: 10,
    },
    {
      rootId: 'root-b',
      rootName: 'Archive',
      path: 'albums/raw',
      favoritedAt: 20,
    },
  ]

  assert.deepEqual(
    removeFavoriteFolder(entries, {
      rootId: 'root-a',
      path: '/albums/raw/',
    }),
    [
      {
        rootId: 'root-b',
        rootName: 'Archive',
        path: 'albums/raw',
        favoritedAt: 20,
      },
    ],
  )

  assert.deepEqual(
    updateFavoriteFolderRootName(entries, {
      rootId: 'root-a',
      rootName: 'Photos',
      maxItems: 10,
      rootLabelFallback: '根目录',
    }),
    [
      {
        rootId: 'root-b',
        rootName: 'Archive',
        path: 'albums/raw',
        favoritedAt: 20,
      },
      {
        rootId: 'root-a',
        rootName: 'Photos',
        path: 'albums/raw',
        favoritedAt: 10,
      },
    ],
  )
})
