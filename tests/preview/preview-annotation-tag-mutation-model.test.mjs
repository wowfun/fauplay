import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreviewAnnotationTagMutationPlan } from '../../src/features/preview/lib/previewAnnotationTagMutationModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function resolve(overrides = {}) {
  return resolvePreviewAnnotationTagMutationPlan({
    file: file('albums/a.jpg'),
    rootId: 'root-1',
    rootHandleAvailable: true,
    canManageAnnotationTags: true,
    unavailableReason: null,
    operation: 'bind',
    tag: {
      key: 'rating',
      value: '5',
    },
    ...overrides,
  })
}

test('Preview Annotation Tag Mutation Model rejects unavailable File Annotation mutations', () => {
  assert.deepEqual(resolve({
    file: null,
  }), {
    ok: false,
    error: '当前项不可管理标签',
  })

  assert.deepEqual(resolve({
    canManageAnnotationTags: false,
    unavailableReason: '标签管理能力不可用（Runtime 未连接或未注册 local.data）',
  }), {
    ok: false,
    error: '标签管理能力不可用（Runtime 未连接或未注册 local.data）',
  })
})

test('Preview Annotation Tag Mutation Model plans local.data bind and unbind commands', () => {
  assert.deepEqual(resolve(), {
    ok: true,
    operation: 'bind',
    rootId: 'root-1',
    relativePath: 'albums/a.jpg',
    tag: {
      key: 'rating',
      value: '5',
    },
    toolArgs: {
      operation: 'bindAnnotationTag',
      relativePath: 'albums/a.jpg',
      key: 'rating',
      value: '5',
    },
  })

  assert.deepEqual(resolve({
    operation: 'unbind',
    tag: {
      key: 'rating',
      value: '5',
    },
  }), {
    ok: true,
    operation: 'unbind',
    rootId: 'root-1',
    relativePath: 'albums/a.jpg',
    tag: {
      key: 'rating',
      value: '5',
    },
    toolArgs: {
      operation: 'unbindAnnotationTag',
      relativePath: 'albums/a.jpg',
      key: 'rating',
      value: '5',
    },
  })
})
