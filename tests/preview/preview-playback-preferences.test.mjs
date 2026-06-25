import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS,
  readPreviewPlaybackPreferences,
  savePreviewPlaybackPreferences,
} from '../../src/features/preview/lib/previewPlaybackPreferences.ts'

function memoryStorage(initialEntries = {}) {
  const values = new Map(Object.entries(initialEntries))
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    entries() {
      return Object.fromEntries(values.entries())
    },
  }
}

test('Preview Playback Preferences reads normalized values from storage', () => {
  const storage = memoryStorage({
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoSeekStepSec]: '10',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoPlaybackRate]: '0.75',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.playbackOrder]: 'shuffle',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.faceBboxVisible]: 'true',
  })

  assert.deepEqual(readPreviewPlaybackPreferences(storage), {
    videoSeekStepSec: 10,
    videoPlaybackRate: 1,
    playbackOrder: 'shuffle',
    faceBboxVisible: true,
  })
})

test('Preview Playback Preferences falls back when storage is unavailable or malformed', () => {
  const storage = memoryStorage({
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoSeekStepSec]: 'not-a-number',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoPlaybackRate]: '3',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.playbackOrder]: 'random',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.faceBboxVisible]: '{"enabled":true}',
  })

  assert.deepEqual(readPreviewPlaybackPreferences(storage), {
    videoSeekStepSec: 5,
    videoPlaybackRate: 3,
    playbackOrder: 'sequential',
    faceBboxVisible: false,
  })
  assert.deepEqual(readPreviewPlaybackPreferences(null), {
    videoSeekStepSec: 5,
    videoPlaybackRate: 1,
    playbackOrder: 'sequential',
    faceBboxVisible: false,
  })
})

test('Preview Playback Preferences saves normalized runtime values', () => {
  const storage = memoryStorage()

  savePreviewPlaybackPreferences(storage, {
    videoSeekStepSec: 4,
    videoPlaybackRate: 5,
    playbackOrder: 'shuffle',
    faceBboxVisible: true,
  })

  assert.deepEqual(storage.entries(), {
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoSeekStepSec]: '5',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoPlaybackRate]: '5',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.playbackOrder]: 'shuffle',
    [PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.faceBboxVisible]: 'true',
  })
})
