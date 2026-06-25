import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreviewFileLoadPlan } from '../../src/features/preview/lib/previewFileLoadPlan.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function accessPlan(overrides = {}) {
  return {
    accessKind: 'file-access',
    currentRootRelativePath: 'albums/photo.jpg',
    hasRemoteFileLocator: false,
    hasRuntimeFileLocator: false,
    canAccessThroughCurrentRoot: false,
    shouldUseFileAccess: true,
    shouldUseRuntimeGlobalTrashTextPreview: false,
    shouldUseRuntimeGlobalTrashFileContent: false,
    shouldUseRuntimeTextPreview: false,
    shouldUseRuntimeFileContent: false,
    shouldUseFileSystemAccess: false,
    ...overrides,
  }
}

test('Preview File Load Plan routes File Access media and text through item loaders', () => {
  assert.deepEqual(resolvePreviewFileLoadPlan({
    file: file('albums/photo.jpg', { absolutePath: '/media/root/albums/photo.jpg' }),
    previewKind: 'image',
    accessPlan: accessPlan(),
    runtimeFileLocator: null,
    runtimeGlobalTrashRecycleId: null,
    runtimeGlobalTrashFileContentUrl: null,
  }), {
    kind: 'file-access-content',
  })

  assert.deepEqual(resolvePreviewFileLoadPlan({
    file: file('albums/notes.md', { absolutePath: '/media/root/albums/notes.md' }),
    previewKind: 'text',
    accessPlan: accessPlan(),
    runtimeFileLocator: null,
    runtimeGlobalTrashRecycleId: null,
    runtimeGlobalTrashFileContentUrl: null,
  }), {
    kind: 'file-access-text',
  })
})

test('Preview File Load Plan resolves Runtime and File System loading paths', () => {
  assert.deepEqual(resolvePreviewFileLoadPlan({
    file: file('albums/notes.md'),
    previewKind: 'text',
    accessPlan: accessPlan({
      accessKind: 'runtime-text-preview',
      shouldUseFileAccess: false,
      shouldUseRuntimeTextPreview: true,
    }),
    runtimeFileLocator: {
      rootPath: '/media/root',
      rootRelativePath: 'albums/notes.md',
    },
    runtimeGlobalTrashRecycleId: null,
    runtimeGlobalTrashFileContentUrl: null,
  }), {
    kind: 'runtime-text-preview',
    rootPath: '/media/root',
    rootRelativePath: 'albums/notes.md',
    canFallbackToFileSystem: true,
  })

  assert.deepEqual(resolvePreviewFileLoadPlan({
    file: file('trash/deleted.txt', { recycleId: 'recycle-1' }),
    previewKind: 'text',
    accessPlan: accessPlan({
      accessKind: 'runtime-global-trash-text',
      shouldUseFileAccess: false,
      shouldUseRuntimeGlobalTrashTextPreview: true,
    }),
    runtimeFileLocator: null,
    runtimeGlobalTrashRecycleId: 'recycle-1',
    runtimeGlobalTrashFileContentUrl: null,
  }), {
    kind: 'runtime-global-trash-text',
    recycleId: 'recycle-1',
  })

  assert.deepEqual(resolvePreviewFileLoadPlan({
    file: file('albums/photo.jpg'),
    previewKind: 'image',
    accessPlan: accessPlan({
      accessKind: 'file-system',
      currentRootRelativePath: 'albums/photo.jpg',
      shouldUseFileAccess: false,
      shouldUseFileSystemAccess: true,
    }),
    runtimeFileLocator: null,
    runtimeGlobalTrashRecycleId: null,
    runtimeGlobalTrashFileContentUrl: null,
  }), {
    kind: 'file-system',
    rootRelativePath: 'albums/photo.jpg',
  })

  assert.deepEqual(resolvePreviewFileLoadPlan({
    file: file('albums/missing.jpg'),
    previewKind: 'image',
    accessPlan: accessPlan({
      accessKind: 'unavailable',
      shouldUseFileAccess: false,
    }),
    runtimeFileLocator: null,
    runtimeGlobalTrashRecycleId: null,
    runtimeGlobalTrashFileContentUrl: null,
  }), {
    kind: 'unavailable',
    error: '当前文件无法通过工作区目录句柄读取',
  })
})
