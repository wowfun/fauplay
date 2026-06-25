import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatFileGridCardFileSize,
  resolveFileGridCardDirectoryBadge,
  resolveFileGridCardThumbnailLoadPlan,
  resolveFileGridCardThumbnailPlan,
} from '../../src/features/explorer/lib/fileGridCardModel.ts'

function file(name, overrides = {}) {
  return {
    name,
    path: name,
    kind: 'file',
    ...overrides,
  }
}

function directory(name, overrides = {}) {
  return {
    name,
    path: name,
    kind: 'directory',
    ...overrides,
  }
}

test('File Grid Card Model formats file size labels', () => {
  assert.equal(formatFileGridCardFileSize(undefined), '')
  assert.equal(formatFileGridCardFileSize(0), '')
  assert.equal(formatFileGridCardFileSize(512), '512 B')
  assert.equal(formatFileGridCardFileSize(2048), '2.0 KB')
  assert.equal(formatFileGridCardFileSize(3 * 1024 * 1024), '3.0 MB')
})

test('File Grid Card Model resolves directory badge counts from Listing metadata first', () => {
  assert.deepEqual(resolveFileGridCardDirectoryBadge({
    file: directory('albums', { entryCount: 100.8 }),
    loadedDirectoryItemCount: 4,
  }), {
    displayCount: 100,
    label: '99+',
    shouldLoadDirectoryItemCount: false,
  })

  assert.deepEqual(resolveFileGridCardDirectoryBadge({
    file: directory('albums', { entryCount: -2 }),
    loadedDirectoryItemCount: 4,
  }), {
    displayCount: 0,
    label: '0',
    shouldLoadDirectoryItemCount: false,
  })

  assert.deepEqual(resolveFileGridCardDirectoryBadge({
    file: directory('albums'),
    loadedDirectoryItemCount: 4,
  }), {
    displayCount: 4,
    label: '4',
    shouldLoadDirectoryItemCount: true,
  })

  assert.deepEqual(resolveFileGridCardDirectoryBadge({
    file: file('photo.jpg'),
    loadedDirectoryItemCount: 4,
  }), {
    displayCount: null,
    label: null,
    shouldLoadDirectoryItemCount: false,
  })
})

test('File Grid Card Model plans runtime and file-access thumbnail sources', () => {
  assert.deepEqual(resolveFileGridCardThumbnailPlan({
    file: file('photo.jpg', {
      path: 'photos/photo.jpg',
      size: 10,
      lastModifiedMs: 20,
    }),
    rootHandleAvailable: true,
    thumbnailSizePreset: '256',
  }), {
    isDirectory: false,
    previewKind: 'image',
    mediaType: 'image',
    fileLastModifiedMs: 20,
    requestIdentity: 'photos/photo.jpg::10::20::image::256',
    runtimeContentSource: 'local-root',
    runtimeImageThumbnail: true,
    runtimeVideoThumbnail: false,
    fileAccessThumbnail: false,
    pipelineThumbnail: false,
  })

  assert.deepEqual(resolveFileGridCardThumbnailPlan({
    file: file('clip.mp4', {
      path: 'videos/clip.mp4',
      size: 10,
      lastModified: new Date('2026-01-01T00:00:00Z'),
    }),
    rootHandleAvailable: true,
    thumbnailSizePreset: 'auto',
  }), {
    isDirectory: false,
    previewKind: 'video',
    mediaType: 'video',
    fileLastModifiedMs: 1767225600000,
    requestIdentity: 'videos/clip.mp4::10::1767225600000::video::auto',
    runtimeContentSource: 'local-root',
    runtimeImageThumbnail: false,
    runtimeVideoThumbnail: true,
    fileAccessThumbnail: false,
    pipelineThumbnail: true,
  })

  assert.deepEqual(resolveFileGridCardThumbnailPlan({
    file: file('remote.jpg', {
      remoteRootId: 'remote-a',
      absolutePath: '/remote/remote.jpg',
    }),
    rootHandleAvailable: false,
    thumbnailSizePreset: '512',
  }), {
    isDirectory: false,
    previewKind: 'image',
    mediaType: 'image',
    fileLastModifiedMs: undefined,
    requestIdentity: 'remote.jpg::unknown-size::unknown-modified::image::512',
    runtimeContentSource: null,
    runtimeImageThumbnail: false,
    runtimeVideoThumbnail: false,
    fileAccessThumbnail: true,
    pipelineThumbnail: false,
  })
})

