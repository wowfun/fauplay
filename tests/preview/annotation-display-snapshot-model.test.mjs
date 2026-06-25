import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyAnnotationPathState,
  buildOptimisticAnnotationTagBinding,
  buildOptimisticAnnotationTagUnbinding,
  deriveAnnotationDisplaySnapshotFields,
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
