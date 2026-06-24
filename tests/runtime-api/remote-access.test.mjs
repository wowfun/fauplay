import assert from 'node:assert/strict'
import test from 'node:test'

import { createRemoteAccessClient } from '../../src/lib/remoteAccess.ts'
import { RuntimeHttpError } from '../../src/lib/runtimeApi/errors.ts'

test('Remote Access client normalizes capabilities, roots, and favorites', async () => {
  const calls = []
  const client = createRemoteAccessClient({
    sameOriginRequest: async (endpointPath, request) => {
      calls.push({ endpointPath, request })
      if (endpointPath === '/v1/remote/capabilities') {
        return { enabled: true, authMode: 'ignored', readOnly: false }
      }
      if (endpointPath === '/v1/remote/roots') {
        return {
          items: [
            { id: ' root-a ', label: ' Photos ' },
            { id: '', label: 'Missing id' },
            { id: 'missing-label', label: '' },
          ],
        }
      }
      if (endpointPath === '/v1/remote/favorites') {
        return {
          items: [
            { rootId: 'root-a', path: 'albums/2026', favoritedAtMs: '42' },
            { rootId: '', path: 'ignored', favoritedAtMs: 1 },
            { rootId: 'root-b', path: 'ignored', favoritedAtMs: Number.NaN },
          ],
        }
      }
      return {}
    },
  })

  assert.deepEqual(await client.loadCapabilities(), {
    enabled: true,
    authMode: 'session-cookie',
    loginMode: 'bearer-token-exchange',
    readOnly: true,
  })
  assert.deepEqual(await client.loadRoots(1234, { clearSessionOnUnauthorized: false }), [
    { id: 'root-a', label: 'Photos' },
  ])
  assert.deepEqual(await client.loadFavorites(), [
    { rootId: 'root-a', path: 'albums/2026', favoritedAtMs: 42 },
  ])
  assert.deepEqual(
    calls.map((call) => [call.endpointPath, call.request.method, call.request.timeoutMs]),
    [
      ['/v1/remote/capabilities', 'GET', 2000],
      ['/v1/remote/roots', 'GET', 1234],
      ['/v1/remote/favorites', 'GET', 2000],
    ],
  )
  assert.equal(calls[1].request.clearSessionOnUnauthorized, false)
})

test('Remote Access client exchanges bearer tokens for sessions', async () => {
  const calls = []
  const client = createRemoteAccessClient({
    sameOriginRequest: async (endpointPath, request) => {
      calls.push({ endpointPath, request })
      return {}
    },
  })

  await client.createSession(' token-1 ', {
    rememberDevice: true,
    rememberDeviceLabel: ' Studio Laptop ',
    timeoutMs: 3456,
  })
  await client.clearSession({ forgetDevice: true, timeoutMs: 4567 })

  assert.deepEqual(calls, [
    {
      endpointPath: '/v1/remote/session/login',
      request: {
        method: 'POST',
        body: {
          rememberDevice: true,
          rememberDeviceLabel: 'Studio Laptop',
        },
        timeoutMs: 3456,
        headers: {
          Authorization: 'Bearer token-1',
        },
        clearSessionOnUnauthorized: false,
      },
    },
    {
      endpointPath: '/v1/remote/session/logout',
      request: {
        method: 'POST',
        body: {
          forgetDevice: true,
        },
        timeoutMs: 4567,
        clearSessionOnUnauthorized: false,
      },
    },
  ])

  await assert.rejects(
    () => client.createSession('  '),
    (error) => {
      assert.ok(error instanceof RuntimeHttpError)
      assert.equal(error.code, 'REMOTE_TOKEN_REQUIRED')
      return true
    },
  )
})

test('Remote Access client manages remembered devices through local Runtime admin endpoints', async () => {
  const calls = []
  const client = createRemoteAccessClient({
    localRuntimeRequest: async (endpointPath, request) => {
      calls.push({ endpointPath, request })
      if (endpointPath === '/v1/admin/remembered-devices') {
        return {
          items: [
            {
              id: 'device-1',
              label: 'Studio',
              autoLabel: 'Chrome on Linux',
              userAgentSummary: 'Chrome',
              createdAtMs: '10',
              lastUsedAtMs: 20,
              expiresAtMs: 30,
            },
            {
              id: '',
              autoLabel: 'missing id',
              createdAtMs: 1,
              lastUsedAtMs: 2,
              expiresAtMs: 3,
            },
          ],
        }
      }
      return {}
    },
  })

  assert.deepEqual(await client.loadRememberedDevicesAdmin(), [
    {
      id: 'device-1',
      label: 'Studio',
      autoLabel: 'Chrome on Linux',
      userAgentSummary: 'Chrome',
      createdAtMs: 10,
      lastUsedAtMs: 20,
      expiresAtMs: 30,
    },
  ])
  await client.renameRememberedDeviceAdmin(' device-1 ', 'Desk')
  await client.revokeRememberedDeviceAdmin('device-1')
  await client.revokeAllRememberedDevicesAdmin()

  assert.deepEqual(
    calls.map((call) => [call.endpointPath, call.request.method, call.request.body]),
    [
      ['/v1/admin/remembered-devices', 'GET', {}],
      ['/v1/admin/remembered-devices/device-1', 'PATCH', { label: 'Desk' }],
      ['/v1/admin/remembered-devices/device-1', 'DELETE', {}],
      ['/v1/admin/remembered-devices/revoke-all', 'POST', {}],
    ],
  )

  await assert.rejects(
    () => client.revokeRememberedDeviceAdmin('  '),
    (error) => {
      assert.ok(error instanceof RuntimeHttpError)
      assert.equal(error.code, 'REMEMBERED_DEVICE_ID_REQUIRED')
      return true
    },
  )
})
