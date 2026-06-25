import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolvePreviewPluginMutationCommitParams,
} from '../../src/features/preview/lib/previewPluginMutationModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

test('Preview Plugin Mutation Model derives soft delete commit params from Runtime results', () => {
  assert.deepEqual(resolvePreviewPluginMutationCommitParams({
    toolName: 'fs.softDelete',
    result: {
      result: {
        items: [
          {
            ok: true,
            relativePath: '/albums/deleted.jpg',
            absolutePath: '/root/albums/deleted.jpg',
            nextAbsolutePath: '/root/.trash/deleted.jpg',
          },
          {
            ok: true,
            relativePath: 'albums/deleted.jpg',
            absolutePath: '/root/albums/deleted.jpg',
            nextAbsolutePath: '/root/.trash/deleted-copy.jpg',
          },
          {
            ok: false,
            relativePath: 'albums/failed.jpg',
            absolutePath: '/root/albums/failed.jpg',
          },
        ],
      },
    },
    file: file('albums/deleted.jpg', {
      absolutePath: '/root/albums/deleted.jpg',
    }),
    activeProjectionId: 'projection-1',
  }), {
    mutationToolName: 'fs.softDelete',
    undoRestoreItems: [
      {
        sourceType: 'root_trash',
        originalAbsolutePath: '/root/albums/deleted.jpg',
        absolutePath: '/root/.trash/deleted.jpg',
      },
      {
        sourceType: 'root_trash',
        originalAbsolutePath: '/root/albums/deleted.jpg',
        absolutePath: '/root/.trash/deleted-copy.jpg',
      },
    ],
    deletedRelativePath: 'albums/deleted.jpg',
    deletedAbsolutePaths: ['/root/albums/deleted.jpg'],
    projectionTabId: 'projection-1',
    deletedProjectionPaths: ['albums/deleted.jpg'],
  })
})

test('Preview Plugin Mutation Model leaves non-delete commit params narrow', () => {
  assert.deepEqual(resolvePreviewPluginMutationCommitParams({
    toolName: 'local.data',
    result: {
      result: {
        ok: true,
      },
    },
    file: file('albums/photo.jpg', {
      absolutePath: '/root/albums/photo.jpg',
    }),
    activeProjectionId: 'projection-1',
  }), {
    mutationToolName: 'local.data',
  })
})
