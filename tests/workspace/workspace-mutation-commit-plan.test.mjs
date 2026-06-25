import assert from 'node:assert/strict'
import test from 'node:test'

import {
  runWorkspaceMutationCommitEffects,
  resolveWorkspaceMutationCommitEffects,
  resolveWorkspacePreviewMutationCommitEffects,
} from '../../src/features/workspace/lib/workspaceMutationCommitPlan.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

test('Workspace Mutation Commit Plan opens the next file after preview soft delete cleanup', () => {
  const deletedFile = file('notes/a.txt', {
    absolutePath: '/root/notes/a.txt',
  })
  const nextFile = file('notes/b.txt')

  assert.deepEqual(
    resolveWorkspacePreviewMutationCommitEffects({
      params: {
        mutationToolName: 'fs.softDelete',
        deletedRelativePath: 'notes/a.txt',
      },
      activeSurface: { kind: 'projection', tabId: 'projection-1' },
      activeSurfaceFileItems: [deletedFile, nextFile],
      activePreviewFile: deletedFile,
      isPreviewModalOpen: true,
    }),
    [
      {
        kind: 'prune-deleted-projection-tabs',
        params: {
          deletedAbsolutePaths: ['/root/notes/a.txt'],
          deletedProjectionPaths: ['notes/a.txt'],
          projectionTabId: 'projection-1',
        },
      },
      {
        kind: 'open-file',
        target: 'modal',
        file: nextFile,
      },
      { kind: 'refresh-current-path' },
      { kind: 'refresh-filter-tag-snapshots' },
      { kind: 'push-delete-undo-batch' },
    ],
  )
})

test('Workspace Mutation Commit Plan prunes projections after workspace soft delete cleanup', () => {
  assert.deepEqual(
    resolveWorkspaceMutationCommitEffects({
      mutationToolName: 'fs.softDelete',
      deletedAbsolutePaths: ['/root/albums/a.jpg'],
      deletedProjectionPaths: ['albums/a.jpg'],
      projectionTabId: 'projection-1',
    }),
    [
      {
        kind: 'prune-deleted-projection-tabs',
        params: {
          deletedAbsolutePaths: ['/root/albums/a.jpg'],
          deletedProjectionPaths: ['albums/a.jpg'],
          projectionTabId: 'projection-1',
        },
      },
      { kind: 'refresh-current-path' },
      { kind: 'refresh-filter-tag-snapshots' },
      { kind: 'push-delete-undo-batch' },
    ],
  )
})

test('Workspace Mutation Commit Plan runner executes commit effects in order', async () => {
  const openedFile = file('albums/b.txt')
  const calls = []

  await runWorkspaceMutationCommitEffects([
    {
      kind: 'prune-deleted-projection-tabs',
      params: {
        deletedAbsolutePaths: ['/root/albums/a.txt'],
        deletedProjectionPaths: ['albums/a.txt'],
        projectionTabId: 'projection-1',
      },
    },
    { kind: 'open-file', target: 'primary', file: openedFile },
    { kind: 'refresh-current-path' },
    { kind: 'refresh-filter-tag-snapshots' },
    { kind: 'push-delete-undo-batch' },
  ], {
    pruneDeletedProjectionTabs: (params) => calls.push(['prune', params]),
    alignPreviewToPath: (path) => calls.push(['align', path]),
    navigateMediaNext: (target) => calls.push(['navigate-media-next', target]),
    openFile: (target, item) => calls.push(['open-file', target, item.path]),
    refreshCurrentPath: async () => calls.push(['refresh-current-path']),
    refreshFilterTagSnapshots: async () => calls.push(['refresh-filter-tag-snapshots']),
    pushDeleteUndoBatch: () => calls.push(['push-delete-undo-batch']),
  })

  assert.deepEqual(calls, [
    ['prune', {
      deletedAbsolutePaths: ['/root/albums/a.txt'],
      deletedProjectionPaths: ['albums/a.txt'],
      projectionTabId: 'projection-1',
    }],
    ['open-file', 'primary', 'albums/b.txt'],
    ['refresh-current-path'],
    ['refresh-filter-tag-snapshots'],
    ['push-delete-undo-batch'],
  ])
})
