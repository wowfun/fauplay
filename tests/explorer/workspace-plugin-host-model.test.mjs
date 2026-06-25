import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readSuccessfulResultAbsolutePaths,
  resolveWorkspaceAbsoluteDeletePayload,
  resolveWorkspaceMutationCommitParams,
  resolveWorkspaceRecycleRestoreItems,
  resolveWorkspaceRelativeToolPayload,
} from '../../src/features/explorer/lib/workspacePluginHostModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

test('Workspace Plugin Host Model resolves shared Root-relative targets for Runtime tools', () => {
  assert.deepEqual(resolveWorkspaceRelativeToolPayload([
    file('albums/a.jpg', {
      sourceRootPath: '/media/root',
      sourceRelativePath: 'albums/a.jpg',
    }),
    file('albums/b.jpg', {
      sourceRootPath: '/media/root',
      sourceRelativePath: 'albums/b.jpg',
    }),
  ]), {
    rootPath: '/media/root',
    relativePaths: ['albums/a.jpg', 'albums/b.jpg'],
  })

  assert.deepEqual(resolveWorkspaceRelativeToolPayload([
    file('albums/a.jpg'),
  ]), {
    relativePaths: ['albums/a.jpg'],
  })

  assert.equal(resolveWorkspaceRelativeToolPayload([
    file('/media/root/a.jpg'),
  ]), null)

  assert.equal(resolveWorkspaceRelativeToolPayload([
    file('a.jpg', { sourceRootPath: '/root-a', sourceRelativePath: 'a.jpg' }),
    file('b.jpg', { sourceRootPath: '/root-b', sourceRelativePath: 'b.jpg' }),
  ]), null)
})

test('Workspace Plugin Host Model resolves restore and absolute delete payloads', () => {
  assert.deepEqual(resolveWorkspaceRecycleRestoreItems([
    file('@trash/a.jpg', {
      sourceType: 'root_trash',
      absolutePath: '/media/root/.trash/a.jpg',
    }),
    file('@global/b.jpg', {
      sourceType: 'global_recycle',
      recycleId: 'recycle-b',
    }),
  ]), [
    {
      sourceType: 'root_trash',
      absolutePath: '/media/root/.trash/a.jpg',
    },
    {
      sourceType: 'global_recycle',
      recycleId: 'recycle-b',
    },
  ])

  assert.equal(resolveWorkspaceRecycleRestoreItems([
    file('albums/a.jpg'),
  ]), null)

  assert.deepEqual(resolveWorkspaceAbsoluteDeletePayload([
    file('albums/a.jpg', { absolutePath: '/media/root/albums/a.jpg' }),
    file('albums/b.jpg', { absolutePath: '/media/root/albums/b.jpg' }),
  ]), {
    absolutePaths: ['/media/root/albums/a.jpg', '/media/root/albums/b.jpg'],
  })

  assert.equal(resolveWorkspaceAbsoluteDeletePayload([
    file('albums/a.jpg'),
  ]), null)
})

test('Workspace Plugin Host Model derives soft delete mutation params from Runtime results and projection state', () => {
  const result = {
    result: {
      items: [
        {
          ok: true,
          absolutePath: '/media/root/albums/a.jpg',
          nextAbsolutePath: '/media/root/.trash/a.jpg',
        },
        {
          ok: true,
          absolutePath: '/media/root/albums/a.jpg',
          nextAbsolutePath: '/media/root/.trash/a-duplicate.jpg',
        },
        {
          ok: false,
          absolutePath: '/media/root/albums/failed.jpg',
        },
      ],
    },
  }

  assert.deepEqual(readSuccessfulResultAbsolutePaths(result.result), [
    '/media/root/albums/a.jpg',
  ])

  assert.deepEqual(resolveWorkspaceMutationCommitParams({
    toolName: 'fs.softDelete',
    result,
    selectedDeleteAbsoluteArgs: {
      absolutePaths: ['/media/root/albums/a.jpg', '/media/root/albums/b.jpg'],
    },
    activeProjectionId: 'projection-1',
    selectedFileEntries: [
      file('albums/a.jpg'),
      file('albums/b.jpg'),
    ],
  }), {
    mutationToolName: 'fs.softDelete',
    undoRestoreItems: [
      {
        sourceType: 'root_trash',
        originalAbsolutePath: '/media/root/albums/a.jpg',
        absolutePath: '/media/root/.trash/a.jpg',
      },
      {
        sourceType: 'root_trash',
        originalAbsolutePath: '/media/root/albums/a.jpg',
        absolutePath: '/media/root/.trash/a-duplicate.jpg',
      },
    ],
    deletedAbsolutePaths: ['/media/root/albums/a.jpg', '/media/root/albums/b.jpg'],
    projectionTabId: 'projection-1',
    deletedProjectionPaths: ['albums/a.jpg', 'albums/b.jpg'],
  })
})

test('Workspace Plugin Host Model leaves non-delete mutation params narrow', () => {
  assert.deepEqual(resolveWorkspaceMutationCommitParams({
    toolName: 'data.findDuplicateFiles',
    result: { result: { ok: true } },
    selectedDeleteAbsoluteArgs: null,
    activeProjectionId: null,
    selectedFileEntries: [],
  }), {
    mutationToolName: 'data.findDuplicateFiles',
  })
})
