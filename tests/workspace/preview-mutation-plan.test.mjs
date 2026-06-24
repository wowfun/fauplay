import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveWorkspacePreviewMutationPlan } from '../../src/features/workspace/lib/previewMutationPlan.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

test('Workspace Preview Mutation Plan aligns to a preferred preview path without delete handling', () => {
  const plan = resolveWorkspacePreviewMutationPlan({
    params: {
      preferredPreviewPath: '/albums/renamed.jpg',
      mutationToolName: 'fs.softDelete',
      deletedRelativePath: 'albums/original.jpg',
    },
    activeSurface: { kind: 'directory' },
    activeSurfaceFileItems: [file('albums/original.jpg')],
    activePreviewFile: file('albums/original.jpg'),
    isPreviewModalOpen: false,
  })

  assert.equal(plan.preferredPreviewPath, 'albums/renamed.jpg')
  assert.equal(plan.shouldPruneDeletedProjectionTabs, false)
  assert.deepEqual(plan.previewContinuation, { kind: 'none' })
})

test('Workspace Preview Mutation Plan falls back to active preview paths for soft delete pruning', () => {
  const activePreviewFile = file('albums/a.jpg', {
    absolutePath: '/root/albums/a.jpg',
  })
  const plan = resolveWorkspacePreviewMutationPlan({
    params: {
      mutationToolName: 'fs.softDelete',
      deletedRelativePath: 'albums/a.jpg',
    },
    activeSurface: { kind: 'projection', tabId: 'projection-1' },
    activeSurfaceFileItems: [activePreviewFile, file('albums/b.jpg')],
    activePreviewFile,
    isPreviewModalOpen: false,
  })

  assert.equal(plan.shouldPruneDeletedProjectionTabs, true)
  assert.deepEqual(plan.pruneDeletedProjectionTabsParams, {
    deletedAbsolutePaths: ['/root/albums/a.jpg'],
    deletedProjectionPaths: ['albums/a.jpg'],
    projectionTabId: 'projection-1',
  })
  assert.deepEqual(plan.previewContinuation, {
    kind: 'navigate-media-next',
    target: 'pane',
  })
})

test('Workspace Preview Mutation Plan opens the next file after deleting an active non-media preview', () => {
  const deletedFile = file('notes/a.txt')
  const nextFile = file('notes/b.txt')
  const plan = resolveWorkspacePreviewMutationPlan({
    params: {
      mutationToolName: 'fs.softDelete',
      deletedRelativePath: 'notes/a.txt',
      deletedProjectionPaths: ['notes/a.txt'],
      projectionTabId: 'projection-1',
    },
    activeSurface: { kind: 'projection', tabId: 'projection-1' },
    activeSurfaceFileItems: [deletedFile, nextFile],
    activePreviewFile: deletedFile,
    isPreviewModalOpen: true,
  })

  assert.deepEqual(plan.previewContinuation, {
    kind: 'open-file',
    target: 'modal',
    file: nextFile,
  })
})

test('Workspace Preview Mutation Plan leaves preview unchanged when the deleted path is not active', () => {
  const plan = resolveWorkspacePreviewMutationPlan({
    params: {
      mutationToolName: 'fs.softDelete',
      deletedRelativePath: 'notes/other.txt',
      deletedProjectionPaths: ['notes/other.txt'],
    },
    activeSurface: { kind: 'directory' },
    activeSurfaceFileItems: [file('notes/a.txt'), file('notes/other.txt')],
    activePreviewFile: file('notes/a.txt'),
    isPreviewModalOpen: false,
  })

  assert.deepEqual(plan.previewContinuation, { kind: 'none' })
  assert.equal(plan.shouldPruneDeletedProjectionTabs, true)
})
