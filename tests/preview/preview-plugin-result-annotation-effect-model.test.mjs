import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveLocalDataAnnotationEffect,
  resolveVisionFaceAnnotationEffect,
} from '../../src/features/preview/lib/previewPluginResultAnnotationEffectModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function queueItem(overrides = {}) {
  return {
    id: 'queue-1',
    contextKey: 'albums/photo.jpg',
    toolName: 'local.data',
    title: 'Local Data',
    trigger: 'manual',
    status: 'success',
    result: {
      relativePath: 'albums/photo.jpg',
      fieldKey: 'rating',
      value: '5',
    },
    startedAt: 100,
    finishedAt: 200,
    collapsed: false,
    ...overrides,
  }
}

test('Preview Plugin Result Annotation Effect Model patches successful local.data annotation writes once', () => {
  assert.deepEqual(
    resolveLocalDataAnnotationEffect({
      file: file('albums/photo.jpg'),
      rootId: 'root-1',
      canUseAnnotationContext: true,
      queueItems: [queueItem()],
      handledQueueItemId: null,
    }),
    {
      kind: 'patch-annotation-set-value',
      handledQueueItemId: 'queue-1',
      rootId: 'root-1',
      relativePath: 'albums/photo.jpg',
      fieldKey: 'rating',
      value: '5',
    },
  )

  assert.deepEqual(
    resolveLocalDataAnnotationEffect({
      file: file('albums/photo.jpg'),
      rootId: 'root-1',
      canUseAnnotationContext: true,
      queueItems: [queueItem()],
      handledQueueItemId: 'queue-1',
    }),
    { kind: 'none' },
  )
})

test('Preview Plugin Result Annotation Effect Model refreshes File Annotation after new vision.face successes', () => {
  assert.deepEqual(
    resolveVisionFaceAnnotationEffect({
      file: file('albums/photo.jpg'),
      rootId: 'root-1',
      canUseAnnotationContext: true,
      queueItems: [
        queueItem({
          id: 'face-1',
          toolName: 'vision.face',
          title: 'Vision Face',
          result: { detectedFaces: 3 },
        }),
      ],
      handledQueueItemId: null,
    }),
    {
      kind: 'refresh-file-annotation',
      handledQueueItemId: 'face-1',
      rootId: 'root-1',
      relativePath: 'albums/photo.jpg',
    },
  )

  assert.deepEqual(
    resolveVisionFaceAnnotationEffect({
      file: file('albums/photo.jpg'),
      rootId: 'root-1',
      canUseAnnotationContext: true,
      queueItems: [
        queueItem({
          id: 'face-1',
          toolName: 'vision.face',
          title: 'Vision Face',
        }),
      ],
      handledQueueItemId: 'face-1',
    }),
    { kind: 'none' },
  )
})

test('Preview Plugin Result Annotation Effect Model refreshes File Annotation after non-setValue local.data successes', () => {
  assert.deepEqual(
    resolveLocalDataAnnotationEffect({
      file: file('albums/photo.jpg'),
      rootId: 'root-1',
      canUseAnnotationContext: true,
      queueItems: [
        queueItem({
          id: 'queue-2',
          result: { ok: true, operation: 'bindAnnotationTag' },
        }),
      ],
      handledQueueItemId: null,
    }),
    {
      kind: 'refresh-file-annotation',
      handledQueueItemId: 'queue-2',
      rootId: 'root-1',
      relativePath: 'albums/photo.jpg',
    },
  )
})

test('Preview Plugin Result Annotation Effect Model resets handled ids outside File Annotation context', () => {
  assert.deepEqual(
    resolveLocalDataAnnotationEffect({
      file: file('albums/photo.jpg'),
      rootId: 'root-1',
      canUseAnnotationContext: false,
      queueItems: [queueItem()],
      handledQueueItemId: 'queue-1',
    }),
    { kind: 'reset-handled-queue-item' },
  )

  assert.deepEqual(
    resolveVisionFaceAnnotationEffect({
      file: { name: 'albums', path: 'albums', kind: 'directory' },
      rootId: 'root-1',
      canUseAnnotationContext: true,
      queueItems: [queueItem({ toolName: 'vision.face' })],
      handledQueueItemId: 'face-1',
    }),
    { kind: 'reset-handled-queue-item' },
  )
})
