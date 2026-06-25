import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendRuntimeListingPageItems,
  createRuntimeListingPageCursor,
  createRuntimeListingRequest,
} from '../../src/features/explorer/lib/localListingLoadModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function listingQuery(overrides = {}) {
  return {
    search: 'raw',
    type: 'image',
    hideEmptyFolders: true,
    sortBy: 'date',
    sortOrder: 'desc',
    ...overrides,
  }
}

test('Local Listing Load Model builds Runtime Listing requests from a Local Root Binding', () => {
  assert.deepEqual(createRuntimeListingRequest({
    rootPath: '/media/root',
    rootRelativePath: '/albums/2026/',
    flattened: true,
    pageSize: 500,
    query: listingQuery(),
  }), {
    rootPath: '/media/root',
    rootRelativePath: 'albums/2026',
    flattened: true,
    limit: 500,
    nameContains: 'raw',
    entryFilter: 'image',
    hideEmptyFolders: true,
    sortBy: 'date',
    sortOrder: 'desc',
  })

  assert.equal(createRuntimeListingRequest({
    rootPath: null,
    rootRelativePath: 'albums',
    flattened: false,
    pageSize: 500,
    query: listingQuery(),
  }), null)
})

test('Local Listing Load Model keeps a Listing Page cursor only when Runtime reports more entries', () => {
  const cursor = createRuntimeListingPageCursor({
    rootPath: '/media/root',
    rootRelativePath: '/albums/',
    flattened: false,
    query: listingQuery({ search: '' }),
    isTruncated: true,
    nextOffset: 500,
  })

  assert.deepEqual(cursor, {
    rootPath: '/media/root',
    rootRelativePath: 'albums',
    flattened: false,
    query: listingQuery({ search: '' }),
    nextOffset: 500,
  })

  assert.equal(createRuntimeListingPageCursor({
    rootPath: '/media/root',
    rootRelativePath: 'albums',
    flattened: false,
    query: listingQuery(),
    isTruncated: false,
    nextOffset: 500,
  }), null)

  assert.equal(createRuntimeListingPageCursor({
    rootPath: '/media/root',
    rootRelativePath: 'albums',
    flattened: false,
    query: listingQuery(),
    isTruncated: true,
    nextOffset: null,
  }), null)
})

test('Local Listing Load Model appends Runtime Listing Pages without duplicate Root-relative Paths', () => {
  const result = appendRuntimeListingPageItems({
    previousItems: [
      file('albums/a.jpg'),
      file('albums/b.jpg'),
    ],
    nextItems: [
      file('albums/b.jpg', { size: 200 }),
      file('albums/c.jpg'),
    ],
  })

  assert.deepEqual(result.map((item) => item.path), [
    'albums/a.jpg',
    'albums/b.jpg',
    'albums/c.jpg',
  ])
  assert.equal(result[1].size, undefined)
})
