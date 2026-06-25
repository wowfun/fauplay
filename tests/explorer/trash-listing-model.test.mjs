import assert from 'node:assert/strict'
import test from 'node:test'

import {
  toUnifiedTrashListingItems,
} from '../../src/features/explorer/lib/trashListingModel.ts'

function trashFile(name, overrides = {}) {
  return {
    name,
    path: name,
    kind: 'file',
    ...overrides,
  }
}

test('Trash Listing Model combines Root Trash and Global Trash files in listing order', () => {
  const rootTrashFiles = [
    trashFile('.trash/old-root.jpg', {
      deletedAt: 10,
      sourceType: 'root_trash',
    }),
    trashFile('.trash/new-root.jpg', {
      deletedAt: 30,
      sourceType: 'root_trash',
    }),
  ]
  const globalTrashFiles = [
    trashFile('/home/kevin/deleted-a.jpg', {
      deletedAt: 30,
      sourceType: 'global_recycle',
    }),
    trashFile('/home/kevin/deleted-z.jpg', {
      deletedAt: 5,
      sourceType: 'global_recycle',
    }),
  ]

  assert.deepEqual(
    toUnifiedTrashListingItems({
      rootTrashFiles,
      globalTrashFiles,
    }).map((item) => item.path),
    [
      '/home/kevin/deleted-a.jpg',
      '.trash/new-root.jpg',
      '.trash/old-root.jpg',
      '/home/kevin/deleted-z.jpg',
    ],
  )
  assert.deepEqual(rootTrashFiles.map((item) => item.path), ['.trash/old-root.jpg', '.trash/new-root.jpg'])
})
