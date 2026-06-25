import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createIdleAddressSuggestionSessionState,
  getSegmentDropdownState,
  resolveAddressSuggestionLookupPath,
  resolveAddressSuggestionLoadErrorState,
  resolveAddressSuggestionLoadStartState,
  resolveAddressSuggestionLoadSuccessState,
  resolveSegmentDropdownLoadErrorState,
  resolveSegmentDropdownLoadStartState,
  resolveSegmentDropdownLoadSuccessState,
  toAddressTaskErrorMessage,
} from '../../src/features/explorer/lib/explorerToolbarAddressBarModel.ts'

test('Explorer Toolbar Address Bar Model records segment directory loading by Root-relative Path', () => {
  let stateByPath = resolveSegmentDropdownLoadStartState({}, '')

  assert.deepEqual(getSegmentDropdownState(stateByPath, ''), {
    status: 'loading',
    items: [],
    errorMessage: null,
  })
  assert.deepEqual(getSegmentDropdownState(stateByPath, 'albums'), {
    status: 'idle',
    items: [],
    errorMessage: null,
  })

  stateByPath = resolveSegmentDropdownLoadSuccessState(stateByPath, '', ['albums', 'exports'])
  stateByPath = resolveSegmentDropdownLoadErrorState(stateByPath, 'albums/raw', '读取子目录失败')

  assert.deepEqual(getSegmentDropdownState(stateByPath, ''), {
    status: 'ready',
    items: ['albums', 'exports'],
    errorMessage: null,
  })
  assert.deepEqual(getSegmentDropdownState(stateByPath, 'albums/raw'), {
    status: 'error',
    items: [],
    errorMessage: '读取子目录失败',
  })
})

test('Explorer Toolbar Address Bar Model resolves suggestion loading states', () => {
  assert.equal(resolveAddressSuggestionLookupPath('albums/r'), 'albums')
  assert.equal(resolveAddressSuggestionLookupPath('albums/raw/'), 'albums/raw')

  assert.deepEqual(createIdleAddressSuggestionSessionState(), {
    status: 'idle',
    items: [],
    errorMessage: null,
    activeIndex: -1,
  })

  assert.deepEqual(resolveAddressSuggestionLoadStartState(), {
    status: 'loading',
    items: [],
    errorMessage: null,
    activeIndex: -1,
  })

  const readyState = resolveAddressSuggestionLoadSuccessState({
    draftPath: 'albums/r',
    childDirectories: ['raw', 'rendered', 'notes'],
    favoriteFolders: [
      {
        rootId: 'local-root',
        rootName: 'Photos',
        path: 'albums/raw',
        favoritedAt: 20,
      },
      {
        rootId: 'archive-root',
        rootName: 'Archive',
        path: 'albums/restored',
        favoritedAt: 10,
      },
    ],
    recentPathHistory: [
      {
        rootId: 'local-root',
        rootName: 'Photos',
        path: 'albums/raw/2026',
        visitedAt: 30,
      },
    ],
    currentRootId: 'local-root',
    currentRootLabel: 'Photos',
    maxItems: 4,
  })

  assert.equal(readyState.status, 'ready')
  assert.equal(readyState.errorMessage, null)
  assert.equal(readyState.activeIndex, -1)
  assert.deepEqual(readyState.items.map((item) => ({
    path: item.path,
    source: item.source,
    rootId: item.rootId,
  })), [
    {
      path: 'albums/raw',
      source: 'directory',
      rootId: 'local-root',
    },
    {
      path: 'albums/rendered',
      source: 'directory',
      rootId: 'local-root',
    },
    {
      path: 'albums/restored',
      source: 'favorite',
      rootId: 'archive-root',
    },
    {
      path: 'albums/raw/2026',
      source: 'history',
      rootId: 'local-root',
    },
  ])

  assert.deepEqual(resolveAddressSuggestionLoadErrorState('读取补全失败'), {
    status: 'error',
    items: [],
    errorMessage: '读取补全失败',
    activeIndex: -1,
  })
})

test('Explorer Toolbar Address Bar Model normalizes task error messages', () => {
  assert.equal(toAddressTaskErrorMessage(new Error('权限不足'), '读取失败'), '权限不足')
  assert.equal(toAddressTaskErrorMessage('bad', '读取失败'), '读取失败')
})