test('File Grid Card Model keeps non-media and directory items on placeholders', () => {
  assert.deepEqual(resolveFileGridCardThumbnailPlan({
    file: file('photo.jpg'),
    rootHandleAvailable: false,
    thumbnailSizePreset: 'auto',
  }), {
    isDirectory: false,
    previewKind: 'image',
    mediaType: 'image',
    fileLastModifiedMs: undefined,
    requestIdentity: 'photo.jpg::unknown-size::unknown-modified::image::auto',
    runtimeContentSource: null,
    runtimeImageThumbnail: false,
    runtimeVideoThumbnail: false,
    fileAccessThumbnail: false,
    pipelineThumbnail: false,
  })

  assert.deepEqual(resolveFileGridCardThumbnailPlan({
    file: file('notes.txt'),
    rootHandleAvailable: true,
    thumbnailSizePreset: 'auto',
  }), {
    isDirectory: false,
    previewKind: 'text',
    mediaType: null,
    fileLastModifiedMs: undefined,
    requestIdentity: null,
    runtimeContentSource: null,
    runtimeImageThumbnail: false,
    runtimeVideoThumbnail: false,
    fileAccessThumbnail: false,
    pipelineThumbnail: false,
  })

  assert.deepEqual(resolveFileGridCardThumbnailPlan({
    file: directory('albums'),
    rootHandleAvailable: true,
    thumbnailSizePreset: 'auto',
  }), {
    isDirectory: true,
    previewKind: 'unsupported',
    mediaType: null,
    fileLastModifiedMs: undefined,
    requestIdentity: null,
    runtimeContentSource: null,
    runtimeImageThumbnail: false,
    runtimeVideoThumbnail: false,
    fileAccessThumbnail: false,
    pipelineThumbnail: false,
  })
})

test('File Grid Card Model resolves thumbnail load state before side effects', () => {
  assert.deepEqual(resolveFileGridCardThumbnailLoadPlan({
    rootHandleAvailable: false,
    isDirectory: false,
    mediaType: null,
    hasDirectThumbnailSource: false,
    directThumbnailUrl: null,
    requestIdentity: null,
    previousRequestIdentity: null,
    exactCachedThumbnailUrl: null,
  }), {
    kind: 'reset',
    thumbnailState: 'placeholder',
    shouldClearGeneratedThumbnail: true,
  })

  assert.deepEqual(resolveFileGridCardThumbnailLoadPlan({
    rootHandleAvailable: false,
    isDirectory: false,
    mediaType: 'image',
    hasDirectThumbnailSource: true,
    directThumbnailUrl: '/v1/files/content?path=photo.jpg',
    requestIdentity: 'photo.jpg::unknown-size::unknown-modified::image::auto',
    previousRequestIdentity: 'old',
    exactCachedThumbnailUrl: null,
  }), {
    kind: 'direct-thumbnail',
    thumbnailState: 'loading',
    shouldClearGeneratedThumbnail: false,
  })

  assert.deepEqual(resolveFileGridCardThumbnailLoadPlan({
    rootHandleAvailable: true,
    isDirectory: false,
    mediaType: 'image',
    hasDirectThumbnailSource: true,
    directThumbnailUrl: null,
    requestIdentity: 'photo.jpg::unknown-size::unknown-modified::image::auto',
    previousRequestIdentity: 'old',
    exactCachedThumbnailUrl: null,
  }), {
    kind: 'direct-thumbnail',
    thumbnailState: 'failed',
    shouldClearGeneratedThumbnail: true,
  })

  assert.deepEqual(resolveFileGridCardThumbnailLoadPlan({
    rootHandleAvailable: true,
    isDirectory: false,
    mediaType: 'image',
    hasDirectThumbnailSource: false,
    directThumbnailUrl: null,
    requestIdentity: 'photo.jpg::unknown-size::unknown-modified::image::auto',
    previousRequestIdentity: 'old',
    exactCachedThumbnailUrl: 'blob:cached',
  }), {
    kind: 'cached-thumbnail',
    thumbnailUrl: 'blob:cached',
    thumbnailUrlIdentity: 'photo.jpg::unknown-size::unknown-modified::image::auto',
    thumbnailState: 'ready',
  })

  assert.deepEqual(resolveFileGridCardThumbnailLoadPlan({
    rootHandleAvailable: true,
    isDirectory: false,
    mediaType: 'video',
    hasDirectThumbnailSource: false,
    directThumbnailUrl: null,
    requestIdentity: 'clip.mp4::10::20::video::auto',
    previousRequestIdentity: 'old',
    exactCachedThumbnailUrl: null,
  }), {
    kind: 'pipeline-thumbnail',
    requestIdentity: 'clip.mp4::10::20::video::auto',
    shouldClearGeneratedThumbnail: true,
  })
})
