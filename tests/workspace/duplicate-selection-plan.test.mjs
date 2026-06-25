import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveDuplicateSelectionPlan } from '../../src/features/workspace/lib/duplicateSelection.ts'
import { toToolScopedProjectionId } from '../../src/lib/projection.ts'

const DUPLICATE_PROJECTION_ID = toToolScopedProjectionId('data.findDuplicateFiles')

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function duplicateProjection(files) {
  return {
    id: DUPLICATE_PROJECTION_ID,
    title: 'Duplicate Sets',
    files,
    ordering: { mode: 'group_contiguous' },
  }
}

test('Duplicate Selection Plan applies a rule across Duplicate Sets', () => {
  const projection = duplicateProjection([
    file('set-a/new.jpg', { groupId: 'set-a', lastModifiedMs: 30 }),
    file('set-a/old.jpg', { groupId: 'set-a', lastModifiedMs: 10 }),
    file('set-b/current.jpg', { groupId: 'set-b', lastModifiedMs: 20 }),
    file('set-b/older.jpg', { groupId: 'set-b', lastModifiedMs: 5 }),
  ])

  assert.deepEqual(resolveDuplicateSelectionPlan({
    projection,
    currentSelectedPaths: [],
    currentRule: null,
    action: {
      kind: 'apply-rule',
      rule: 'keep_newest',
    },
  }), {
    kind: 'update',
    activeProjectionTabId: DUPLICATE_PROJECTION_ID,
    activeSurface: {
      kind: 'projection',
      tabId: DUPLICATE_PROJECTION_ID,
    },
    lastProjectionTabId: DUPLICATE_PROJECTION_ID,
    selectedPaths: [
      'set-a/old.jpg',
      'set-b/older.jpg',
    ],
    nextRule: 'keep_newest',
  })
})

test('Duplicate Selection Plan clears all Duplicate Set selections', () => {
  const projection = duplicateProjection([
    file('set-a/new.jpg', { groupId: 'set-a', lastModifiedMs: 30 }),
    file('set-a/old.jpg', { groupId: 'set-a', lastModifiedMs: 10 }),
  ])

  assert.deepEqual(resolveDuplicateSelectionPlan({
    projection,
    currentSelectedPaths: ['set-a/old.jpg'],
    currentRule: 'keep_newest',
    action: {
      kind: 'clear-all',
    },
  }), {
    kind: 'update',
    activeProjectionTabId: DUPLICATE_PROJECTION_ID,
    activeSurface: {
      kind: 'projection',
      tabId: DUPLICATE_PROJECTION_ID,
    },
    lastProjectionTabId: DUPLICATE_PROJECTION_ID,
    selectedPaths: [],
    nextRule: null,
  })
})

test('Duplicate Selection Plan reapplies the active rule to one Duplicate Set', () => {
  const projection = duplicateProjection([
    file('set-a/current.jpg', { groupId: 'set-a', isCurrentFile: true }),
    file('set-a/other.jpg', { groupId: 'set-a' }),
    file('set-b/new.jpg', { groupId: 'set-b', lastModifiedMs: 30 }),
    file('set-b/old.jpg', { groupId: 'set-b', lastModifiedMs: 10 }),
  ])

  assert.deepEqual(resolveDuplicateSelectionPlan({
    projection,
    currentSelectedPaths: ['set-a/other.jpg', 'set-b/new.jpg'],
    currentRule: 'keep_oldest',
    action: {
      kind: 'reapply-group',
      groupId: 'set-b',
    },
  }), {
    kind: 'update',
    activeProjectionTabId: DUPLICATE_PROJECTION_ID,
    activeSurface: {
      kind: 'projection',
      tabId: DUPLICATE_PROJECTION_ID,
    },
    lastProjectionTabId: DUPLICATE_PROJECTION_ID,
    selectedPaths: [
      'set-a/other.jpg',
      'set-b/new.jpg',
    ],
    nextRule: undefined,
  })
})

test('Duplicate Selection Plan clears one Duplicate Set without changing the active rule', () => {
  const projection = duplicateProjection([
    file('set-a/current.jpg', { groupId: 'set-a', isCurrentFile: true }),
    file('set-a/other.jpg', { groupId: 'set-a' }),
    file('set-b/new.jpg', { groupId: 'set-b', lastModifiedMs: 30 }),
    file('set-b/old.jpg', { groupId: 'set-b', lastModifiedMs: 10 }),
  ])

  assert.deepEqual(resolveDuplicateSelectionPlan({
    projection,
    currentSelectedPaths: ['set-a/other.jpg', 'set-b/new.jpg'],
    currentRule: 'keep_oldest',
    action: {
      kind: 'clear-group',
      groupId: 'set-b',
    },
  }), {
    kind: 'update',
    activeProjectionTabId: DUPLICATE_PROJECTION_ID,
    activeSurface: {
      kind: 'projection',
      tabId: DUPLICATE_PROJECTION_ID,
    },
    lastProjectionTabId: DUPLICATE_PROJECTION_ID,
    selectedPaths: [
      'set-a/other.jpg',
    ],
    nextRule: undefined,
  })
})
