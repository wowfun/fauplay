import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveWorkspaceProjectionSurfaceRecoveryPlan,
  resolveWorkspaceProjectionTabConsistencyPlan,
} from '../../src/features/workspace/lib/workspaceProjectionConsistency.ts'

function file(path) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
  }
}

function projection(id) {
  return {
    id,
    title: id,
    entry: 'manual',
    files: [file(`${id}/one.jpg`)],
  }
}

test('Workspace Projection Consistency Model repairs missing active Result Projection tabs', () => {
  assert.deepEqual(resolveWorkspaceProjectionTabConsistencyPlan({
    projectionTabs: [],
    activeProjectionTabId: 'stale-tab',
  }), {
    kind: 'set-active-tab',
    activeProjectionTabId: null,
    lastProjectionTabId: undefined,
  })

  assert.deepEqual(resolveWorkspaceProjectionTabConsistencyPlan({
    projectionTabs: [projection('first'), projection('second')],
    activeProjectionTabId: 'missing-tab',
  }), {
    kind: 'set-active-tab',
    activeProjectionTabId: 'first',
    lastProjectionTabId: 'first',
  })

  assert.deepEqual(resolveWorkspaceProjectionTabConsistencyPlan({
    projectionTabs: [projection('first')],
    activeProjectionTabId: 'first',
  }), {
    kind: 'none',
  })
})

test('Workspace Projection Consistency Model returns stale Result Projection surfaces to the Listing', () => {
  assert.deepEqual(resolveWorkspaceProjectionSurfaceRecoveryPlan({
    projectionTabs: [projection('visible')],
    activeSurface: { kind: 'projection', tabId: 'missing' },
    directoryFocusedPath: 'albums/focused.jpg',
  }), {
    kind: 'return-to-directory',
    previewAlignmentPath: 'albums/focused.jpg',
  })

  assert.deepEqual(resolveWorkspaceProjectionSurfaceRecoveryPlan({
    projectionTabs: [projection('visible')],
    activeSurface: { kind: 'projection', tabId: 'visible' },
    directoryFocusedPath: 'albums/focused.jpg',
  }), {
    kind: 'none',
  })

  assert.deepEqual(resolveWorkspaceProjectionSurfaceRecoveryPlan({
    projectionTabs: [],
    activeSurface: { kind: 'directory' },
    directoryFocusedPath: null,
  }), {
    kind: 'none',
  })
})
