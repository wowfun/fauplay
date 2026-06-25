import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolvePeoplePanelCompactEmptySelectionStage,
  resolvePeoplePanelFacesLoadPlan,
  resolvePeoplePanelFaceSectionModel,
  resolvePeoplePanelListStage,
  resolvePeoplePanelPersonSelection,
  resolvePeoplePanelPreferredPersonFocus,
  resolvePeoplePanelRefreshedPeopleSelection,
  resolvePeoplePanelReadonlyMode,
  resolvePeoplePanelSelectionModel,
  resolvePeoplePanelViewSwitch,
} from '../../src/features/faces/lib/peoplePanelModel.ts'

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

function face(faceId, personId = null) {
  return {
    faceId,
    assetId: `asset-${faceId}`,
    assetPath: `${faceId}.jpg`,
    boundingBox: { x1: 0, y1: 0, x2: 1, y2: 1 },
    score: 0.9,
    status: personId ? 'assigned' : 'unassigned',
    mediaType: 'image',
    frameTsMs: null,
    personId,
    personName: null,
    assignedBy: null,
    updatedAt: 1,
  }
}

test('People Panel Selection Model resolves selected person from visible or cached people', () => {
  const visible = person({ personId: 'visible', name: 'Visible' })
  const cached = person({ personId: 'cached', name: 'Cached' })

  assert.equal(
    resolvePeoplePanelSelectionModel({
      people: [visible],
      allPeople: [cached],
      selectedPersonId: 'visible',
      faces: [],
      selectedFaceIds: new Set(),
      mergeTargetQuery: '',
      scope: 'global',
      view: 'people',
      isCompact: false,
      compactPeopleStage: 'list',
    }).selectedPerson?.personId,
    'visible',
  )

  assert.equal(
    resolvePeoplePanelSelectionModel({
      people: [visible],
      allPeople: [cached],
      selectedPersonId: 'cached',
      faces: [],
      selectedFaceIds: new Set(),
      mergeTargetQuery: '',
      scope: 'global',
      view: 'people',
      isCompact: false,
      compactPeopleStage: 'list',
    }).selectedPerson?.personId,
    'cached',
  )
})

test('People Panel Selection Model filters merge targets by display name, person id, or source path', () => {
  const selected = person({ personId: 'selected', name: 'Selected' })
  const byName = person({ personId: 'by-name', name: 'Mina' })
  const byId = person({ personId: 'archived-person', name: 'Other' })
  const byPath = person({ personId: 'by-path', name: 'Another', featureAssetPath: 'portraits/match.jpg' })
  const ignored = person({ personId: 'ignored', name: 'Nope', featureAssetPath: 'other.jpg' })

  const model = resolvePeoplePanelSelectionModel({
    people: [selected],
    allPeople: [selected, byName, byId, byPath, ignored],
    selectedPersonId: selected.personId,
    faces: [],
    selectedFaceIds: new Set(),
    mergeTargetQuery: 'match',
    scope: 'root',
    view: 'people',
    isCompact: true,
    compactPeopleStage: 'detail',
  })

  assert.deepEqual(
    model.mergeTargetCandidates.map((item) => item.personId),
    ['by-path'],
  )

  assert.deepEqual(
    resolvePeoplePanelSelectionModel({
      people: [selected],
      allPeople: [selected, byName, byId, byPath, ignored],
      selectedPersonId: selected.personId,
      faces: [],
      selectedFaceIds: new Set(),
      mergeTargetQuery: 'archived',
      scope: 'root',
      view: 'people',
      isCompact: true,
      compactPeopleStage: 'detail',
    }).mergeTargetCandidates.map((item) => item.personId),
    ['archived-person'],
  )

  assert.deepEqual(
    resolvePeoplePanelSelectionModel({
      people: [selected],
      allPeople: [selected, byName, byId, byPath, ignored],
      selectedPersonId: selected.personId,
      faces: [],
      selectedFaceIds: new Set(),
      mergeTargetQuery: 'mina',
      scope: 'root',
      view: 'people',
      isCompact: true,
      compactPeopleStage: 'detail',
    }).mergeTargetCandidates.map((item) => item.personId),
    ['by-name'],
  )
})

