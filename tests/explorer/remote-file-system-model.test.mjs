import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRemoteChildDirectoryPath,
  normalizeRemoteRootRelativePath,
  parseRemoteListingItems,
  resolveRemoteParentPath,
  toRemoteChildDirectoryNames,
  toRemoteFavoriteFolderEntries,
} from '../../src/features/explorer/lib/remoteFileSystemModel.ts'

test('Remote File System Model parses valid remote Listing entries and drops invalid rows', () => {
  const result = parseRemoteListingItems({
    items: [
      {
        name: '  photo.jpg  ',
        path: '/albums/raw/photo.jpg',
        kind: 'file',
        size: '1024',
        lastModifiedMs: '1767225600000',
        mimeType: 'image/jpeg',
        previewKind: 'image',
        displayPath: 'Albums / Raw / photo.jpg',
      },
      {
        name: 'Clips',
        path: 'media/clips/',
        kind: 'directory',
        isEmpty: true,
      },
      {
        name: 'broken',
        path: '',
        kind: 'file',
      },
      {
        name: 'unknown',
        path: 'unknown.bin',
        kind: 'other',
      },
    ],
  }, 'published-root')

  assert.equal(result.length, 2)
  assert.deepEqual(result[0], {
    name: 'photo.jpg',
    path: 'albums/raw/photo.jpg',
    kind: 'file',
    remoteRootId: 'published-root',
    isEmpty: undefined,
    size: 1024,
    lastModifiedMs: 1767225600000,
    lastModified: new Date(1767225600000),
    mimeType: 'image/jpeg',
    previewKind: 'image',
    displayPath: 'Albums / Raw / photo.jpg',
  })
  assert.deepEqual(result[1], {
    name: 'Clips',
    path: 'media/clips',
    kind: 'directory',
    remoteRootId: 'published-root',
    isEmpty: true,
    size: undefined,
    lastModifiedMs: undefined,
    lastModified: undefined,
    mimeType: undefined,
    previewKind: undefined,
    displayPath: 'media/clips',
  })
})

test('Remote File System Model maps Remote Access favorites to UI Favorite Folders', () => {
  const result = toRemoteFavoriteFolderEntries({
    roots: [
      { id: 'root-a', label: 'Photos' },
      { id: 'root-b', label: '' },
    ],
    items: [
      { rootId: 'root-a', path: '/albums/raw/', favoritedAtMs: 20 },
      { rootId: 'missing-root', path: 'ignored', favoritedAtMs: 30 },
      { rootId: 'root-b', path: 'clips', favoritedAtMs: 10 },
    ],
    rootLabelFallback: '根目录',
    toUiRootId: (rootId) => `remote:origin:root:${rootId}`,
  })

  assert.deepEqual(result, [
    {
      rootId: 'remote:origin:root:root-a',
      rootName: 'Photos',
      path: 'albums/raw',
      favoritedAt: 20,
    },
    {
      rootId: 'remote:origin:root:root-b',
      rootName: '根目录',
      path: 'clips',
      favoritedAt: 10,
    },
  ])
})

test('Remote File System Model normalizes Root-relative paths without preserving empty segments', () => {
  assert.equal(normalizeRemoteRootRelativePath('/albums//raw/'), 'albums/raw')
  assert.equal(normalizeRemoteRootRelativePath(''), '')
})

test('Remote File System Model builds child and parent Root-relative Paths', () => {
  assert.equal(createRemoteChildDirectoryPath('albums/2026', '/raw/'), 'albums/2026/raw')
  assert.equal(createRemoteChildDirectoryPath('', 'raw'), 'raw')
  assert.equal(resolveRemoteParentPath('/albums/2026/raw/'), 'albums/2026')
  assert.equal(resolveRemoteParentPath('albums'), '')
  assert.equal(resolveRemoteParentPath(''), null)
})

test('Remote File System Model extracts sorted child directories from a remote Listing response', () => {
  assert.deepEqual(toRemoteChildDirectoryNames({
    items: [
      { name: '第10组', path: 'groups/10', kind: 'directory' },
      { name: 'clip.mp4', path: 'clip.mp4', kind: 'file' },
      { name: 'broken', path: '', kind: 'directory' },
      { name: '第2组', path: 'groups/2', kind: 'directory' },
    ],
  }, 'published-root'), [
    '第2组',
    '第10组',
  ])
})
