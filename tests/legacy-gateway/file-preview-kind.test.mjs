import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMimeType,
  getPreviewKind,
} from '../../tools/legacy-gateway/data/file-preview-kind.mjs'

describe('file preview classification', () => {
  test('classifies image, video, text, and unsupported files from extensions', () => {
    assert.equal(getPreviewKind('photo.JPG'), 'image')
    assert.equal(getPreviewKind('clip.webm'), 'video')
    assert.equal(getPreviewKind('README.md'), 'text')
    assert.equal(getPreviewKind('archive.zip'), 'unsupported')
  })

  test('returns browser-facing MIME types for known extensions', () => {
    assert.equal(getMimeType('photo.jpeg'), 'image/jpeg')
    assert.equal(getMimeType('clip.mov'), 'video/quicktime')
    assert.equal(getMimeType('data.json'), 'application/json')
    assert.equal(getMimeType('main.tsx'), 'text/typescript')
  })

  test('falls back to octet-stream for unknown or extensionless names', () => {
    assert.equal(getMimeType('archive.zip'), 'application/octet-stream')
    assert.equal(getMimeType('LICENSE'), 'application/octet-stream')
  })
})
