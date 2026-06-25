import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLocalPublishedRootSyncPayload,
  readRemoteConnectErrorMessage,
  resolveAppWorkspaceVisibility,
  resolveInitialAccessProvider,
  resolveRemoteRootsConnectionPlan,
} from '../../src/lib/appAccessModel.ts'

function activeRemoteWorkspace(overrides = {}) {
  return {
    serviceOrigin: 'https://fauplay.test',
    serviceKey: 'remote:https://fauplay.test',
    configRootId: 'remote-root',
    uiRootId: 'remote:https://fauplay.test:root:remote-root',
    rootLabel: 'Remote Photos',
    ...overrides,
  }
}

test('App Access Model restores Remote Access only when stored state has an active remote workspace', () => {
  assert.equal(resolveInitialAccessProvider({
    storedProvider: 'remote-readonly',
    activeRemoteWorkspace: activeRemoteWorkspace(),
  }), 'remote-readonly')

  assert.equal(resolveInitialAccessProvider({
    storedProvider: 'remote-readonly',
    activeRemoteWorkspace: null,
  }), 'local-browser')

  assert.equal(resolveInitialAccessProvider({
    storedProvider: 'local-browser',
    activeRemoteWorkspace: activeRemoteWorkspace(),
  }), 'local-browser')
})

test('App Access Model resolves startup and workspace visibility', () => {
  assert.deepEqual(resolveAppWorkspaceVisibility({
    accessProvider: 'remote-readonly',
    activeRemoteWorkspace: activeRemoteWorkspace(),
    localRootId: null,
  }), {
    shouldShowRemoteWorkspace: true,
    shouldShowLocalWorkspace: false,
    shouldShowStartupScreen: false,
  })

  assert.deepEqual(resolveAppWorkspaceVisibility({
    accessProvider: 'local-browser',
    activeRemoteWorkspace: activeRemoteWorkspace(),
    localRootId: 'local-root',
  }), {
    shouldShowRemoteWorkspace: false,
    shouldShowLocalWorkspace: true,
    shouldShowStartupScreen: false,
  })

  assert.deepEqual(resolveAppWorkspaceVisibility({
    accessProvider: 'local-browser',
    activeRemoteWorkspace: null,
    localRootId: null,
  }), {
    shouldShowRemoteWorkspace: false,
    shouldShowLocalWorkspace: false,
    shouldShowStartupScreen: true,
  })
})

test('App Access Model reads Remote Access error messages for connection flows', () => {
  assert.equal(
    readRemoteConnectErrorMessage(
      { code: 'REMOTE_UNAUTHORIZED' },
      '远程连接失败',
      '远程 token 无效',
    ),
    '远程 token 无效',
  )

  assert.equal(
    readRemoteConnectErrorMessage(new Error('网络失败'), '远程连接失败'),
    '网络失败',
  )

  assert.equal(
    readRemoteConnectErrorMessage('unknown', '远程连接失败'),
    '远程连接失败',
  )
})

test('App Access Model resolves Remote Access root selection after connection', () => {
  assert.deepEqual(resolveRemoteRootsConnectionPlan([]), {
    kind: 'error',
    message: '当前远程服务未配置可访问的 Root',
  })

  assert.deepEqual(resolveRemoteRootsConnectionPlan([
    { id: 'remote-root', label: 'Remote Photos' },
  ]), {
    kind: 'auto-select',
    root: {
      id: 'remote-root',
      label: 'Remote Photos',
    },
    nextRemoteStep: 'roots',
    nextAccessProvider: 'remote-readonly',
  })

  assert.deepEqual(resolveRemoteRootsConnectionPlan([
    { id: 'root-a', label: 'Photos' },
    { id: 'root-b', label: 'Clips' },
  ]), {
    kind: 'choose-root',
    nextRemoteStep: 'roots',
  })
})

test('App Access Model builds Local Root publishing payloads from bound cached roots and favorites', () => {
  assert.deepEqual(buildLocalPublishedRootSyncPayload([
    {
      rootId: 'root-a',
      rootName: 'Photos',
      boundRootPath: ' /mnt/photos ',
    },
    {
      rootId: 'root-b',
      rootName: 'Unbound',
      boundRootPath: '   ',
    },
  ], [
    {
      rootId: 'root-a',
      path: '/albums/raw/',
    },
    {
      rootId: 'root-a',
      path: 'albums//raw',
    },
    {
      rootId: 'root-a',
      path: 'clips',
    },
    {
      rootId: 'root-b',
      path: 'ignored',
    },
  ]), [{
    label: 'Photos',
    absolutePath: '/mnt/photos',
    favoritePaths: ['albums/raw', 'clips'],
  }])
})
