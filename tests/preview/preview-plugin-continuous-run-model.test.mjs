import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolvePreviewContinuousQueueDrainPlan,
  resolvePreviewContinuousTaskEnqueuePlan,
  resolvePreviewContinuousToolRunPlan,
} from '../../src/features/preview/lib/previewPluginContinuousRunModel.ts'

function candidate(toolName, overrides = {}) {
  return {
    toolName,
    requestSignature: `${toolName}:albums/photo.jpg`,
    alreadyCompleted: false,
    ...overrides,
  }
}

function task(toolName, overrides = {}) {
  return {
    key: `${toolName}:albums/photo.jpg`,
    toolName,
    ...overrides,
  }
}

test('Preview Plugin Continuous Run Model gates continuous auto-run by Preview readiness', () => {
  assert.deepEqual(resolvePreviewContinuousToolRunPlan({
    enabled: true,
    fileKind: 'file',
    hasExecutionContext: true,
    previewViewState: 'ready',
    candidates: [
      candidate('vision.face'),
    ],
  }), {
    kind: 'enqueue',
    candidates: [
      candidate('vision.face'),
    ],
  })

  assert.deepEqual(resolvePreviewContinuousToolRunPlan({
    enabled: true,
    fileKind: 'file',
    hasExecutionContext: true,
    previewViewState: 'loading',
    candidates: [
      candidate('vision.face'),
    ],
  }), {
    kind: 'none',
  })

  assert.deepEqual(resolvePreviewContinuousToolRunPlan({
    enabled: true,
    fileKind: 'directory',
    hasExecutionContext: true,
    previewViewState: 'ready',
    candidates: [
      candidate('vision.face'),
    ],
  }), {
    kind: 'none',
  })
})

test('Preview Plugin Continuous Run Model enqueues only runnable unseen request signatures', () => {
  assert.deepEqual(resolvePreviewContinuousTaskEnqueuePlan({
    candidates: [
      candidate('vision.face'),
      candidate('local.data', {
        requestSignature: null,
      }),
      candidate('fs.softDelete', {
        alreadyCompleted: true,
      }),
      candidate('data.findDuplicateFiles', {
        requestSignature: 'duplicate:albums/photo.jpg',
      }),
    ],
    queuedTaskKeys: new Set([
      'duplicate:albums/photo.jpg',
    ]),
  }), {
    tasksToEnqueue: [
      {
        key: 'vision.face:albums/photo.jpg',
        toolName: 'vision.face',
      },
    ],
  })
})

test('Preview Plugin Continuous Run Model drains queue with concurrency and completion guards', () => {
  assert.deepEqual(resolvePreviewContinuousQueueDrainPlan({
    enabled: true,
    maxConcurrent: 2,
    inFlightCount: 1,
    tasks: [
      task('vision.face'),
      task('local.data'),
      task('data.findDuplicateFiles'),
    ],
    completedTaskKeys: new Set([
      'local.data:albums/photo.jpg',
    ]),
  }), {
    tasksToRun: [
      task('vision.face'),
    ],
    skippedTaskKeys: [
      'local.data:albums/photo.jpg',
    ],
    remainingTasks: [
      task('data.findDuplicateFiles'),
    ],
  })

  assert.deepEqual(resolvePreviewContinuousQueueDrainPlan({
    enabled: false,
    maxConcurrent: 2,
    inFlightCount: 0,
    tasks: [
      task('vision.face'),
    ],
    completedTaskKeys: new Set(),
  }), {
    tasksToRun: [],
    skippedTaskKeys: [],
    remainingTasks: [
      task('vision.face'),
    ],
  })
})
