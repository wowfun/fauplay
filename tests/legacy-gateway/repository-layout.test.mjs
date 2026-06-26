import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import test from 'node:test'

test('Legacy Gateway no longer keeps local annotation rebind storage code', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/data/bindings.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(serverSource.includes('batchRebindPaths'), false)
})

test('Legacy Gateway no longer exposes local Remote Root publishing sync', async () => {
  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(
    serverSource.includes('/v1/admin/remote-published-roots/sync-from-local-browser'),
    false,
  )
})

test('Legacy Gateway no longer exposes the Runtime MCP endpoint', async () => {
  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(serverSource.includes("pathname === '/v1/mcp'"), false)
  assert.equal(serverSource.includes('MCP_SESSION_HEADER'), false)
  assert.equal(serverSource.includes('parseJsonRpcRequest'), false)
  assert.equal(serverSource.includes('handleMcpRequest'), false)
})

test('Legacy Gateway no longer exposes local Face Crop directly', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/face_crop.py', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(serverSource.includes("pathname.startsWith('/v1/faces/crops/')"), false)
  assert.equal(serverSource.includes("pathname.slice('/v1/faces/crops/'.length)"), false)
  assert.equal(serverSource.includes('getFaceCrop'), false)
  assert.equal(serverSource.includes('readRemoteReadonlyFaceCrop'), false)
})

test('Legacy Gateway no longer owns MCP config or stdio hosting', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/mcp-config.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/mcp/runtime.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/mcp/stdio-runner.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(serverSource.includes('McpHostRuntime'), false)
  assert.equal(serverSource.includes('createMcpServerRegistry'), false)
  assert.equal(serverSource.includes('DEFAULT_MCP_CONFIG_PATH'), false)
})

test('Legacy Gateway no longer owns Remote Access file streaming', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/file-stream-response.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(new URL('../../tools/legacy-gateway/server.mjs', import.meta.url), 'utf8')
  assert.equal(serverSource.includes('sendFileStreamResponse'), false)
  assert.equal(serverSource.includes('parseByteRangeHeader'), false)
})

