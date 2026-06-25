import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolvePreviewFullscreenFromPaneIntent,
  resolvePreviewModalOpenIntent,
  resolvePreviewPaneOpenIntent,
  resolvePreviewPathAlignmentIntent,
} from '../../src/features/preview/lib/previewSurfaceActionModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function directory(path) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'directory',
  }
}

test('Preview Surface Action Model opens file selections in the pane without closing an existing lightbox', () => {
  const photo = file('albums/photo.jpg')
  const clip = file('albums/clip.mp4')

  assert.deepEqual(resolvePreviewPaneOpenIntent({
    file: photo,
    currentPreviewFile: clip,
  }), {
    kind: 'apply-surface-selection',
    preferredPreviewPath: null,
    selectedFile: photo,
    previewFile: photo,
    showPreviewPane: true,
  })

  assert.deepEqual(resolvePreviewPaneOpenIntent({
    file: directory('albums/raw'),
    currentPreviewFile: clip,
  }), { kind: 'none' })
})

test('Preview Surface Action Model records missing preferred paths and applies present preferred paths', () => {
  const photo = file('albums/photo.jpg')
  const clip = file('albums/clip.mp4')
  const files = [photo, clip]

  assert.deepEqual(resolvePreviewPathAlignmentIntent({
    path: '/albums//missing.jpg',
    files,
    currentPreviewFile: clip,
    showPreviewPane: false,
  }), {
    kind: 'store-preferred-path',
    preferredPreviewPath: 'albums/missing.jpg',
  })

  assert.deepEqual(resolvePreviewPathAlignmentIntent({
    path: '/albums//photo.jpg',
    files,
    currentPreviewFile: clip,
    showPreviewPane: false,
  }), {
    kind: 'apply-surface-selection',
    preferredPreviewPath: null,
    selectedFile: photo,
    previewFile: photo,
    showPreviewPane: true,
  })

  assert.deepEqual(resolvePreviewPathAlignmentIntent({
    path: null,
    files,
    currentPreviewFile: null,
    showPreviewPane: true,
  }), {
    kind: 'clear-preferred-path',
    preferredPreviewPath: null,
  })
})

test('Preview Surface Action Model opens lightbox previews with video autoplay hints', () => {
  const clip = file('albums/clip.mp4')

  assert.deepEqual(resolvePreviewModalOpenIntent({
    file: clip,
  }), {
    kind: 'open-modal',
    previewFile: clip,
    previewAutoPlayOnOpen: true,
  })

  assert.deepEqual(resolvePreviewModalOpenIntent({
    file: directory('albums/raw'),
  }), { kind: 'none' })
})

test('Preview Surface Action Model opens fullscreen from the current pane file', () => {
  const photo = file('albums/photo.jpg')

  assert.deepEqual(resolvePreviewFullscreenFromPaneIntent({
    selectedFile: photo,
  }), {
    kind: 'open-modal',
    previewFile: photo,
    previewAutoPlayOnOpen: false,
  })

  assert.deepEqual(resolvePreviewFullscreenFromPaneIntent({
    selectedFile: null,
  }), { kind: 'none' })
})
