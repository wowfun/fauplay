import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyAnnotationPathState,
  buildOptimisticAnnotationTagBinding,
  buildOptimisticAnnotationTagUnbinding,
  createAnnotationDisplaySnapshotState,
  deriveAnnotationDisplaySnapshotFields,
  reduceAnnotationDisplaySnapshot,
  resolveAnnotationFilterUiGate,
} from '../../src/features/preview/lib/annotationDisplaySnapshotModel.ts'

const metaSource = 'meta.annotation'

function tag(key, value, source = 'plugin.review', updatedAt = 1) {
  return {
    key,
    value,
    source,
    appliedAt: updatedAt,
    updatedAt,
  }
}

test('Annotation Display Snapshot Model derives file tag keys and filter options from raw tags', () => {
  const derived = deriveAnnotationDisplaySnapshotFields({
    'albums/a.jpg': [
      tag('rating', '5', 'plugin.review', 10),
      tag('rating', '5', metaSource, 12),
    ],
    'albums/b.jpg': [
      tag('subject', 'portrait', 'vision.face', 8),
    ],
    'albums/empty.jpg': [],
  })

  assert.deepEqual(derived.tagKeysByPath, {
    'albums/a.jpg': ['rating=5'],
    'albums/b.jpg': ['subject=portrait'],
  })
  assert.deepEqual(derived.tagOptions.map((option) => ({
    tagKey: option.tagKey,
    sources: option.sources,
    fileCount: option.fileCount,
    hasMetaAnnotation: option.hasMetaAnnotation,
  })), [
    {
      tagKey: 'rating=5',
      sources: [metaSource, 'plugin.review'],
      fileCount: 1,
      hasMetaAnnotation: true,
    },
    {
      tagKey: 'subject=portrait',
      sources: ['vision.face'],
      fileCount: 1,
      hasMetaAnnotation: false,
    },
  ])
  assert.equal(derived.hasAnyFilterableAnnotation, true)
})

test('Annotation Display Snapshot Model applies and removes per-file annotation state', () => {
  const current = {
    rawTagsByPath: {
      'albums/a.jpg': [tag('rating', '5', metaSource, 12)],
      'albums/b.jpg': [tag('subject', 'portrait', 'vision.face', 8)],
    },
    byPathUpdatedAt: {
      'albums/a.jpg': 12,
      'albums/b.jpg': 8,
    },
  }

  assert.deepEqual(applyAnnotationPathState({
    ...current,
    relativePath: 'albums/c.jpg',
    state: {
      rawTags: [tag('rating', '4', 'plugin.review', 9)],
      updatedAt: 9,
    },
  }), {
    rawTagsByPath: {
      ...current.rawTagsByPath,
      'albums/c.jpg': [tag('rating', '4', 'plugin.review', 9)],
    },
    byPathUpdatedAt: {
      ...current.byPathUpdatedAt,
      'albums/c.jpg': 9,
    },
  })

  assert.deepEqual(applyAnnotationPathState({
    ...current,
    relativePath: 'albums/a.jpg',
    state: {
      rawTags: null,
      updatedAt: null,
    },
  }), {
    rawTagsByPath: {
      'albums/b.jpg': [tag('subject', 'portrait', 'vision.face', 8)],
    },
    byPathUpdatedAt: {
      'albums/b.jpg': 8,
    },
  })
})

test('Annotation Display Snapshot Model resolves annotation filter UI gate state', () => {
  assert.deepEqual(resolveAnnotationFilterUiGate(null), {
    isVisible: false,
    reason: 'no_root',
  })
  assert.deepEqual(resolveAnnotationFilterUiGate({
    hasSidecarDir: false,
    hasSidecarFile: false,
    hasAnyFilterableAnnotation: false,
  }), {
    isVisible: false,
    reason: 'missing_sidecar_dir',
  })
  assert.deepEqual(resolveAnnotationFilterUiGate({
    hasSidecarDir: true,
    hasSidecarFile: true,
    hasAnyFilterableAnnotation: true,
  }), {
    isVisible: true,
    reason: null,
  })
})

test('Annotation Display Snapshot Model builds optimistic meta annotation binding patches', () => {
  const existingTags = [
    tag('rating', '5', 'plugin.review', 10),
  ]

  assert.deepEqual(buildOptimisticAnnotationTagBinding({
    existingRawTags: existingTags,
    key: 'rating',
    value: '5',
    updatedAt: 20,
  }), {
    changed: true,
    rawTags: [
      ...existingTags,
      tag('rating', '5', metaSource, 20),
    ],
    updatedAt: 20,
  })

  assert.deepEqual(buildOptimisticAnnotationTagBinding({
    existingRawTags: [
      ...existingTags,
      tag('rating', '5', metaSource, 20),
    ],
    key: 'rating',
    value: '5',
    updatedAt: 21,
  }), {
    changed: false,
    rawTags: [
      ...existingTags,
      tag('rating', '5', metaSource, 20),
    ],
    updatedAt: 20,
  })
})

