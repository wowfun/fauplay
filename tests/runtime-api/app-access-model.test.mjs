import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLocalPublishedRootSyncPayload,
  readRemoteConnectErrorMessage,
  resolveAppWorkspaceVisibility,
  resolveInitialAccessProvider,
  resolveLocalPublishedRootSyncPlan,
  resolveLocalWorkspaceIdentity,
  resolveRemoteAccessConnectionCommitPlan,
  resolveRemoteAccessResetPlan,
  resolveRemoteRememberedDeviceDraftChangePlan,
  resolveRemoteRootSelectionCommitPlan,
  resolveRemoteRootsConnectionPlan,
  resolveRemoteWorkspaceRestorePlan,
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
    accessProvider: 'remote-readonly',
    activeRemoteWorkspace: null,
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

test('App Access Model resolves Remote Access connection commits from available roots', () => {
  assert.deepEqual(resolveRemoteAccessConnectionCommitPlan({
    roots: [],
    clearConnectionDraft: true,
  }), {
    kind: 'error',
    message: '当前远程服务未配置可访问的 Root',
  })

  assert.deepEqual(resolveRemoteAccessConnectionCommitPlan({
    roots: [
      { id: 'remote-root', label: 'Remote Photos' },
    ],
    clearConnectionDraft: true,
  }), {
    kind: 'commit',
    remoteRoots: [
      { id: 'remote-root', label: 'Remote Photos' },
    ],
    remoteStep: 'roots',
    clearConnectionDraft: true,
    activeRemoteRoot: { id: 'remote-root', label: 'Remote Photos' },
    nextAccessProvider: 'remote-readonly',
  })

  assert.deepEqual(resolveRemoteAccessConnectionCommitPlan({
    roots: [
      { id: 'root-a', label: 'Photos' },
      { id: 'root-b', label: 'Clips' },
    ],
    clearConnectionDraft: false,
  }), {
    kind: 'commit',
    remoteRoots: [
      { id: 'root-a', label: 'Photos' },
      { id: 'root-b', label: 'Clips' },
    ],
    remoteStep: 'roots',
    clearConnectionDraft: false,
  })
})

test('App Access Model commits a manually selected Remote Root', () => {
  assert.deepEqual(resolveRemoteRootSelectionCommitPlan({
    id: 'root-b',
    label: 'Clips',
  }), {
    remoteError: null,
    activeRemoteRoot: {
      id: 'root-b',
      label: 'Clips',
    },
    nextAccessProvider: 'remote-readonly',
  })
})

test('App Access Model resolves Remembered Device draft changes', () => {
  assert.deepEqual(resolveRemoteRememberedDeviceDraftChangePlan({
    nextRememberDevice: true,
    currentDeviceLabel: 'Desktop',
  }), {
    rememberRemoteDevice: true,
    rememberRemoteDeviceLabel: 'Desktop',
  })

  assert.deepEqual(resolveRemoteRememberedDeviceDraftChangePlan({
    nextRememberDevice: false,
    currentDeviceLabel: 'Desktop',
  }), {
    rememberRemoteDevice: false,
    rememberRemoteDeviceLabel: '',
  })
})

test('App Access Model restores stored Remote Access workspaces only when the Remote Root is available', () => {
  assert.deepEqual(resolveRemoteWorkspaceRestorePlan({
    activeRemoteWorkspace: activeRemoteWorkspace({
      configRootId: 'root-b',
    }),
    roots: [
      { id: 'root-a', label: 'Photos' },
      { id: 'root-b', label: 'Clips' },
    ],
  }), {
    kind: 'restore',
    root: { id: 'root-b', label: 'Clips' },
  })

  assert.deepEqual(resolveRemoteWorkspaceRestorePlan({
    activeRemoteWorkspace: activeRemoteWorkspace({
      configRootId: 'missing-root',
    }),
    roots: [
      { id: 'root-a', label: 'Photos' },
    ],
  }), {
    kind: 'error',
    message: '远程 Root 已不存在或当前会话无权访问',
  })
})

