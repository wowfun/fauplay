import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPreviewMediaCollection,
  clampAutoPlayIntervalSec,
  normalizePreviewPath,
  normalizeVideoPlaybackRate,
  normalizeVideoSeekStepSec,
  nextVideoPlaybackRate,
  resolvePreviewFilteredFilesChangePlan,
  resolvePreviewMediaNavigation,
  resolvePreviewPlaybackOrderTogglePlan,
  resolvePreviewShuffleMediaSetSyncPlan,
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

test('Preview Traversal Model selects fallback media when enabling shuffle without an active preview', () => {
  const files = [
    directory('albums/raw'),
    file('albums/a.jpg'),
    file('albums/b.mp4'),
  ]
  const collection = buildPreviewMediaCollection(files)

  assert.deepEqual(
    resolvePreviewPlaybackOrderTogglePlan({
      collection,
      currentPlaybackOrder: 'sequential',
      activeMediaFile: null,
      isPreviewModalOpen: true,
      shufflePaths: (paths) => [...paths],
    }),
    {
      playbackOrder: 'shuffle',
      shuffleState: {
        queue: ['albums/b.mp4'],
        history: ['albums/a.jpg'],
      },
      lastShuffleMediaSetKey: 'albums/a.jpg\u0000albums/b.mp4',
      selection: {
        selectedFile: files[1],
        previewFile: files[1],
        showPreviewPane: true,
      },
    },
  )
})

test('Preview Traversal Model anchors shuffle playback on the active media preview', () => {
  const files = [
    file('albums/a.jpg'),
    file('albums/b.mp4'),
    file('albums/c.jpg'),
  ]
  const collection = buildPreviewMediaCollection(files)

  assert.deepEqual(
    resolvePreviewPlaybackOrderTogglePlan({
      collection,
      currentPlaybackOrder: 'sequential',
      activeMediaFile: files[1],
      isPreviewModalOpen: true,
      shufflePaths: (paths) => [...paths].reverse(),
    }),
    {
      playbackOrder: 'shuffle',
      shuffleState: {
        queue: ['albums/c.jpg', 'albums/a.jpg'],
        history: ['albums/b.mp4'],
      },
      lastShuffleMediaSetKey: 'albums/a.jpg\u0000albums/b.mp4\u0000albums/c.jpg',
      selection: null,
    },
  )
})

test('Preview Traversal Model clears shuffle state when returning to sequential playback', () => {
  const collection = buildPreviewMediaCollection([
    file('albums/a.jpg'),
    file('albums/b.mp4'),
  ])

  assert.deepEqual(
    resolvePreviewPlaybackOrderTogglePlan({
      collection,
      currentPlaybackOrder: 'shuffle',
      activeMediaFile: file('albums/a.jpg'),
      isPreviewModalOpen: false,
    }),
    {
      playbackOrder: 'sequential',
      shuffleState: {
        queue: [],
        history: [],
      },
      lastShuffleMediaSetKey: null,
      selection: null,
    },
  )
})

test('Preview Traversal Model repairs shuffle state when the media set changes', () => {
  const files = [
    file('albums/a.jpg'),
    file('albums/b.mp4'),
    file('albums/c.jpg'),
  ]
  const collection = buildPreviewMediaCollection(files)

  assert.deepEqual(
    resolvePreviewShuffleMediaSetSyncPlan({
      collection,
      playbackOrder: 'shuffle',
      activeMediaFile: files[1],
      hasOpenPreview: true,
      shuffleState: {
        queue: ['missing.jpg', 'albums/a.jpg'],
        history: ['albums/a.jpg', 'missing.jpg'],
      },
      lastShuffleMediaSetKey: 'old-media-set',
      shufflePaths: (paths) => [...paths].reverse(),
    }),
    {
      kind: 'repair-shuffle-state',
      shuffleState: {
        queue: ['albums/c.jpg', 'albums/a.jpg'],
        history: ['albums/b.mp4'],
      },
      lastShuffleMediaSetKey: 'albums/a.jpg\u0000albums/b.mp4\u0000albums/c.jpg',
    },
  )
})

test('Preview Traversal Model keeps cleared empty shuffle state stable', () => {
  assert.deepEqual(
    resolvePreviewShuffleMediaSetSyncPlan({
      collection: buildPreviewMediaCollection([]),
      playbackOrder: 'shuffle',
      activeMediaFile: null,
      hasOpenPreview: false,
      shuffleState: {
        queue: [],
        history: [],
      },
      lastShuffleMediaSetKey: '',
    }),
    { kind: 'none' },
  )
})

test('Preview Traversal Model advances missing shuffle selection to the next queued media', () => {
  const files = [
    file('albums/b.mp4'),
    file('albums/c.jpg'),
    directory('albums/raw'),
  ]
  const collection = buildPreviewMediaCollection(files)

  assert.deepEqual(
    resolvePreviewFilteredFilesChangePlan({
      files,
      collection,
      preferredPreviewPath: null,
      selectedFile: file('albums/a.jpg'),
      previewFile: file('albums/a.jpg'),
      showPreviewPane: true,
      playbackOrder: 'shuffle',
      shuffleState: {
        queue: ['missing.jpg', 'albums/c.jpg', 'albums/b.mp4'],
        history: ['albums/a.jpg', 'missing.jpg'],
      },
    }),
    {
      kind: 'apply-selection',
      clearPreferredPreviewPath: false,
      selection: {
        selectedFile: files[1],
        previewFile: files[1],
        showPreviewPane: true,
      },
      shuffleState: {
        queue: ['albums/b.mp4'],
        history: ['albums/c.jpg'],
      },
    },
  )
})

test('Preview Traversal Model clears preview state when the filtered Listing becomes empty', () => {
  assert.deepEqual(
    resolvePreviewFilteredFilesChangePlan({
      files: [],
      collection: buildPreviewMediaCollection([]),
      preferredPreviewPath: 'albums/a.jpg',
      selectedFile: file('albums/a.jpg'),
      previewFile: file('albums/a.jpg'),
      showPreviewPane: true,
      playbackOrder: 'sequential',
      shuffleState: {
        queue: ['albums/b.jpg'],
        history: ['albums/a.jpg'],
      },
    }),
    {
      kind: 'apply-selection',
      clearPreferredPreviewPath: true,
      selection: {
        selectedFile: null,
        previewFile: null,
        showPreviewPane: false,
      },
    },
  )
})

test('Preview Traversal Model resolves a preferred preview path when it appears in the filtered Listing', () => {
  const files = [
    file('albums/a.jpg'),
    file('albums/b.mp4'),
  ]

  assert.deepEqual(
    resolvePreviewFilteredFilesChangePlan({
      files,
      collection: buildPreviewMediaCollection(files),
      preferredPreviewPath: 'albums/b.mp4',
      selectedFile: files[0],
      previewFile: files[0],
      showPreviewPane: false,
      playbackOrder: 'sequential',
      shuffleState: {
        queue: [],
        history: [],
      },
    }),
    {
      kind: 'apply-selection',
      clearPreferredPreviewPath: true,
      selection: {
        selectedFile: files[1],
        previewFile: files[1],
        showPreviewPane: false,
      },
    },
  )
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