test('Annotation Display Snapshot Model builds optimistic meta annotation unbinding patches', () => {
  const existingTags = [
    tag('rating', '5', 'plugin.review', 10),
    tag('rating', '5', metaSource, 20),
  ]

  assert.deepEqual(buildOptimisticAnnotationTagUnbinding({
    existingRawTags: existingTags,
    key: 'rating',
    value: '5',
  }), {
    changed: true,
    rawTags: [tag('rating', '5', 'plugin.review', 10)],
    updatedAt: 10,
  })

  assert.deepEqual(buildOptimisticAnnotationTagUnbinding({
    existingRawTags: [tag('rating', '5', metaSource, 20)],
    key: 'rating',
    value: '5',
  }), {
    changed: true,
    rawTags: null,
    updatedAt: null,
  })

  assert.deepEqual(buildOptimisticAnnotationTagUnbinding({
    existingRawTags: [tag('rating', '4', metaSource, 20)],
    key: 'rating',
    value: '5',
  }), {
    changed: false,
    rawTags: [tag('rating', '4', metaSource, 20)],
    updatedAt: 20,
  })
})

test('Annotation Display Snapshot Model applies root File Annotation load outcomes', () => {
  const loading = reduceAnnotationDisplaySnapshot(
    createAnnotationDisplaySnapshotState(),
    { type: 'mark-loading' },
  ).snapshot

  assert.equal(loading.status, 'loading')

  const loaded = reduceAnnotationDisplaySnapshot(loading, {
    type: 'apply-root-tag-views',
    tagViews: [
      {
        relativePath: 'albums\\\\a.jpg',
        tags: [
          {
            key: 'rating',
            value: '5',
            source: 'plugin.review',
            appliedAt: 10,
          },
        ],
      },
      {
        relativePath: 'albums/b.jpg',
        tags: [
          {
            key: 'subject',
            value: 'portrait',
            source: metaSource,
            appliedAt: 12,
          },
        ],
      },
    ],
    nowMs: 100,
  }).snapshot

  assert.equal(loaded.status, 'ready')
  assert.equal(loaded.loadedAtMs, 100)
  assert.equal(loaded.hasSidecarDir, true)
  assert.equal(loaded.hasSidecarFile, true)
  assert.equal(loaded.hasAnyFilterableAnnotation, true)
  assert.deepEqual(loaded.tagKeysByPath, {
    'albums/a.jpg': ['rating=5'],
    'albums/b.jpg': ['subject=portrait'],
  })

  const failed = reduceAnnotationDisplaySnapshot(loaded, {
    type: 'apply-root-load-error',
    nowMs: 200,
  }).snapshot

  assert.equal(failed.status, 'ready')
  assert.equal(failed.loadedAtMs, 200)
  assert.equal(failed.hasSidecarDir, true)
  assert.equal(failed.hasSidecarFile, false)
  assert.deepEqual(failed.rawTagsByPath, {})
  assert.deepEqual(failed.tagOptions, [])

  const unavailable = reduceAnnotationDisplaySnapshot(loaded, {
    type: 'mark-root-unavailable',
    nowMs: 300,
  }).snapshot

  assert.equal(unavailable.status, 'ready')
  assert.equal(unavailable.loadedAtMs, 300)
  assert.equal(unavailable.hasSidecarDir, false)
  assert.equal(unavailable.hasSidecarFile, false)
  assert.deepEqual(unavailable.rawTagsByPath, {})
})

