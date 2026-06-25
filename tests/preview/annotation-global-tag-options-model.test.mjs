import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cloneGlobalAnnotationTagOptions,
  createGlobalAnnotationTagOptionsState,
  reduceGlobalAnnotationTagOptions,
} from '../../src/features/preview/lib/annotationGlobalTagOptionsModel.ts'

test('Annotation Global Tag Options Model loads normalized Annotation Tag option records', () => {
  const loading = reduceGlobalAnnotationTagOptions(
    createGlobalAnnotationTagOptionsState({
      options: [
        {
          tagKey: 'old=value',
          key: 'old',
          value: 'value',
          sources: ['plugin.review'],
          hasMetaAnnotation: false,
          representativeSource: 'plugin.review',
        },
      ],
      error: 'previous failure',
    }),
    { type: 'mark-loading' },
  )

  assert.equal(loading.status, 'loading')
  assert.equal(loading.error, null)
  assert.deepEqual(loading.options.map((option) => option.tagKey), ['old=value'])

  const loaded = reduceGlobalAnnotationTagOptions(loading, {
    type: 'apply-option-records',
    optionRecords: [
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
        source: 'meta.annotation',
        appliedAt: 12,
        fileCount: 2,
      },
    ],
    nowMs: 100,
  })

  assert.equal(loaded.status, 'ready')
  assert.equal(loaded.error, null)
  assert.equal(loaded.loadedAtMs, 100)
  assert.deepEqual(loaded.options, [
    {
      tagKey: 'rating=5',
      key: 'rating',
      value: '5',
      sources: ['meta.annotation', 'plugin.review'],
      hasMetaAnnotation: true,
      representativeSource: 'meta.annotation',
      fileCount: 3,
    },
  ])
})

test('Annotation Global Tag Options Model records failed loads as ready error states', () => {
  const failed = reduceGlobalAnnotationTagOptions(
    createGlobalAnnotationTagOptionsState({
      status: 'loading',
      options: [
        {
          tagKey: 'rating=5',
          key: 'rating',
          value: '5',
          sources: ['plugin.review'],
          hasMetaAnnotation: false,
          representativeSource: 'plugin.review',
        },
      ],
    }),
    {
      type: 'apply-error',
      error: new Error('Runtime unavailable'),
      nowMs: 200,
    },
  )

  assert.equal(failed.status, 'ready')
  assert.equal(failed.error, 'Runtime unavailable')
  assert.equal(failed.loadedAtMs, 200)
  assert.deepEqual(failed.options, [])

  const fallback = reduceGlobalAnnotationTagOptions(failed, {
    type: 'apply-error',
    error: 'not an Error',
    nowMs: 300,
  })

  assert.equal(fallback.error, '读取标签候选失败')
  assert.equal(fallback.loadedAtMs, 300)
})

test('Annotation Global Tag Options Model clones tag options for readers', () => {
  const state = createGlobalAnnotationTagOptionsState({
    options: [
      {
        tagKey: 'rating=5',
        key: 'rating',
        value: '5',
        sources: ['meta.annotation', 'plugin.review'],
        hasMetaAnnotation: true,
        representativeSource: 'meta.annotation',
      },
    ],
  })

  const cloned = cloneGlobalAnnotationTagOptions(state.options)
  cloned[0].sources.push('mutated')

  assert.deepEqual(state.options[0].sources, ['meta.annotation', 'plugin.review'])
})
