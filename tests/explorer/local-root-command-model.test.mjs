import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveCachedRootRebindTarget,
  resolveSelectedLocalRootId,
} from '../../src/features/explorer/lib/localRootCommandModel.ts'

test('Local Root Command Model resolves selected Local Root identity', () => {
  assert.equal(resolveSelectedLocalRootId({
    cachedRootId: 'cached-root',
    sessionRootId: 'session-root',
  }), 'cached-root')

  assert.equal(resolveSelectedLocalRootId({
    cachedRootId: null,
    sessionRootId: 'session-root',
  }), 'session-root')
})

test('Local Root Command Model resolves Cached Root rebind targets', () => {
  const cachedRoots = [
    {
      rootId: 'root-a',
      rootName: 'Photos',
      lastUsedAt: 10,
    },
    {
      rootId: 'root-b',
      rootName: '',
      lastUsedAt: 5,
    },
  ]

  assert.deepEqual(resolveCachedRootRebindTarget({
    targetRootId: '',
    cachedRoots,
    rootLabelFallback: '根目录',
  }), null)

  assert.deepEqual(resolveCachedRootRebindTarget({
    targetRootId: 'root-a',
    cachedRoots,
    rootLabelFallback: '根目录',
  }), {
    rootId: 'root-a',
    rootLabel: 'Photos',
  })

  assert.deepEqual(resolveCachedRootRebindTarget({
    targetRootId: 'root-b',
    cachedRoots,
    rootLabelFallback: '根目录',
  }), {
    rootId: 'root-b',
    rootLabel: '根目录',
  })
})
