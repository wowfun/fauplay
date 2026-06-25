import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadFavoriteFoldersFromStorage,
  saveFavoriteFoldersToStorage,
} from '../../src/features/explorer/lib/favoriteFolderStore.ts'

function createStorage(initialValue = null) {
  const writes = []
  return {
    writes,
    getItem() {
      return initialValue
    },
    setItem(_key, value) {
      writes.push(value)
      initialValue = value
    },
  }
}

const options = {
  maxItems: 10,
  rootLabelFallback: '根目录',
}

test('Favorite Folder Store rewrites normalized stored entries after reading', () => {
  const storage = createStorage(JSON.stringify([
    {
      rootId: 'root-1',
      path: '/albums//2026/',
      favoritedAt: 2,
    },
    {
      rootId: 'root-1',
      rootName: 'Photos',
      path: 'albums/2026',
      favoritedAt: 1,
    },
    null,
  ]))

  const entries = loadFavoriteFoldersFromStorage({
    storage,
    storageKey: 'favorites',
    options,
  })

  assert.deepEqual(entries, [{
    rootId: 'root-1',
    rootName: '根目录',
    path: 'albums/2026',
    favoritedAt: 2,
  }])
  assert.equal(storage.writes.length, 1)
  assert.equal(JSON.parse(storage.writes[0])[0].path, 'albums/2026')
})

test('Favorite Folder Store ignores unavailable or failing storage', () => {
  assert.deepEqual(loadFavoriteFoldersFromStorage({
    storage: null,
    storageKey: 'favorites',
    options,
  }), [])

  const throwingStorage = {
    getItem() {
      throw new Error('denied')
    },
    setItem() {
      throw new Error('denied')
    },
  }

  assert.deepEqual(loadFavoriteFoldersFromStorage({
    storage: throwingStorage,
    storageKey: 'favorites',
    options,
  }), [])

  assert.doesNotThrow(() => saveFavoriteFoldersToStorage({
    storage: throwingStorage,
    storageKey: 'favorites',
    entries: [{
      rootId: 'root-1',
      rootName: 'Root',
      path: 'albums',
      favoritedAt: 1,
    }],
  }))
})
