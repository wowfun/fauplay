import assert from 'node:assert/strict'
import test from 'node:test'

import {
  META_ANNOTATION_SOURCE,
  buildAnnotationFilterTagOptions,
  buildAnnotationPathSnapshotFromTagViews,
  buildGlobalAnnotationTagOptions,
  buildLogicalAnnotationTags,
  getAnnotationFilterTagIdentity,
  toAnnotationFilterTagKey,
} from '../../src/features/preview/lib/annotationTagModel.ts'

test('Annotation Tag Model encodes and decodes filter tag identity', () => {
  const tagKey = toAnnotationFilterTagKey('camera/lens', '50mm f/1.8')

  assert.equal(tagKey, 'camera%2Flens=50mm%20f%2F1.8')
  assert.deepEqual(getAnnotationFilterTagIdentity(tagKey), {
    key: 'camera/lens',
    value: '50mm f/1.8',
  })
  assert.equal(getAnnotationFilterTagIdentity('not-a-tag-key'), null)
})

test('Annotation Tag Model merges logical tags by key and value', () => {
  assert.deepEqual(
    buildLogicalAnnotationTags([
      {
        key: 'rating',
        value: '5',
        source: 'plugin.review',
        appliedAt: 10,
        updatedAt: 10,
      },
      {
        key: 'rating',
        value: '5',
        source: META_ANNOTATION_SOURCE,
        appliedAt: 12,
        updatedAt: 12,
      },
      {
        key: 'genre',
        value: 'portrait',
        source: 'plugin.faces',
        appliedAt: 8,
        updatedAt: 8,
      },
    ]),
    [
      {
        tagKey: 'genre=portrait',
        key: 'genre',
        value: 'portrait',
        sources: ['plugin.faces'],
        hasMetaAnnotation: false,
        representativeSource: 'plugin.faces',
        updatedAt: 8,
      },
      {
        tagKey: 'rating=5',
        key: 'rating',
        value: '5',
        sources: [META_ANNOTATION_SOURCE, 'plugin.review'],
        hasMetaAnnotation: true,
        representativeSource: META_ANNOTATION_SOURCE,
        updatedAt: 12,
      },
    ],
  )
})

test('Annotation Tag Model builds filter options from per-file logical tags', () => {
  assert.deepEqual(
    buildAnnotationFilterTagOptions({
      'albums/a.jpg': [
        {
          key: 'rating',
          value: '5',
          source: 'plugin.review',
          appliedAt: 10,
          updatedAt: 10,
        },
        {
          key: 'rating',
          value: '5',
          source: META_ANNOTATION_SOURCE,
          appliedAt: 12,
          updatedAt: 12,
        },
      ],
      'albums/b.jpg': [
        {
          key: 'rating',
          value: '5',
          source: 'plugin.review',
          appliedAt: 14,
          updatedAt: 14,
        },
      ],
    }),
    [
      {
        tagKey: 'rating=5',
        key: 'rating',
        value: '5',
        sources: [META_ANNOTATION_SOURCE, 'plugin.review'],
        hasMetaAnnotation: true,
        representativeSource: META_ANNOTATION_SOURCE,
        fileCount: 2,
      },
    ],
  )
})

test('Annotation Tag Model normalizes Runtime tag views into a path snapshot', () => {
  assert.deepEqual(
    buildAnnotationPathSnapshotFromTagViews([
      {
        relativePath: 'albums\\\\a.jpg',
        tags: [
          {
            key: ' rating ',
            value: ' 5 ',
            source: ' plugin.review ',
            appliedAt: '11.8',
          },
          {
            key: 'ignored',
            value: '',
            source: 'plugin.review',
            appliedAt: 12,
          },
        ],
      },
      {
        relativePath: '',
        tags: [
          {
            key: 'rating',
            value: '4',
            source: 'plugin.review',
            appliedAt: 3,
          },
        ],
      },
    ]),
    {
      rawTagsByPath: {
        'albums/a.jpg': [
          {
            key: 'rating',
            value: '5',
            source: 'plugin.review',
            appliedAt: 11,
            updatedAt: 11,
          },
        ],
      },
      byPathUpdatedAt: {
        'albums/a.jpg': 11,
      },
    },
  )
})

test('Annotation Tag Model builds global tag options with source and count merging', () => {
  assert.deepEqual(
    buildGlobalAnnotationTagOptions([
      {
        key: 'rating',
        value: '5',
        source: 'plugin.review',
        appliedAt: 10,
        fileCount: 3,
      },
      {
        key: 'rating',
        value: '5',
        source: META_ANNOTATION_SOURCE,
        appliedAt: 12,
        fileCount: 2,
      },
      {
        key: 'rating',
        value: '5',
        source: 'plugin.review',
        appliedAt: 14,
        fileCount: 5,
      },
    ]),
    [
      {
        tagKey: 'rating=5',
        key: 'rating',
        value: '5',
        sources: [META_ANNOTATION_SOURCE, 'plugin.review'],
        hasMetaAnnotation: true,
        representativeSource: META_ANNOTATION_SOURCE,
        fileCount: 5,
      },
    ],
  )
})
