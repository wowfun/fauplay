import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadPeoplePanelFaces,
  resolvePeoplePanelFacesLoadCommit,
} from '../../src/features/faces/lib/peoplePanelFacesLoad.ts'

const context = {
  rootHandle: null,
  rootId: 'local-root',
}

function face(faceId) {
  return {
    faceId,
    assetId: `asset-${faceId}`,
    assetPath: `${faceId}.jpg`,
    boundingBox: { x1: 0, y1: 0, x2: 1, y2: 1 },
    score: 0.9,
    status: 'unassigned',
    mediaType: 'image',
    frameTsMs: null,
    personId: null,
    personName: null,
    assignedBy: null,
    updatedAt: 1,
  }
}

test('People Panel Faces Load loads the selected person faces', async () => {
  const calls = []
  const result = await loadPeoplePanelFaces({
    context,
    view: 'people',
    selectedPersonId: 'person-a',
    readonly: false,
    scope: 'root',
    loaders: {
      listPersonFaces: async (receivedContext, options) => {
        calls.push({ name: 'person', context: receivedContext, options })
        return [face('face-a')]
      },
      listReviewFaces: async () => {
        calls.push({ name: 'review' })
        return [face('review-face')]
      },
    },
  })

  assert.deepEqual(result, {
    kind: 'loaded',
    faces: [face('face-a')],
  })
  assert.deepEqual(calls, [{
    name: 'person',
    context,
    options: {
      personId: 'person-a',
      scope: 'root',
    },
  }])
})

test('People Panel Faces Load loads the active review bucket', async () => {
  const calls = []
  const result = await loadPeoplePanelFaces({
    context,
    view: 'ignored',
    selectedPersonId: null,
    readonly: false,
    scope: 'global',
    loaders: {
      listPersonFaces: async () => {
        calls.push({ name: 'person' })
        return [face('person-face')]
      },
      listReviewFaces: async (receivedContext, options) => {
        calls.push({ name: 'review', context: receivedContext, options })
        return [face('ignored-face')]
      },
    },
  })

  assert.deepEqual(result, {
    kind: 'loaded',
    faces: [face('ignored-face')],
  })
  assert.deepEqual(calls, [{
    name: 'review',
    context,
    options: {
      scope: 'global',
      bucket: 'ignored',
      size: 500,
    },
  }])
})

test('People Panel Faces Load returns an empty result when no face request is valid', async () => {
  const result = await loadPeoplePanelFaces({
    context,
    view: 'people',
    selectedPersonId: null,
    readonly: false,
    scope: 'root',
    loaders: {
      listPersonFaces: async () => {
        throw new Error('should not load person faces')
      },
      listReviewFaces: async () => {
        throw new Error('should not load review faces')
      },
    },
  })

  assert.deepEqual(result, { kind: 'empty' })
  assert.deepEqual(resolvePeoplePanelFacesLoadCommit(result), {
    faces: [],
    notice: null,
  })
})

test('People Panel Faces Load converts failures to panel commits', async () => {
  const result = await loadPeoplePanelFaces({
    context,
    view: 'unassigned',
    selectedPersonId: null,
    readonly: false,
    scope: 'root',
    loaders: {
      listPersonFaces: async () => [],
      listReviewFaces: async () => {
        throw new Error('runtime unavailable')
      },
    },
  })

  assert.deepEqual(result, {
    kind: 'failed',
    message: 'runtime unavailable',
  })
  assert.deepEqual(resolvePeoplePanelFacesLoadCommit(result), {
    faces: [],
    notice: {
      tone: 'error',
      message: 'runtime unavailable',
    },
  })
})