test('Annotation Display Snapshot Model applies per-file loads without overriding root loading state', () => {
  const loading = reduceAnnotationDisplaySnapshot(
    createAnnotationDisplaySnapshotState(),
    { type: 'mark-loading' },
  ).snapshot

  const withFile = reduceAnnotationDisplaySnapshot(loading, {
    type: 'apply-file-tags',
    relativePath: 'albums/a.jpg',
    tags: [
      {
        key: 'rating',
        value: '5',
        source: 'plugin.review',
        appliedAt: 10,
      },
    ],
    nowMs: 100,
  }).snapshot

  assert.equal(withFile.status, 'loading')
  assert.equal(withFile.loadedAtMs, null)
  assert.equal(withFile.hasSidecarDir, true)
  assert.equal(withFile.hasSidecarFile, true)
  assert.deepEqual(withFile.tagKeysByPath, {
    'albums/a.jpg': ['rating=5'],
  })

  const fromIdle = reduceAnnotationDisplaySnapshot(createAnnotationDisplaySnapshotState(), {
    type: 'apply-file-tags',
    relativePath: 'albums/a.jpg',
    tags: [
      {
        key: 'rating',
        value: '5',
        source: 'plugin.review',
        appliedAt: 10,
      },
    ],
    nowMs: 200,
  }).snapshot

  assert.equal(fromIdle.status, 'ready')
  assert.equal(fromIdle.loadedAtMs, 200)
})

test('Annotation Display Snapshot Model applies rollback-able optimistic File Annotation tag changes', () => {
  const loaded = reduceAnnotationDisplaySnapshot(createAnnotationDisplaySnapshotState(), {
    type: 'apply-root-tag-views',
    tagViews: [
      {
        relativePath: 'albums/a.jpg',
        tags: [
          {
            key: 'rating',
            value: '5',
            source: 'plugin.review',
            appliedAt: 10,
          },
        ],
      },
    ],
    nowMs: 100,
  }).snapshot

  const bound = reduceAnnotationDisplaySnapshot(loaded, {
    type: 'bind-meta-tag',
    relativePath: 'albums/a.jpg',
    key: 'rating',
    value: '5',
    nowMs: 200,
  })

  assert.equal(bound.changed, true)
  assert.deepEqual(bound.snapshot.tagKeysByPath, {
    'albums/a.jpg': ['rating=5'],
  })
  assert.deepEqual(bound.snapshot.rawTagsByPath['albums/a.jpg'], [
    tag('rating', '5', 'plugin.review', 10),
    tag('rating', '5', metaSource, 200),
  ])
  assert.equal(bound.snapshot.byPathUpdatedAt['albums/a.jpg'], 200)
  assert.equal(bound.rollback?.relativePath, 'albums/a.jpg')

  assert.equal(
    reduceAnnotationDisplaySnapshot(bound.snapshot, {
      type: 'bind-meta-tag',
      relativePath: 'albums/a.jpg',
      key: 'rating',
      value: '5',
      nowMs: 300,
    }).changed,
    false,
  )

  const restored = reduceAnnotationDisplaySnapshot(bound.snapshot, {
    type: 'restore-path',
    rollback: bound.rollback,
    nowMs: 400,
  }).snapshot

  assert.deepEqual(restored.rawTagsByPath['albums/a.jpg'], [
    tag('rating', '5', 'plugin.review', 10),
  ])
  assert.equal(restored.byPathUpdatedAt['albums/a.jpg'], 10)

  const setValue = reduceAnnotationDisplaySnapshot(restored, {
    type: 'set-meta-value',
    relativePath: 'albums/a.jpg',
    key: 'rating',
    value: '4',
    nowMs: 500,
  }).snapshot

  assert.deepEqual(setValue.rawTagsByPath['albums/a.jpg'], [
    tag('rating', '5', 'plugin.review', 10),
    tag('rating', '4', metaSource, 500),
  ])
  assert.equal(setValue.byPathUpdatedAt['albums/a.jpg'], 500)
})

test('Annotation Display Snapshot Model restores an absent path after an optimistic File Annotation rollback', () => {
  const bound = reduceAnnotationDisplaySnapshot(createAnnotationDisplaySnapshotState(), {
    type: 'bind-meta-tag',
    relativePath: 'albums/new.jpg',
    key: 'rating',
    value: '5',
    nowMs: 100,
  })

  assert.equal(bound.changed, true)
  assert.deepEqual(bound.snapshot.rawTagsByPath['albums/new.jpg'], [
    tag('rating', '5', metaSource, 100),
  ])
  assert.equal(bound.rollback?.relativePath, 'albums/new.jpg')
  assert.equal(bound.rollback?.rawTags, null)

  const restored = reduceAnnotationDisplaySnapshot(bound.snapshot, {
    type: 'restore-path',
    rollback: bound.rollback,
    nowMs: 200,
  }).snapshot

  assert.deepEqual(restored.rawTagsByPath, {})
  assert.deepEqual(restored.byPathUpdatedAt, {})
  assert.deepEqual(restored.tagKeysByPath, {})
  assert.deepEqual(restored.tagOptions, [])
  assert.equal(restored.hasAnyFilterableAnnotation, false)
})