test('Legacy Gateway no longer owns Remote Access directory traversal', async () => {
  const remoteFileAccessSource = await readFile(
    new URL('../../tools/legacy-gateway/remote-file-access.mjs', import.meta.url),
    'utf8',
  )
  const remoteReadonlySource = await readFile(
    new URL('../../tools/legacy-gateway/remote-readonly.mjs', import.meta.url),
    'utf8',
  )
  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(remoteReadonlySource.includes('readDirectoryItemsRecursive'), false)
  assert.equal(remoteReadonlySource.includes('createDirectoryTraversalBudget'), false)
  assert.equal(remoteReadonlySource.includes('REMOTE_FLATTEN_VIEW_MAX_FILES'), false)
  assert.equal(remoteReadonlySource.includes('HIDDEN_SYSTEM_DIRECTORIES'), false)
  assert.equal(remoteReadonlySource.includes('listRemoteReadonlyFiles'), false)
  assert.equal(remoteReadonlySource.includes('toRemoteReadonlyListingItems'), false)
  assert.equal(remoteFileAccessSource.includes('readRuntimeDirectoryListing'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/local-directory'), false)
  assert.equal(serverSource.includes('listRemoteReadonlyFiles'), false)
  assert.equal(serverSource.includes('listRemoteReadonlyRoots'), false)
})

test('Legacy Gateway no longer owns Remote Access tag data reads', async () => {
  const remoteFileAccessSource = await readFile(
    new URL('../../tools/legacy-gateway/remote-file-access.mjs', import.meta.url),
    'utf8',
  )
  const remoteReadonlySource = await readFile(
    new URL('../../tools/legacy-gateway/remote-readonly.mjs', import.meta.url),
    'utf8',
  )
  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(remoteReadonlySource.includes('getFileTags'), false)
  assert.equal(remoteReadonlySource.includes('listTagOptions'), false)
  assert.equal(remoteReadonlySource.includes('queryFilesByTags'), false)
  assert.equal(remoteReadonlySource.includes('stripAbsolutePathFromTagQueryResult'), false)
  assert.equal(remoteReadonlySource.includes('listRemoteReadonlyTagOptions'), false)
  assert.equal(remoteReadonlySource.includes('queryRemoteReadonlyFilesByTags'), false)
  assert.equal(remoteReadonlySource.includes('getRemoteReadonlyFileTags'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/data/tags/options'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/data/tags/query'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/data/tags/file'), false)
  assert.equal(serverSource.includes('listRemoteReadonlyTagOptions'), false)
  assert.equal(serverSource.includes('queryRemoteReadonlyFilesByTags'), false)
  assert.equal(serverSource.includes('getRemoteReadonlyFileTags'), false)
})

test('Legacy Gateway no longer owns Remote Access Favorite Folder data reads', async () => {
  const remoteFileAccessSource = await readFile(
    new URL('../../tools/legacy-gateway/remote-file-access.mjs', import.meta.url),
    'utf8',
  )
  const remoteReadonlySource = await readFile(
    new URL('../../tools/legacy-gateway/remote-readonly.mjs', import.meta.url),
    'utf8',
  )
  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(remoteReadonlySource.includes('listRemoteReadonlyFavorites'), false)
  assert.equal(remoteReadonlySource.includes('upsertRemoteReadonlyFavorite'), false)
  assert.equal(remoteReadonlySource.includes('removeRemoteReadonlyFavorite'), false)
  assert.equal(remoteReadonlySource.includes('toRemoteReadonlyFavorite'), false)
  assert.equal(remoteReadonlySource.includes('normalizeRemoteFavoritePath'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/remote/shared-favorites'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/remote/shared-favorites/upsert'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/remote/shared-favorites/remove'), false)
  assert.equal(serverSource.includes('listRemoteReadonlyFavorites'), false)
  assert.equal(serverSource.includes('upsertRemoteReadonlyFavorite'), false)
  assert.equal(serverSource.includes('removeRemoteReadonlyFavorite'), false)
})

test('Legacy Gateway no longer owns Remote Access face people data reads', async () => {
  const remoteFileAccessSource = await readFile(
    new URL('../../tools/legacy-gateway/remote-file-access.mjs', import.meta.url),
    'utf8',
  )
  const remoteReadonlySource = await readFile(
    new URL('../../tools/legacy-gateway/remote-readonly.mjs', import.meta.url),
    'utf8',
  )
  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(remoteReadonlySource.includes("from './data/core.mjs'"), false)
  assert.equal(remoteReadonlySource.includes('listPeople({'), false)
  assert.equal(remoteReadonlySource.includes('listAssetFaces({'), false)
  assert.equal(remoteReadonlySource.includes('listRemoteReadonlyPeople'), false)
  assert.equal(remoteReadonlySource.includes('listRemoteReadonlyPersonFaces'), false)
  assert.equal(remoteReadonlySource.includes('resolveRemoteRoot'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/faces/list-people'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/faces/list-asset-faces'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/faces/crops/'), false)
  assert.equal(serverSource.includes('listRemoteReadonlyPeople'), false)
  assert.equal(serverSource.includes('listRemoteReadonlyPersonFaces'), false)
  assert.equal(serverSource.includes('readRuntimeFaceCrop'), false)
  assert.equal(serverSource.includes('sendRuntimeFileContentResponse'), false)
  assert.equal(serverSource.includes('resolveRemoteRoot'), false)
  assert.equal(serverSource.includes('ensureRemoteReadonlySessionAuthorized'), false)
})

test('Legacy Gateway no longer owns Remote Access shared state storage', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/remote-shared-state.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(new URL('../../tools/legacy-gateway/server.mjs', import.meta.url), 'utf8')
  assert.equal(serverSource.includes('createRemoteSharedFavoritesStore'), false)
  assert.equal(serverSource.includes('createRemotePublishedRootsStore'), false)
  assert.equal(serverSource.includes('remote-shared-state.mjs'), false)
})

test('Legacy Gateway no longer owns Remembered Device storage', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/remembered-devices.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(new URL('../../tools/legacy-gateway/server.mjs', import.meta.url), 'utf8')
  const remoteSessionsSource = await readFile(
    new URL('../../tools/legacy-gateway/remote-sessions.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(serverSource.includes('createRemoteRememberedDeviceStore'), false)
  assert.equal(serverSource.includes('remembered-devices.mjs'), false)
  assert.equal(remoteSessionsSource.includes('remembered-devices.mjs'), false)
  assert.equal(remoteSessionsSource.includes('DEFAULT_REMOTE_REMEMBER_DEVICE_TTL_MS'), false)
  assert.equal(remoteSessionsSource.includes('randomUUID'), false)
  assert.equal(remoteSessionsSource.includes('remoteSessions'), false)
  assert.equal(remoteSessionsSource.includes('loginAttempts'), false)
})

test('Legacy Gateway no longer owns Remote Access host config or token verification', async () => {
  const serverSource = await readFile(new URL('../../tools/legacy-gateway/server.mjs', import.meta.url), 'utf8')
  const remoteReadonlySource = await readFile(
    new URL('../../tools/legacy-gateway/remote-readonly.mjs', import.meta.url),
    'utf8',
  )
  const remoteSessionsSource = await readFile(
    new URL('../../tools/legacy-gateway/remote-sessions.mjs', import.meta.url),
    'utf8',
  )

  assert.equal(serverSource.includes('loadGlobalEnvFile'), false)
  assert.equal(serverSource.includes('readOptionalFileFingerprint'), false)
  assert.equal(remoteReadonlySource.includes('GLOBAL_REMOTE_ACCESS_CONFIG_PATH'), false)
  assert.equal(remoteReadonlySource.includes('PROJECT_REMOTE_ACCESS_CONFIG_PATH'), false)
  assert.equal(remoteReadonlySource.includes('mergeRemoteAccessConfig'), false)
  assert.equal(remoteReadonlySource.includes('timingSafeEqual'), false)
  assert.equal(remoteReadonlySource.includes('isTokenMatch'), false)
  assert.equal(remoteSessionsSource.includes('remoteConfig.token'), false)
  assert.equal(remoteReadonlySource.includes('readRuntimeRemoteAccessConfig'), true)
  assert.equal(remoteReadonlySource.includes('verifyRuntimeRemoteAccessToken'), false)
})

test('Legacy Gateway no longer bridges Remote Access Remembered Device credentials directly', async () => {
  const remoteFileAccessSource = await readFile(
    new URL('../../tools/legacy-gateway/remote-file-access.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(remoteFileAccessSource.includes('createRuntimeRememberedDevice'), false)
  assert.equal(remoteFileAccessSource.includes('rotateRuntimeRememberedDevice'), false)
  assert.equal(remoteFileAccessSource.includes('revokeRuntimeRememberedDevice'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/remote/remembered-devices/create'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/remote/remembered-devices/rotate'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/remote/remembered-devices/revoke'), false)
})

test('Legacy Gateway no longer owns local text preview file reads', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/data/files.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(new URL('../../tools/legacy-gateway/server.mjs', import.meta.url), 'utf8')
  assert.equal(serverSource.includes('readRemoteReadonlyTextPreview'), false)
  assert.equal(serverSource.includes('readRemoteReadonlyThumbnailContent'), false)
})

test('Legacy Gateway no longer resolves Remote Access file bytes with host paths', async () => {
  const remoteFileAccessSource = await readFile(
    new URL('../../tools/legacy-gateway/remote-file-access.mjs', import.meta.url),
    'utf8',
  )
  const remoteReadonlySource = await readFile(
    new URL('../../tools/legacy-gateway/remote-readonly.mjs', import.meta.url),
    'utf8',
  )
  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )

  assert.equal(remoteFileAccessSource.includes('parseRemoteByteRangeHeader'), false)
  assert.equal(remoteFileAccessSource.includes('readRuntimeFileContent'), false)
  assert.equal(remoteFileAccessSource.includes('readRuntimeFileThumbnail'), false)
  assert.equal(remoteFileAccessSource.includes('readRuntimeTextPreview'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/files/content'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/files/thumbnail'), false)
  assert.equal(remoteFileAccessSource.includes('/v1/files/text-preview'), false)
  assert.equal(remoteReadonlySource.includes('resolveRemoteReadonlyFileResource'), false)
  assert.equal(remoteReadonlySource.includes('resolveRemoteReadonlyThumbnailResource'), false)
  assert.equal(serverSource.includes('parseRemoteByteRangeHeader'), false)
  assert.equal(serverSource.includes('resolveRemoteReadonlyFileResource'), false)
  assert.equal(serverSource.includes('resolveRemoteReadonlyThumbnailResource'), false)
})

test('Legacy Gateway no longer keeps the old local data layer', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/data', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const remoteReadonlySource = await readFile(
    new URL('../../tools/legacy-gateway/remote-readonly.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(remoteReadonlySource.includes("from './data/"), false)
})

test('Legacy Gateway no longer keeps the old Runtime MCP route bridge', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/http-routes.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/runtime-mcp-bridge.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(serverSource.includes('createRuntimeMcpBridge'), false)
  assert.equal(serverSource.includes('findHttpGatewayRoute'), false)
  assert.equal(serverSource.includes('handleHttpGatewayRoute'), false)
  assert.equal(serverSource.includes('Runtime MCP bridge'), false)
})
