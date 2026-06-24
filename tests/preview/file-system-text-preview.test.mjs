import assert from 'node:assert/strict'
import test from 'node:test'
import { TextEncoder } from 'node:util'

import { readFileSystemTextPreview } from '../../src/features/preview/lib/fileSystemTextPreview.ts'

function fileWithBytes(bytes) {
  return {
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

test('File System Text Preview returns decoded content for small text files', async () => {
  const bytes = new TextEncoder().encode('hello\nFauplay')

  assert.deepEqual(
    await readFileSystemTextPreview(fileWithBytes(bytes), 1024),
    {
      status: 'ready',
      content: 'hello\nFauplay',
      fileSizeBytes: bytes.byteLength,
      sizeLimitBytes: 1024,
      error: null,
    },
  )
})

test('File System Text Preview reports files that are too large without reading content', async () => {
  let didRead = false
  const file = {
    size: 2048,
    async arrayBuffer() {
      didRead = true
      return new ArrayBuffer(0)
    },
  }

  assert.deepEqual(
    await readFileSystemTextPreview(file, 1024),
    {
      status: 'too_large',
      content: null,
      fileSizeBytes: 2048,
      sizeLimitBytes: 1024,
      error: null,
    },
  )
  assert.equal(didRead, false)
})

test('File System Text Preview reports binary content when null bytes are present', async () => {
  assert.deepEqual(
    await readFileSystemTextPreview(fileWithBytes(new Uint8Array([65, 0, 66])), 1024),
    {
      status: 'binary',
      content: null,
      fileSizeBytes: 3,
      sizeLimitBytes: 1024,
      error: null,
    },
  )
})

test('File System Text Preview reports read errors as preview errors', async () => {
  const file = {
    size: 12,
    async arrayBuffer() {
      throw new Error('read failed')
    },
  }

  assert.deepEqual(
    await readFileSystemTextPreview(file, 1024),
    {
      status: 'error',
      content: null,
      fileSizeBytes: 12,
      sizeLimitBytes: 1024,
      error: 'read failed',
    },
  )
})
