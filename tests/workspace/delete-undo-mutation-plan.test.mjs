import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveWorkspaceMutationDeleteUndoPlan,
  shouldCreateDeleteUndoBatchForMutation,
} from '../../src/features/workspace/lib/deleteUndoMutationPlan.ts'

test('Delete Undo Mutation Plan creates undo batches only for soft delete mutations', () => {
  assert.equal(shouldCreateDeleteUndoBatchForMutation(undefined), false)
  assert.equal(shouldCreateDeleteUndoBatchForMutation({ mutationToolName: 'fs.rename' }), false)
  assert.equal(shouldCreateDeleteUndoBatchForMutation({ mutationToolName: 'fs.softDelete' }), true)
})

test('Delete Undo Mutation Plan prunes projections only for soft delete mutations with deleted paths', () => {
  assert.deepEqual(resolveWorkspaceMutationDeleteUndoPlan({
    mutationToolName: 'fs.rename',
    deletedAbsolutePaths: ['/root/a.jpg'],
    deletedProjectionPaths: ['a.jpg'],
    projectionTabId: 'projection-1',
  }), {
    shouldCreateDeleteUndoBatch: false,
    shouldPruneDeletedProjectionTabs: false,
    pruneDeletedProjectionTabsParams: null,
  })

  assert.deepEqual(resolveWorkspaceMutationDeleteUndoPlan({
    mutationToolName: 'fs.softDelete',
    projectionTabId: 'projection-1',
  }), {
    shouldCreateDeleteUndoBatch: true,
    shouldPruneDeletedProjectionTabs: false,
    pruneDeletedProjectionTabsParams: null,
  })

  assert.deepEqual(resolveWorkspaceMutationDeleteUndoPlan({
    mutationToolName: 'fs.softDelete',
    deletedAbsolutePaths: ['/root/a.jpg'],
    deletedProjectionPaths: ['a.jpg'],
    projectionTabId: 'projection-1',
  }), {
    shouldCreateDeleteUndoBatch: true,
    shouldPruneDeletedProjectionTabs: true,
    pruneDeletedProjectionTabsParams: {
      deletedAbsolutePaths: ['/root/a.jpg'],
      deletedProjectionPaths: ['a.jpg'],
      projectionTabId: 'projection-1',
    },
  })
})
