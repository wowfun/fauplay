import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeWorkspaceBrowserHistoryRestoreSnapshot,
  resolveWorkspaceBrowserHistoryRestorePlan,
} from '../../src/features/workspace/lib/browserHistory.ts'

function snapshot(overrides = {}) {
  return {
    accessProvider: 'local-browser',
    rootId: 'root-a',
    path: '',
    previewPath: null,
    previewSurface: null,
    ...overrides,
  }
}

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

test('Workspace Browser History Model resolves restore plans for navigation and previews', () => {
  const currentSnapshot = snapshot({ path: 'albums' })
  const photo = file('albums/photo.jpg')

  assert.deepEqual(resolveWorkspaceBrowserHistoryRestorePlan({
    currentSnapshot,
    pendingSnapshot: snapshot({ path: 'albums' }),
    currentPath: 'albums',
    filteredFiles: [photo],
  }), {
    kind: 'commit-current',
  })

  assert.deepEqual(resolveWorkspaceBrowserHistoryRestorePlan({
    currentSnapshot,
    pendingSnapshot: snapshot({ path: 'archive' }),
    currentPath: 'albums',
    filteredFiles: [photo],
  }), {
    kind: 'navigate',
    path: 'archive',
  })

  assert.deepEqual(resolveWorkspaceBrowserHistoryRestorePlan({
    currentSnapshot: snapshot({
      path: 'albums',
      previewPath: 'albums/photo.jpg',
      previewSurface: 'pane',
    }),
    pendingSnapshot: snapshot({ path: 'albums', previewPath: null }),
    currentPath: 'albums',
    filteredFiles: [photo],
  }), {
    kind: 'close-previews',
  })

  assert.deepEqual(resolveWorkspaceBrowserHistoryRestorePlan({
    currentSnapshot,
    pendingSnapshot: snapshot({
      path: 'albums',
      previewPath: 'albums/photo.jpg',
      previewSurface: 'lightbox',
    }),
    currentPath: 'albums',
    filteredFiles: [photo],
  }), {
    kind: 'open-lightbox',
    file: photo,
  })

  assert.deepEqual(resolveWorkspaceBrowserHistoryRestorePlan({
    currentSnapshot,
    pendingSnapshot: snapshot({
      path: 'albums',
      previewPath: 'albums/missing.jpg',
      previewSurface: 'pane',
    }),
    currentPath: 'albums',
    filteredFiles: [photo],
  }), {
    kind: 'close-previews-and-commit-current',
  })
})

test('Workspace Browser History Model adapts pane preview restores to the current presentation support', () => {
  assert.deepEqual(normalizeWorkspaceBrowserHistoryRestoreSnapshot({
    snapshot: snapshot({
      path: 'albums',
      previewPath: 'albums/photo.jpg',
      previewSurface: 'pane',
    }),
    supportsPersistentPreviewPane: false,
  }), snapshot({
    path: 'albums',
    previewPath: 'albums/photo.jpg',
    previewSurface: 'lightbox',
  }))

  assert.deepEqual(normalizeWorkspaceBrowserHistoryRestoreSnapshot({
    snapshot: snapshot({
      path: 'albums',
      previewPath: 'albums/photo.jpg',
      previewSurface: 'pane',
    }),
    supportsPersistentPreviewPane: true,
  }), snapshot({
    path: 'albums',
    previewPath: 'albums/photo.jpg',
    previewSurface: 'pane',
  }))

  assert.deepEqual(normalizeWorkspaceBrowserHistoryRestoreSnapshot({
    snapshot: snapshot({
      path: 'albums',
      previewPath: null,
      previewSurface: null,
    }),
    supportsPersistentPreviewPane: false,
  }), snapshot({
    path: 'albums',
    previewPath: null,
    previewSurface: null,
  }))
})
