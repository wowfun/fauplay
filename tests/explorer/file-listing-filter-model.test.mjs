import assert from 'node:assert/strict'
import test from 'node:test'

import { filterExplorerListingFiles } from '../../src/features/explorer/lib/fileListingFilterModel.ts'

const baseFilter = {
  search: '',
  type: 'all',
  hideEmptyFolders: false,
  sortBy: 'name',
  sortOrder: 'asc',
  annotationFilterMode: 'all',
  annotationIncludeMatchMode: 'or',
  annotationIncludeTagKeys: [],
  annotationExcludeTagKeys: [],
}

function file(name, overrides = {}) {
  return {
    name,
    path: name,
    kind: 'file',
    ...overrides,
  }
}

function directory(name, overrides = {}) {
  return {
    name,
    path: name,
    kind: 'directory',
    isEmpty: false,
    ...overrides,
  }
}

test('Explorer File Listing Filter hides empty folders while keeping files and non-empty folders', () => {
  const result = filterExplorerListingFiles([
    directory('empty', { isEmpty: true }),
    directory('albums', { isEmpty: false }),
    file('photo.jpg'),
  ], {
    ...baseFilter,
    hideEmptyFolders: true,
  })

  assert.deepEqual(result.map((item) => item.name), ['albums', 'photo.jpg'])
})

test('Explorer File Listing Filter applies case-insensitive search before sorting', () => {
  const result = filterExplorerListingFiles([
    file('zebra.jpg'),
    file('Alpha.JPG'),
    file('notes.txt'),
  ], {
    ...baseFilter,
    search: 'A',
  })

  assert.deepEqual(result.map((item) => item.name), ['Alpha.JPG', 'zebra.jpg'])
})

test('Explorer File Listing Filter keeps directories when narrowing to image or video files', () => {
  const items = [
    directory('albums'),
    file('photo.jpg'),
    file('clip.mp4'),
    file('notes.txt'),
  ]

  assert.deepEqual(
    filterExplorerListingFiles(items, {
      ...baseFilter,
      type: 'image',
    }).map((item) => item.name),
    ['albums', 'photo.jpg'],
  )

  assert.deepEqual(
    filterExplorerListingFiles(items, {
      ...baseFilter,
      type: 'video',
    }).map((item) => item.name),
    ['albums', 'clip.mp4'],
  )
})

test('Explorer File Listing Filter sorts directories before files and applies sort order within each kind', () => {
  const result = filterExplorerListingFiles([
    file('a.jpg'),
    directory('b-dir'),
    file('z.jpg'),
    directory('a-dir'),
  ], {
    ...baseFilter,
    sortBy: 'name',
    sortOrder: 'desc',
  })

  assert.deepEqual(result.map((item) => item.name), ['b-dir', 'a-dir', 'z.jpg', 'a.jpg'])
})

test('Explorer File Listing Filter sorts by metadata with name fallback', () => {
  const byDate = filterExplorerListingFiles([
    file('missing-date.jpg'),
    file('newer.jpg', { lastModified: new Date('2026-01-02T00:00:00Z') }),
    file('older.jpg', { lastModified: new Date('2026-01-01T00:00:00Z') }),
  ], {
    ...baseFilter,
    sortBy: 'date',
  })
  assert.deepEqual(byDate.map((item) => item.name), ['missing-date.jpg', 'older.jpg', 'newer.jpg'])

  const bySizeDesc = filterExplorerListingFiles([
    file('unknown-size.jpg'),
    file('small.jpg', { size: 10 }),
    file('large.jpg', { size: 100 }),
  ], {
    ...baseFilter,
    sortBy: 'size',
    sortOrder: 'desc',
  })
  assert.deepEqual(bySizeDesc.map((item) => item.name), ['unknown-size.jpg', 'large.jpg', 'small.jpg'])
})
