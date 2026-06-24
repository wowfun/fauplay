import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreviewFileAccessPlan } from '../../src/features/preview/lib/previewFileAccess.ts'

function planFor(overrides = {}) {
  return resolvePreviewFileAccessPlan({
    file: {
      kind: 'file',
      name: 'photo.jpg',
      path: 'albums/photo.jpg',
      ...overrides.file,
    },
    previewKind: overrides.previewKind ?? 'image',
    rootHandleAvailable: overrides.rootHandleAvailable ?? true,
    boundRootPath: overrides.boundRootPath ?? '/Users/example/root',
    runtimeFileLocator: overrides.runtimeFileLocator ?? {
      rootPath: '/Users/example/root',
      rootRelativePath: 'albums/photo.jpg',
    },
    runtimeGlobalTrashRecycleId: overrides.runtimeGlobalTrashRecycleId ?? null,
    runtimeGlobalTrashFileContentUrl: overrides.runtimeGlobalTrashFileContentUrl ?? null,
  })
}

test('Preview File Access plan prefers Runtime File Content for Local Root media', () => {
  const plan = planFor()

  assert.equal(plan.accessKind, 'runtime-file-content')
  assert.equal(plan.currentRootRelativePath, 'albums/photo.jpg')
  assert.equal(plan.canAccessThroughCurrentRoot, true)
  assert.equal(plan.shouldUseRuntimeFileContent, true)
  assert.equal(plan.shouldUseFileAccess, false)
})

test('Preview File Access plan routes Remote Access items through File Access', () => {
  const plan = planFor({
    file: {
      name: 'remote.jpg',
      path: 'albums/remote.jpg',
      remoteRootId: 'remote-root',
    },
    runtimeFileLocator: null,
    rootHandleAvailable: false,
  })

  assert.equal(plan.accessKind, 'file-access')
  assert.equal(plan.hasRemoteFileLocator, true)
  assert.equal(plan.canAccessThroughCurrentRoot, true)
  assert.equal(plan.shouldUseFileAccess, true)
})

test('Preview File Access plan keeps Global Trash Runtime paths ahead of absolute fallback', () => {
  const textPlan = planFor({
    previewKind: 'text',
    file: {
      name: 'deleted.txt',
      path: 'deleted.txt',
      absolutePath: '/Users/example/.fauplay/global-trash/deleted.txt',
      sourceType: 'global_recycle',
      recycleId: 'recycle-1',
    },
    runtimeFileLocator: null,
    runtimeGlobalTrashRecycleId: 'recycle-1',
  })
  assert.equal(textPlan.accessKind, 'runtime-global-trash-text')
  assert.equal(textPlan.shouldUseFileAccess, false)

  const mediaPlan = planFor({
    file: {
      absolutePath: '/Users/example/.fauplay/global-trash/photo.jpg',
      sourceType: 'global_recycle',
      recycleId: 'recycle-2',
    },
    runtimeFileLocator: null,
    runtimeGlobalTrashFileContentUrl: 'http://127.0.0.1:3211/v1/global-trash/file-content?recycleId=recycle-2',
  })
  assert.equal(mediaPlan.accessKind, 'runtime-global-trash-content')
  assert.equal(mediaPlan.shouldUseFileAccess, false)
})

test('Preview File Access plan does not read a cross-root item through the current root handle', () => {
  const plan = planFor({
    file: {
      name: 'cross-root.jpg',
      path: 'albums/cross-root.jpg',
      sourceRootPath: '/Users/example/other-root',
    },
    runtimeFileLocator: {
      rootPath: '/Users/example/other-root',
      rootRelativePath: 'albums/cross-root.jpg',
    },
    rootHandleAvailable: true,
  })

  assert.equal(plan.accessKind, 'unavailable')
  assert.equal(plan.canAccessThroughCurrentRoot, false)
  assert.equal(plan.shouldUseFileSystemAccess, false)
})