test('People Panel Selection Model derives selected faces and assignment state', () => {
  const model = resolvePeoplePanelSelectionModel({
    people: [],
    allPeople: [],
    selectedPersonId: 'person-1',
    faces: [face('face-1', 'person-1'), face('face-2', 'person-1'), face('face-3')],
    selectedFaceIds: new Set(['face-1', 'face-3']),
    mergeTargetQuery: '',
    scope: 'root',
    view: 'people',
    isCompact: true,
    compactPeopleStage: 'detail',
  })

  assert.deepEqual(model.selectedFaces.map((item) => item.faceId), ['face-1', 'face-3'])
  assert.deepEqual(model.selectedIds, ['face-1', 'face-3'])
  assert.deepEqual(model.assignmentExcludedPersonIds, ['person-1'])
  assert.equal(model.assignmentInputKey, 'root:people:person-1')
  assert.equal(model.faceSelectionScopeKey, 'root:people:person-1')
  assert.equal(model.showCompactPeopleList, false)
  assert.equal(model.showCompactPeopleDetail, true)
})

test('People Panel Selection Model derives compact list stage only for people view', () => {
  const peopleListModel = resolvePeoplePanelSelectionModel({
    people: [],
    allPeople: [],
    selectedPersonId: null,
    faces: [],
    selectedFaceIds: new Set(),
    mergeTargetQuery: '',
    scope: 'global',
    view: 'people',
    isCompact: true,
    compactPeopleStage: 'list',
  })

  const reviewModel = resolvePeoplePanelSelectionModel({
    people: [],
    allPeople: [],
    selectedPersonId: null,
    faces: [],
    selectedFaceIds: new Set(),
    mergeTargetQuery: '',
    scope: 'global',
    view: 'ignored',
    isCompact: true,
    compactPeopleStage: 'list',
  })

  assert.equal(peopleListModel.showCompactPeopleList, true)
  assert.equal(peopleListModel.showCompactPeopleDetail, false)
  assert.equal(reviewModel.showCompactPeopleList, false)
  assert.equal(reviewModel.showCompactPeopleDetail, false)
  assert.deepEqual(reviewModel.assignmentExcludedPersonIds, [])
  assert.equal(reviewModel.assignmentInputKey, 'global:ignored:')
})

test('People Panel Model resolves view switches and compact stages', () => {
  assert.deepEqual(resolvePeoplePanelViewSwitch('people', true), {
    view: 'people',
    compactPeopleStage: 'list',
    shouldClearSelection: true,
  })

  assert.deepEqual(resolvePeoplePanelViewSwitch('ignored', true), {
    view: 'ignored',
    compactPeopleStage: 'detail',
    shouldClearSelection: true,
  })

  assert.deepEqual(resolvePeoplePanelViewSwitch('unassigned', false), {
    view: 'unassigned',
    compactPeopleStage: null,
    shouldClearSelection: true,
  })
})

test('People Panel Model resolves compact person selection and list navigation', () => {
  assert.deepEqual(resolvePeoplePanelPersonSelection('person-a', true), {
    selectedPersonId: 'person-a',
    compactPeopleStage: 'detail',
  })

  assert.deepEqual(resolvePeoplePanelPersonSelection('person-a', false), {
    selectedPersonId: 'person-a',
    compactPeopleStage: null,
  })

  assert.equal(resolvePeoplePanelListStage(true), 'list')
  assert.equal(resolvePeoplePanelListStage(false), null)
})

test('People Panel Model resolves readonly and preferred-person state transitions', () => {
  assert.deepEqual(resolvePeoplePanelReadonlyMode(true), {
    scope: 'root',
    view: 'people',
  })
  assert.equal(resolvePeoplePanelReadonlyMode(false), null)

  assert.deepEqual(resolvePeoplePanelPreferredPersonFocus({
    open: true,
    preferredPersonId: 'person-a',
    isCompact: true,
  }), {
    view: 'people',
    selectedPersonId: 'person-a',
    compactPeopleStage: 'detail',
    shouldClearSelection: true,
  })

  assert.deepEqual(resolvePeoplePanelPreferredPersonFocus({
    open: true,
    preferredPersonId: 'person-a',
    isCompact: false,
  }), {
    view: 'people',
    selectedPersonId: 'person-a',
    compactPeopleStage: null,
    shouldClearSelection: true,
  })

  assert.equal(resolvePeoplePanelPreferredPersonFocus({
    open: false,
    preferredPersonId: 'person-a',
    isCompact: true,
  }), null)
})

