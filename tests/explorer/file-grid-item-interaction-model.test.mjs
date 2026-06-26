import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveFileGridItemClickIntent,
  resolveFileGridItemDoubleClickIntent,
  resolveFileGridItemToggleIntent,
} from '../../src/features/explorer/lib/fileGridItemInteractionModel.ts'

const imageFile = {
  kind: 'file',
  path: 'albums/a.jpg',
  name: 'a.jpg',
}

const directoryFile = {
  kind: 'directory',
  path: 'albums',
  name: 'albums',
}

test('File Grid Item Interaction Model routes checkbox toggles through range selection when shifted', () => {
  assert.deepEqual(resolveFileGridItemToggleIntent({
    file: imageFile,
    index: 2,
    shiftKey: true,
  }), {
    kind: 'range-select',
    index: 2,
    path: 'albums/a.jpg',
  })

  assert.deepEqual(resolveFileGridItemToggleIntent({
    file: imageFile,
    index: 2,
    shiftKey: false,
  }), {
    kind: 'toggle-selection',
    index: 2,
    path: 'albums/a.jpg',
  })
})

test('File Grid Item Interaction Model resolves item click intents before UI effects', () => {
  assert.deepEqual(resolveFileGridItemClickIntent({
    file: imageFile,
    index: 3,
    suppressClick: true,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
  }), {
    kind: 'none',
  })

  assert.deepEqual(resolveFileGridItemClickIntent({
    file: imageFile,
    index: 3,
    suppressClick: false,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
  }), {
    kind: 'range-select',
    index: 3,
    path: 'albums/a.jpg',
  })

  assert.deepEqual(resolveFileGridItemClickIntent({
    file: imageFile,
    index: 3,
    suppressClick: false,
    shiftKey: false,
    ctrlKey: true,
    metaKey: false,
  }), {
    kind: 'toggle-selection',
    index: 3,
    path: 'albums/a.jpg',
  })

  assert.deepEqual(resolveFileGridItemClickIntent({
    file: directoryFile,
    index: 4,
    suppressClick: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
  }), {
    kind: 'open-directory',
    index: 4,
    path: 'albums',
    directoryName: 'albums',
  })

  assert.deepEqual(resolveFileGridItemClickIntent({
    file: imageFile,
    index: 5,
    suppressClick: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
  }), {
    kind: 'open-file',
    index: 5,
    path: 'albums/a.jpg',
    file: imageFile,
  })
})

test('File Grid Item Interaction Model opens secondary file actions only for unsuppressed file double clicks', () => {
  assert.deepEqual(resolveFileGridItemDoubleClickIntent({
    file: imageFile,
    suppressClick: false,
    canOpenFile: true,
  }), {
    kind: 'open-file-secondary',
    file: imageFile,
  })

  assert.deepEqual(resolveFileGridItemDoubleClickIntent({
    file: directoryFile,
    suppressClick: false,
    canOpenFile: true,
  }), {
    kind: 'none',
  })

  assert.deepEqual(resolveFileGridItemDoubleClickIntent({
    file: imageFile,
    suppressClick: true,
    canOpenFile: true,
  }), {
    kind: 'none',
  })
})
