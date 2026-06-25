import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLocalChildDirectoryPath,
  isLocalVirtualTrashPath,
  mergeCachedLocalRootEntries,
  resolveLocalNavigationTarget,
  resolveLocalParentPath,
  readLocalRootNameFromPath,
  sortLocalChildDirectoryNames,
  toLocalListingItems,
} from '../../src/features/explorer/lib/localFileSystemModel.ts'

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
    ...overrides,
  }
}

test('Local File System Model applies a base Root-relative Path to browser Listing results', () => {
  const result = toLocalListingItems({
    directories: [directory('raw')],
    files: [file('photo.jpg')],
  }, {
    basePath: '/albums/2026/',
    flattened: false,
  })

  assert.deepEqual(result.map((item) => item.path), [
    'albums/2026/raw',
    'albums/2026/photo.jpg',
  ])
})

test('Local File System Model keeps only files for Flattened Listings', () => {
  const result = toLocalListingItems({
    directories: [directory('raw')],
    files: [file('photo.jpg')],
  }, {
    basePath: 'albums',
    flattened: true,
  })

  assert.deepEqual(result.map((item) => item.path), ['albums/photo.jpg'])
})

test('Local File System Model reads display names from host paths', () => {
  assert.equal(readLocalRootNameFromPath('/Users/kevin/Pictures/', '根目录'), 'Pictures')
  assert.equal(readLocalRootNameFromPath('C:\\media\\albums\\', '根目录'), 'albums')
  assert.equal(readLocalRootNameFromPath('', '根目录'), '根目录')
})

test('Local File System Model recognizes the virtual Root Trash path after normalization', () => {
  assert.equal(isLocalVirtualTrashPath('/@trash/', '@trash'), true)
  assert.equal(isLocalVirtualTrashPath('albums/@trash', '@trash'), false)
})

test('Local File System Model sorts child directory names for address suggestions', () => {
  assert.deepEqual(sortLocalChildDirectoryNames(['第10组', 'alpha', '第2组']), [
    '第2组',
    '第10组',
    'alpha',
  ])
})

test('Local File System Model merges Cached Roots with Local Root Bindings', () => {
  const result = mergeCachedLocalRootEntries({
    cachedRoots: [
      {
        rootId: 'root-a',
        rootName: 'Cached Photos',
        lastUsedAt: 20,
      },
      {
        rootId: 'root-b',
        rootName: 'Bound Clips',
        lastUsedAt: 10,
        boundRootPath: '/stale/path',
      },
    ],
    bindings: [
      {
        rootId: 'root-b',
        rootPath: '/media/clips',
      },
      {
        rootId: 'root-c',
        rootPath: '/media/new-root/',
      },
    ],
    rootLabelFallback: '根目录',
  })

  assert.deepEqual(result, [
    {
      rootId: 'root-a',
      rootName: 'Cached Photos',
      lastUsedAt: 20,
      boundRootPath: undefined,
    },
    {
      rootId: 'root-b',
      rootName: 'Bound Clips',
      lastUsedAt: 10,
      boundRootPath: '/media/clips',
    },
    {
      rootId: 'root-c',
      rootName: 'new-root',
      lastUsedAt: 0,
      boundRootPath: '/media/new-root/',
    },
  ])
})

test('Local File System Model builds child and parent Root-relative Paths', () => {
  assert.equal(createLocalChildDirectoryPath('albums/2026', 'raw'), 'albums/2026/raw')
  assert.equal(createLocalChildDirectoryPath('', '/raw/'), 'raw')

  assert.equal(resolveLocalParentPath('albums/2026/raw', '@trash'), 'albums/2026')
  assert.equal(resolveLocalParentPath('albums', '@trash'), '')
  assert.equal(resolveLocalParentPath('', '@trash'), null)
  assert.equal(resolveLocalParentPath('/@trash/', '@trash'), '')
})

test('Local File System Model resolves navigation targets with virtual Trash and Flattened Listing state', () => {
  assert.deepEqual(resolveLocalNavigationTarget({
    targetPath: '/albums/2026/',
    currentFlattened: true,
    resetFlattened: false,
    virtualTrashPath: '@trash',
  }), {
    path: 'albums/2026',
    isVirtualTrash: false,
    flattened: true,
  })

  assert.deepEqual(resolveLocalNavigationTarget({
    targetPath: 'albums',
    currentFlattened: true,
    resetFlattened: true,
    virtualTrashPath: '@trash',
  }), {
    path: 'albums',
    isVirtualTrash: false,
    flattened: false,
  })

  assert.deepEqual(resolveLocalNavigationTarget({
    targetPath: '/@trash/',
    currentFlattened: true,
    resetFlattened: false,
    virtualTrashPath: '@trash',
  }), {
    path: '@trash',
    isVirtualTrash: true,
    flattened: false,
  })
})