test('App Access Model resolves Remote Access reset plans for connection and session exits', () => {
  assert.deepEqual(resolveRemoteAccessResetPlan({ reason: 'open-connect' }), {
    clearActiveRemoteWorkspace: false,
    remoteRoots: [],
    remoteToken: '',
    rememberRemoteDevice: false,
    rememberRemoteDeviceLabel: '',
    remoteStep: 'token',
    remoteError: null,
  })

  assert.deepEqual(resolveRemoteAccessResetPlan({ reason: 'cancel-connect' }), {
    clearActiveRemoteWorkspace: false,
    remoteRoots: [],
    remoteToken: '',
    rememberRemoteDevice: false,
    rememberRemoteDeviceLabel: '',
    remoteStep: 'idle',
    remoteError: null,
  })

  assert.deepEqual(resolveRemoteAccessResetPlan({ reason: 'session-invalidated' }), {
    clearActiveRemoteWorkspace: true,
    remoteRoots: [],
    remoteToken: '',
    rememberRemoteDevice: false,
    rememberRemoteDeviceLabel: '',
    remoteStep: 'token',
    remoteError: '远程会话已失效，请重新连接',
    nextAccessProvider: 'local-browser',
  })

  assert.deepEqual(resolveRemoteAccessResetPlan({
    reason: 'restore-failed',
    remoteError: '远程会话恢复失败',
  }), {
    clearActiveRemoteWorkspace: true,
    remoteRoots: [],
    remoteToken: '',
    rememberRemoteDevice: false,
    rememberRemoteDeviceLabel: '',
    remoteStep: 'token',
    remoteError: '远程会话恢复失败',
    nextAccessProvider: 'local-browser',
  })

  assert.deepEqual(resolveRemoteAccessResetPlan({ reason: 'disconnect-workspace' }), {
    clearActiveRemoteWorkspace: true,
    remoteRoots: [],
    remoteToken: '',
    rememberRemoteDevice: false,
    rememberRemoteDeviceLabel: '',
    remoteStep: 'token',
    remoteError: null,
    nextAccessProvider: 'local-browser',
  })

  assert.deepEqual(resolveRemoteAccessResetPlan({ reason: 'forget-device' }), {
    clearActiveRemoteWorkspace: true,
    remoteRoots: [],
    remoteToken: '',
    rememberRemoteDevice: false,
    rememberRemoteDeviceLabel: '',
    remoteStep: 'token',
    nextAccessProvider: 'local-browser',
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

test('App Access Model resolves Local Workspace identity for browser and Runtime-backed roots', () => {
  assert.deepEqual(resolveLocalWorkspaceIdentity({
    rootId: 'cached-root',
    rootName: 'Photos',
    rootHandleName: 'Ignored Handle',
    fallbackSessionRootId: 'session:Ignored Handle:1',
  }), {
    rootId: 'cached-root',
    rootName: 'Photos',
    workspaceKey: 'local:cached-root',
    storageNamespace: 'local-browser',
  })

  assert.deepEqual(resolveLocalWorkspaceIdentity({
    rootId: null,
    rootName: '',
    rootHandleName: 'Dropped Folder',
    fallbackSessionRootId: 'session:Dropped Folder:1',
  }), {
    rootId: 'session:Dropped Folder:1',
    rootName: 'Dropped Folder',
    workspaceKey: 'local:session:Dropped Folder:1',
    storageNamespace: 'local-browser',
  })

  assert.deepEqual(resolveLocalWorkspaceIdentity({
    rootId: null,
    rootName: null,
    rootHandleName: null,
    fallbackSessionRootId: null,
  }), {
    rootId: 'local-runtime',
    rootName: '根目录',
    workspaceKey: 'local:local-runtime',
    storageNamespace: 'local-browser',
  })
})

test('App Access Model plans Local Root publishing sync only for new loopback payloads', () => {
  const cachedRoots = [
    {
      rootId: 'root-a',
      rootName: 'Photos',
      boundRootPath: '/mnt/photos',
    },
  ]
  const favoriteFolders = [
    {
      rootId: 'root-a',
      path: 'albums/raw',
    },
  ]

  assert.deepEqual(resolveLocalPublishedRootSyncPlan({
    isLoopbackUi: false,
    isCachedRootsReady: true,
    cachedRoots,
    favoriteFolders,
    lastSyncedSignature: null,
  }), { kind: 'skip' })

  const plan = resolveLocalPublishedRootSyncPlan({
    isLoopbackUi: true,
    isCachedRootsReady: true,
    cachedRoots,
    favoriteFolders,
    lastSyncedSignature: null,
  })
  assert.deepEqual(plan, {
    kind: 'sync',
    payload: [{
      label: 'Photos',
      absolutePath: '/mnt/photos',
      favoritePaths: ['albums/raw'],
    }],
    signature: '[{"label":"Photos","absolutePath":"/mnt/photos","favoritePaths":["albums/raw"]}]',
  })

  assert.deepEqual(resolveLocalPublishedRootSyncPlan({
    isLoopbackUi: true,
    isCachedRootsReady: true,
    cachedRoots,
    favoriteFolders,
    lastSyncedSignature: plan.kind === 'sync' ? plan.signature : null,
  }), { kind: 'skip' })
})
