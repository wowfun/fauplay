import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolvePreviewPluginDuplicateProjectionDismissIntent,
  resolvePreviewPluginProjectionActivationIntent,
} from '../../src/features/preview/lib/previewPluginProjectionModel.ts'

function projection(id, overrides = {}) {
  return {
    id,
    title: id,
    entry: 'auto',
    files: [],
    ...overrides,
  }
}

function queueItem(id, overrides = {}) {
  return {
    id,
    contextKey: 'albums/photo.jpg',
    toolName: 'vision.face',
    title: id,
    trigger: 'manual',
    status: 'success',
    startedAt: 1,
    collapsed: false,
    ...overrides,
  }
}

test('Preview Plugin Projection Model activates the first unhandled auto projection', () => {
  const firstProjection = projection('faces')
  const secondProjection = projection('duplicates')

  assert.deepEqual(resolvePreviewPluginProjectionActivationIntent({
    queueItems: [
      queueItem('result-1', {
        toolName: 'vision.face',
        projection: firstProjection,
      }),
      queueItem('result-2', {
        toolName: 'data.findDuplicateFiles',
        projection: secondProjection,
      }),
    ],
    handledResultId: null,
  }), {
    kind: 'activate',
    resultId: 'result-1',
    toolName: 'vision.face',
    projection: firstProjection,
  })

  assert.deepEqual(resolvePreviewPluginProjectionActivationIntent({
    queueItems: [
      queueItem('result-1', {
        toolName: 'vision.face',
        projection: firstProjection,
      }),
    ],
    handledResultId: 'result-1',
  }), {
    kind: 'none',
  })
})

test('Preview Plugin Projection Model ignores stale Duplicate Set projections after a newer empty result', () => {
  assert.deepEqual(resolvePreviewPluginProjectionActivationIntent({
    queueItems: [
      queueItem('result-2', {
        toolName: 'data.findDuplicateFiles',
        projection: undefined,
      }),
      queueItem('result-1', {
        toolName: 'data.findDuplicateFiles',
        projection: projection('old-duplicates'),
      }),
    ],
    handledResultId: null,
  }), {
    kind: 'none',
  })
})

test('Preview Plugin Projection Model dismisses Duplicate Set projections when latest result has none', () => {
  assert.deepEqual(resolvePreviewPluginDuplicateProjectionDismissIntent({
    queueItems: [
      queueItem('result-2', {
        toolName: 'data.findDuplicateFiles',
        projection: undefined,
      }),
      queueItem('result-1', {
        toolName: 'data.findDuplicateFiles',
        projection: projection('old-duplicates'),
      }),
    ],
    handledResultId: null,
  }), {
    kind: 'dismiss',
    resultId: 'result-2',
    toolName: 'data.findDuplicateFiles',
  })

  assert.deepEqual(resolvePreviewPluginDuplicateProjectionDismissIntent({
    queueItems: [
      queueItem('result-2', {
        toolName: 'data.findDuplicateFiles',
        projection: projection('new-duplicates'),
      }),
    ],
    handledResultId: null,
  }), {
    kind: 'none',
  })
})
