import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPreviewMediaCollection,
  clampAutoPlayIntervalSec,
  normalizePreviewPath,
  normalizeVideoPlaybackRate,
  normalizeVideoSeekStepSec,
  nextVideoPlaybackRate,
  resolvePreviewMediaNavigation,
} from '../../src/features/preview/lib/previewTraversalModel.ts'

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

test('Preview Traversal Model builds a media-only collection with stable lookup keys', () => {
  const collection = buildPreviewMediaCollection([
    file('albums/clip.mp4'),
    directory('albums/raw'),
    file('albums/notes.md'),
    file('albums/cover.jpg'),
  ])

  assert.deepEqual(collection.mediaFiles.map((item) => item.path), [
    'albums/clip.mp4',
    'albums/cover.jpg',
  ])
  assert.equal(collection.mediaIndexByPath.get('albums/cover.jpg'), 1)
  assert.equal(collection.mediaFileByPath.get('albums/clip.mp4')?.name, 'clip.mp4')
  assert.equal(collection.mediaSetKey, 'albums/clip.mp4\u0000albums/cover.jpg')
})

test('Preview Traversal Model resolves sequential media navigation with boundary wrapping', () => {
  const files = [
    file('albums/a.jpg'),
    file('albums/b.mp4'),
    file('albums/c.jpg'),
  ]
  const collection = buildPreviewMediaCollection(files)

  assert.equal(resolvePreviewMediaNavigation({
    collection,
    currentFile: files[1],
    direction: 'next',
    playbackOrder: 'sequential',
    wrap: true,
  })?.nextFile.path, 'albums/c.jpg')

  assert.equal(resolvePreviewMediaNavigation({
    collection,
    currentFile: files[2],
    direction: 'next',
    playbackOrder: 'sequential',
    wrap: false,
  }), null)

  assert.equal(resolvePreviewMediaNavigation({
    collection,
    currentFile: files[2],
    direction: 'next',
    playbackOrder: 'sequential',
    wrap: true,
  })?.nextFile.path, 'albums/a.jpg')
})

test('Preview Traversal Model advances shuffle playback and rebuilds an empty queue', () => {
  const files = [
    file('albums/a.jpg'),
    file('albums/b.jpg'),
    file('albums/c.mp4'),
  ]
  const collection = buildPreviewMediaCollection(files)
  const plan = resolvePreviewMediaNavigation({
    collection,
    currentFile: files[0],
    direction: 'next',
    playbackOrder: 'shuffle',
    wrap: true,
    shuffleState: {
      queue: [],
      history: ['albums/a.jpg'],
    },
    shufflePaths: (paths) => [...paths].reverse(),
  })

  assert.equal(plan?.nextFile.path, 'albums/c.mp4')
  assert.deepEqual(plan?.shuffleState, {
    queue: ['albums/b.jpg'],
    history: ['albums/a.jpg', 'albums/c.mp4'],
  })
})

test('Preview Traversal Model moves backward through shuffle history', () => {
  const files = [
    file('albums/a.jpg'),
    file('albums/b.jpg'),
    file('albums/c.mp4'),
  ]
  const collection = buildPreviewMediaCollection(files)
  const plan = resolvePreviewMediaNavigation({
    collection,
    currentFile: files[2],
    direction: 'prev',
    playbackOrder: 'shuffle',
    wrap: true,
    shuffleState: {
      queue: ['albums/a.jpg'],
      history: ['albums/a.jpg', 'albums/b.jpg', 'albums/c.mp4'],
    },
  })

  assert.equal(plan?.nextFile.path, 'albums/b.jpg')
  assert.deepEqual(plan?.shuffleState, {
    queue: ['albums/c.mp4', 'albums/a.jpg'],
    history: ['albums/a.jpg', 'albums/b.jpg'],
  })
})

test('Preview Traversal Model normalizes playback controls and preferred paths', () => {
  assert.equal(clampAutoPlayIntervalSec(0), 1)
  assert.equal(clampAutoPlayIntervalSec(99), 10)
  assert.equal(clampAutoPlayIntervalSec(4), 4)

  assert.equal(normalizeVideoSeekStepSec(3), 3)
  assert.equal(normalizeVideoSeekStepSec(4), 5)
  assert.equal(normalizeVideoPlaybackRate(5), 5)
  assert.equal(normalizeVideoPlaybackRate(0.75), 1)
  assert.equal(nextVideoPlaybackRate(1), 3)
  assert.equal(nextVideoPlaybackRate(5), 0.5)
  assert.equal(nextVideoPlaybackRate(0.75), 3)

  assert.equal(normalizePreviewPath('/albums//clip.mp4'), 'albums/clip.mp4')
  assert.equal(normalizePreviewPath(null), null)
  assert.equal(normalizePreviewPath(''), null)
})
