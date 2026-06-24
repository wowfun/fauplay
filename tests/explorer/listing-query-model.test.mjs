import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LISTING_QUERY,
  isSameListingQuery,
  isSameRuntimeListingPageCursor,
  normalizeListingQuery,
  sortTrashFileItems,
  toRuntimeListingQueryRequest,
} from '../../src/features/explorer/lib/listingQueryModel.ts'

test('Listing Query Model normalizes unsupported query values to the default Listing Query shape', () => {
  assert.deepEqual(
    normalizeListingQuery({
      search: '  cats  ',
      type: 'audio',
      hideEmptyFolders: 1,
      sortBy: 'annotationTime',
      sortOrder: 'sideways',
    }),
    {
      search: 'cats',
      type: 'all',
      hideEmptyFolders: false,
      sortBy: 'name',
      sortOrder: 'asc',
    },
  )
})

test('Listing Query Model preserves Runtime-supported query values', () => {
  assert.deepEqual(
    normalizeListingQuery({
      search: 'raw',
      type: 'image',
      hideEmptyFolders: true,
      sortBy: 'date',
      sortOrder: 'desc',
    }),
    {
      search: 'raw',
      type: 'image',
      hideEmptyFolders: true,
      sortBy: 'date',
      sortOrder: 'desc',
    },
  )
})

test('Listing Query Model converts a Listing Query into a Runtime request', () => {
  assert.deepEqual(
    toRuntimeListingQueryRequest({
      ...DEFAULT_LISTING_QUERY,
      search: 'holiday',
      type: 'video',
      hideEmptyFolders: true,
      sortBy: 'size',
      sortOrder: 'desc',
    }),
    {
      nameContains: 'holiday',
      entryFilter: 'video',
      hideEmptyFolders: true,
      sortBy: 'size',
      sortOrder: 'desc',
    },
  )
})

test('Listing Query Model compares Listing Query and Listing Page cursor identity', () => {
  const query = {
    ...DEFAULT_LISTING_QUERY,
    search: 'raw',
    type: 'image',
  }
  const cursor = {
    rootPath: '/root',
    rootRelativePath: 'albums',
    flattened: true,
    query,
    nextOffset: 500,
  }

  assert.equal(isSameListingQuery(query, { ...query }), true)
  assert.equal(isSameRuntimeListingPageCursor({ ...cursor, query: { ...query } }, cursor), true)
  assert.equal(isSameRuntimeListingPageCursor(null, cursor), false)
  assert.equal(
    isSameRuntimeListingPageCursor({
      ...cursor,
      query: {
        ...query,
        search: 'edited',
      },
    }, cursor),
    false,
  )
  assert.equal(
    isSameRuntimeListingPageCursor({
      ...cursor,
      nextOffset: 1000,
    }, cursor),
    false,
  )
})

test('Listing Query Model sorts Trash items by deleted time, source, then path', () => {
  const items = [
    {
      name: 'b.jpg',
      path: 'b.jpg',
      kind: 'file',
      deletedAt: 10,
      sourceType: 'root_trash',
    },
    {
      name: 'a.jpg',
      path: 'a.jpg',
      kind: 'file',
      deletedAt: 20,
      sourceType: 'global_recycle',
    },
    {
      name: 'c.jpg',
      path: 'c.jpg',
      kind: 'file',
      deletedAt: 20,
      sourceType: 'root_trash',
    },
    {
      name: 'aa.jpg',
      path: 'aa.jpg',
      kind: 'file',
      deletedAt: 20,
      sourceType: 'root_trash',
    },
  ]

  assert.deepEqual(
    sortTrashFileItems(items).map((item) => item.path),
    ['a.jpg', 'aa.jpg', 'c.jpg', 'b.jpg'],
  )
  assert.deepEqual(items.map((item) => item.path), ['b.jpg', 'a.jpg', 'c.jpg', 'aa.jpg'])
})
