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
  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(serverSource.includes("pathname.startsWith('/v1/faces/crops/')"), false)
  assert.equal(serverSource.includes("pathname.slice('/v1/faces/crops/'.length)"), false)
  assert.equal(serverSource.includes('getFaceCrop'), false)
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