test('People Panel Model keeps compact people view on the list when no person is selected', () => {
  assert.equal(resolvePeoplePanelCompactEmptySelectionStage({
    isCompact: true,
    open: true,
    view: 'people',
    selectedPersonId: null,
  }), 'list')

  assert.equal(resolvePeoplePanelCompactEmptySelectionStage({
    isCompact: true,
    open: true,
    view: 'people',
    selectedPersonId: 'person-a',
  }), null)

  assert.equal(resolvePeoplePanelCompactEmptySelectionStage({
    isCompact: false,
    open: true,
    view: 'people',
    selectedPersonId: null,
  }), null)

  assert.equal(resolvePeoplePanelCompactEmptySelectionStage({
    isCompact: true,
    open: true,
    view: 'ignored',
    selectedPersonId: null,
  }), null)
})

test('People Panel Model resolves the current faces load plan', () => {
  assert.deepEqual(resolvePeoplePanelFacesLoadPlan({
    view: 'people',
    selectedPersonId: 'person-a',
    readonly: false,
    scope: 'root',
  }), {
    kind: 'person',
    personId: 'person-a',
    scope: 'root',
  })

  assert.deepEqual(resolvePeoplePanelFacesLoadPlan({
    view: 'people',
    selectedPersonId: null,
    readonly: false,
    scope: 'global',
  }), { kind: 'empty' })

  assert.deepEqual(resolvePeoplePanelFacesLoadPlan({
    view: 'ignored',
    selectedPersonId: null,
    readonly: false,
    scope: 'global',
  }), {
    kind: 'review',
    bucket: 'ignored',
    scope: 'global',
    size: 500,
  })

  assert.deepEqual(resolvePeoplePanelFacesLoadPlan({
    view: 'unassigned',
    selectedPersonId: null,
    readonly: false,
    scope: 'root',
  }), {
    kind: 'review',
    bucket: 'unassigned',
    scope: 'root',
    size: 500,
  })

  assert.deepEqual(resolvePeoplePanelFacesLoadPlan({
    view: 'ignored',
    selectedPersonId: null,
    readonly: true,
    scope: 'root',
  }), { kind: 'empty' })
})

test('People Panel Model resolves face section display for layout and view state', () => {
  assert.deepEqual(resolvePeoplePanelFaceSectionModel({
    layout: 'wide',
    view: 'people',
    readonly: false,
    selectedFaceCount: 2,
    faceCount: 9,
    assignmentInputKey: 'root:people:person-a',
  }), {
    title: '人物详情',
    subtitle: '已选 2 / 当前 9',
    assignmentInputKey: 'wide:root:people:person-a',
    actionLayout: 'inline',
    assignmentClassName: 'max-w-[560px]',
    compactGrid: false,
  })

  assert.deepEqual(resolvePeoplePanelFaceSectionModel({
    layout: 'compact-review',
    view: 'ignored',
    readonly: false,
    selectedFaceCount: 1,
    faceCount: 3,
    assignmentInputKey: 'global:ignored:',
  }), {
    title: '误检 / 忽略池',
    subtitle: '已选 1 / 当前 3',
    assignmentInputKey: 'compact-review:global:ignored:',
    actionLayout: 'stacked',
    assignmentClassName: null,
    compactGrid: true,
  })

  assert.deepEqual(resolvePeoplePanelFaceSectionModel({
    layout: 'compact-detail',
    view: 'unassigned',
    readonly: true,
    selectedFaceCount: 0,
    faceCount: 5,
    assignmentInputKey: 'root:unassigned:',
  }), {
    title: '未归属池',
    subtitle: '双击人脸可打开来源文件',
    assignmentInputKey: 'compact-detail:root:unassigned:',
    actionLayout: 'stacked',
    assignmentClassName: null,
    compactGrid: true,
  })
})

test('People Panel Model preserves selected people when refreshed list still contains them', () => {
  const first = person({ personId: 'first' })
  const second = person({ personId: 'second' })

  assert.equal(resolvePeoplePanelRefreshedPeopleSelection({
    previousSelectedPersonId: 'second',
    people: [first, second],
  }), 'second')

  assert.equal(resolvePeoplePanelRefreshedPeopleSelection({
    previousSelectedPersonId: 'missing',
    people: [first, second],
  }), 'first')

  assert.equal(resolvePeoplePanelRefreshedPeopleSelection({
    previousSelectedPersonId: null,
    people: [first, second],
  }), 'first')

  assert.equal(resolvePeoplePanelRefreshedPeopleSelection({
    previousSelectedPersonId: 'missing',
    people: [],
  }), null)
})
