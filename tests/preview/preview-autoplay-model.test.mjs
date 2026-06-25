import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolvePreviewAutoPlayAdvanceIntent,
  resolvePreviewAutoPlayEligibility,
  resolvePreviewAutoPlayGateIntent,
  resolvePreviewAutoPlayTimerPlan,
} from '../../src/features/preview/lib/previewAutoPlayModel.ts'

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

test('Preview AutoPlay Model enables autoplay only for visible active media collections', () => {
  assert.equal(resolvePreviewAutoPlayEligibility({
    autoPlayEnabled: true,
    pausedByVisibility: false,
    hasActiveMediaPreview: true,
    mediaCount: 2,
  }), true)

  assert.equal(resolvePreviewAutoPlayEligibility({
    autoPlayEnabled: true,
    pausedByVisibility: true,
    hasActiveMediaPreview: true,
    mediaCount: 2,
  }), false)

  assert.equal(resolvePreviewAutoPlayEligibility({
    autoPlayEnabled: true,
    pausedByVisibility: false,
    hasActiveMediaPreview: true,
    mediaCount: 1,
  }), false)
})

test('Preview AutoPlay Model disables autoplay when no preview can advance', () => {
  assert.deepEqual(resolvePreviewAutoPlayGateIntent({
    autoPlayEnabled: true,
    hasOpenPreview: false,
    hasActiveMediaPreview: false,
  }), { kind: 'disable-autoplay' })

  assert.deepEqual(resolvePreviewAutoPlayGateIntent({
    autoPlayEnabled: true,
    hasOpenPreview: true,
    hasActiveMediaPreview: false,
  }), { kind: 'disable-autoplay' })

  assert.deepEqual(resolvePreviewAutoPlayGateIntent({
    autoPlayEnabled: false,
    hasOpenPreview: false,
    hasActiveMediaPreview: false,
  }), { kind: 'none' })
})

test('Preview AutoPlay Model advances eligible video end and error events', () => {
  assert.deepEqual(resolvePreviewAutoPlayAdvanceIntent({
    isAutoPlayEligible: true,
    activeFile: file('albums/clip.mp4'),
  }), { kind: 'advance-media' })

  assert.deepEqual(resolvePreviewAutoPlayAdvanceIntent({
    isAutoPlayEligible: true,
    activeFile: file('albums/photo.jpg'),
  }), { kind: 'none' })

  assert.deepEqual(resolvePreviewAutoPlayAdvanceIntent({
    isAutoPlayEligible: true,
    activeFile: directory('albums/raw'),
  }), { kind: 'none' })
})

test('Preview AutoPlay Model schedules image timers without scheduling video timers', () => {
  assert.deepEqual(resolvePreviewAutoPlayTimerPlan({
    isAutoPlayEligible: true,
    activeFile: file('albums/photo.jpg'),
    intervalSec: 4,
  }), {
    kind: 'schedule-image-advance',
    delayMs: 4000,
  })

  assert.deepEqual(resolvePreviewAutoPlayTimerPlan({
    isAutoPlayEligible: true,
    activeFile: file('albums/clip.mp4'),
    intervalSec: 4,
  }), { kind: 'none' })

  assert.deepEqual(resolvePreviewAutoPlayTimerPlan({
    isAutoPlayEligible: true,
    activeFile: file('albums/notes.md'),
    intervalSec: 4,
  }), { kind: 'none' })

  assert.deepEqual(resolvePreviewAutoPlayTimerPlan({
    isAutoPlayEligible: false,
    activeFile: file('albums/photo.jpg'),
    intervalSec: 4,
  }), { kind: 'none' })
})
