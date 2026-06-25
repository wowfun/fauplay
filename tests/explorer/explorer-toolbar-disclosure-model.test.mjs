import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createExplorerToolbarDisclosureState,
  resolveExplorerToolbarDisclosureState,
} from '../../src/features/explorer/lib/explorerToolbarDisclosureModel.ts'

test('Explorer Toolbar Disclosure Model enters and cancels address edit mode', () => {
  const openState = {
    ...createExplorerToolbarDisclosureState('albums'),
    isHistoryOpen: true,
    isFavoritesOpen: true,
    isHelpOpen: true,
    openSegmentPath: 'albums',
    editError: '路径无效',
  }

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: openState,
    currentPath: 'albums/trip',
    action: { type: 'enter-edit' },
  }), {
    addressBarMode: 'edit',
    draftPath: 'albums/trip',
    editError: null,
    openSegmentPath: null,
    isHistoryOpen: false,
    isFavoritesOpen: false,
    isHelpOpen: false,
  })

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...createExplorerToolbarDisclosureState('albums'),
      addressBarMode: 'edit',
      draftPath: 'bad/path',
      editError: '路径无效',
    },
    currentPath: 'albums',
    action: { type: 'cancel-edit' },
  }), createExplorerToolbarDisclosureState('albums'))
})

test('Explorer Toolbar Disclosure Model keeps toolbar disclosures mutually exclusive', () => {
  const state = createExplorerToolbarDisclosureState('')

  const segmentOpen = resolveExplorerToolbarDisclosureState({
    state,
    currentPath: '',
    action: { type: 'toggle-segment', path: 'albums' },
  })
  assert.deepEqual(segmentOpen, {
    ...state,
    openSegmentPath: 'albums',
  })

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: segmentOpen,
    currentPath: '',
    action: { type: 'toggle-history' },
  }), {
    ...state,
    isHistoryOpen: true,
  })

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...state,
      isHistoryOpen: true,
    },
    currentPath: '',
    action: { type: 'toggle-favorites' },
  }), {
    ...state,
    isFavoritesOpen: true,
  })

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...state,
      isFavoritesOpen: true,
    },
    currentPath: '',
    action: { type: 'toggle-help' },
  }), {
    ...state,
    isHelpOpen: true,
  })

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...state,
      isHelpOpen: true,
    },
    currentPath: '',
    action: { type: 'toggle-help' },
  }), state)
})

test('Explorer Toolbar Disclosure Model resolves path changes and outside clicks', () => {
  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...createExplorerToolbarDisclosureState('albums'),
      isHistoryOpen: true,
      isHelpOpen: true,
    },
    currentPath: 'albums/trip',
    action: { type: 'current-path-changed' },
  }), createExplorerToolbarDisclosureState('albums/trip'))

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...createExplorerToolbarDisclosureState('albums'),
      addressBarMode: 'edit',
      draftPath: 'draft',
      editError: '路径无效',
      openSegmentPath: 'albums',
      isHistoryOpen: true,
      isFavoritesOpen: true,
      isHelpOpen: true,
    },
    currentPath: 'albums',
    action: { type: 'outside-address-click' },
  }), {
    ...createExplorerToolbarDisclosureState('albums'),
    isHelpOpen: true,
  })
})

test('Explorer Toolbar Disclosure Model closes committed navigation disclosures', () => {
  const state = createExplorerToolbarDisclosureState('albums')

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...state,
      addressBarMode: 'edit',
      openSegmentPath: 'albums',
    },
    currentPath: 'albums',
    action: { type: 'segment-navigation-committed' },
  }), {
    ...state,
    openSegmentPath: null,
  })

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...state,
      addressBarMode: 'edit',
      isHistoryOpen: true,
    },
    currentPath: 'albums',
    action: { type: 'history-navigation-committed' },
  }), {
    ...state,
    isHistoryOpen: false,
  })

  assert.deepEqual(resolveExplorerToolbarDisclosureState({
    state: {
      ...state,
      addressBarMode: 'edit',
      isFavoritesOpen: true,
    },
    currentPath: 'albums',
    action: { type: 'favorite-navigation-committed' },
  }), {
    ...state,
    isFavoritesOpen: false,
  })
})
