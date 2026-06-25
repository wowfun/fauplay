import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadPeoplePanelAllPeople,
  loadPeoplePanelPeopleList,
  resolvePeoplePanelAllPeopleLoadCommit,
  resolvePeoplePanelPeopleListLoadCommit,
} from '../../src/features/faces/lib/peoplePanelPeopleLoad.ts'

const context = {
  rootHandle: null,
  rootId: 'local-root',
}

function person(overrides) {
  return {
    personId: 'person-1',
    name: 'Ada',
    faceCount: 1,
    globalFaceCount: 1,
    featureFaceId: null,
    featureAssetPath: null,
    updatedAt: null,
    ...overrides,
  }
}

test('People Panel People Load loads the visible People list and keeps a refreshed selection', async () => {
  const calls = []
  const selected = person({ personId: 'selected' })
  const result = await loadPeoplePanelPeopleList({
    context,
    scope: 'root',
    query: '  ada  ',
    listPeople: async (receivedContext, options) => {
      calls.push({ context: receivedContext, options })
      return [person({ personId: 'other' }), selected]
    },
  })

  assert.deepEqual(result, {
    kind: 'loaded',
    people: [person({ personId: 'other' }), selected],
  })
  assert.deepEqual(calls, [{
    context,
    options: {
      scope: 'root',
      query: 'ada',
      size: 300,
    },
  }])
  assert.deepEqual(resolvePeoplePanelPeopleListLoadCommit(result, {
    previousSelectedPersonId: selected.personId,
  }), {
    people: [person({ personId: 'other' }), selected],
    nextSelectedPersonId: selected.personId,
    notice: null,
  })
})

test('People Panel People Load loads the all-People cache for edit candidates', async () => {
  const calls = []
  const items = [
    person({ personId: 'ada' }),
    person({ personId: 'grace' }),
  ]
  const result = await loadPeoplePanelAllPeople({
    context,
    scope: 'global',
    listPeople: async (receivedContext, options) => {
      calls.push({ context: receivedContext, options })
      return items
    },
  })

  assert.deepEqual(result, {
    kind: 'loaded',
    people: items,
  })
  assert.deepEqual(calls, [{
    context,
    options: {
      scope: 'global',
      size: 400,
    },
  }])
})

test('People Panel People Load converts People list failures to commits', async () => {
  const listResult = await loadPeoplePanelPeopleList({
    context,
    scope: 'root',
    query: '',
    listPeople: async () => {
      throw new Error('runtime unavailable')
    },
  })

  assert.deepEqual(resolvePeoplePanelPeopleListLoadCommit(listResult, {
    previousSelectedPersonId: 'selected',
  }), {
    people: [],
    nextSelectedPersonId: undefined,
    notice: {
      tone: 'error',
      message: 'runtime unavailable',
    },
  })

  const allResult = await loadPeoplePanelAllPeople({
    context,
    scope: 'root',
    listPeople: async () => {
      throw new Error('cache unavailable')
    },
  })

  assert.deepEqual(resolvePeoplePanelAllPeopleLoadCommit(allResult), {
    allPeople: undefined,
    notice: {
      tone: 'error',
      message: 'cache unavailable',
    },
  })
})
