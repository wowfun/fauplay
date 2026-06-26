import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MCP_SESSION_HEADER,
  createRuntimeMcpClient,
} from '../../src/lib/runtimeApi/mcpClient.ts'
import { RuntimeMcpError } from '../../src/lib/runtimeApi/errors.ts'

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: init.headers,
  })
}

test('Runtime MCP client initializes once and reuses the session header for tool calls', async () => {
  const requests = []
  const client = createRuntimeMcpClient({
    buildEndpointUrl: () => 'http://127.0.0.1:3211/v1/mcp',
    createRequestId: () => 7,
    fetch: async (_url, init) => {
      const headers = init.headers ?? {}
      const payload = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      requests.push({ headers, payload })

      if (payload.method === 'initialize') {
        return jsonResponse(
          {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              protocolVersion: '2025-11-05',
              capabilities: {},
              serverInfo: { name: 'fauplay-runtime', version: '0.0.1' },
            },
          },
          { headers: { [MCP_SESSION_HEADER]: 'session-1' } },
        )
      }

      if (payload.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }

      return jsonResponse({
        jsonrpc: '2.0',
        id: payload.id,
        result: { tools: [{ name: 'local.data', title: 'Local data' }] },
      })
    },
  })

  const result = await client.call('tools/list', {}, 2000)

  assert.deepEqual(result, { tools: [{ name: 'local.data', title: 'Local data' }] })
  assert.deepEqual(
    requests.map((request) => request.payload.method),
    ['initialize', 'notifications/initialized', 'tools/list'],
  )
  assert.equal(requests[0].headers[MCP_SESSION_HEADER], undefined)
  assert.equal(requests[1].headers[MCP_SESSION_HEADER], 'session-1')
  assert.equal(requests[2].headers[MCP_SESSION_HEADER], 'session-1')

  await client.call('tools/list', {}, 2000)
  assert.deepEqual(
    requests.map((request) => request.payload.method),
    ['initialize', 'notifications/initialized', 'tools/list', 'tools/list'],
  )
})

test('Runtime MCP client resets session state after initialization failure', async () => {
  const methods = []
  let initializeAttempts = 0
  const client = createRuntimeMcpClient({
    buildEndpointUrl: () => 'http://127.0.0.1:3211/v1/mcp',
    fetch: async (_url, init) => {
      const payload = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      methods.push(payload.method)

      if (payload.method === 'initialize') {
        initializeAttempts += 1
        return initializeAttempts === 1
          ? jsonResponse({ jsonrpc: '2.0', id: payload.id, result: {} })
          : jsonResponse(
            { jsonrpc: '2.0', id: payload.id, result: { capabilities: {} } },
            { headers: { [MCP_SESSION_HEADER]: 'session-2' } },
          )
      }

      if (payload.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }

      return jsonResponse({ jsonrpc: '2.0', id: payload.id, result: { ok: true } })
    },
  })

  await assert.rejects(
    () => client.call('tools/list', {}, 2000),
    /Missing mcp-session-id in initialize response/,
  )

  await client.call('tools/list', {}, 2000)
  assert.deepEqual(methods, [
    'initialize',
    'initialize',
    'notifications/initialized',
    'tools/list',
  ])
})

test('Runtime MCP client maps JSON-RPC errors to Runtime MCP errors', async () => {
  const client = createRuntimeMcpClient({
    buildEndpointUrl: () => 'http://127.0.0.1:3211/v1/mcp',
    fetch: async (_url, init) => {
      const payload = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      return jsonResponse({
        jsonrpc: '2.0',
        id: payload.id,
        error: {
          code: -32601,
          message: 'Missing method',
          data: { code: 'MCP_METHOD_NOT_FOUND' },
        },
      })
    },
  })

  await assert.rejects(
    () => client.call('initialize', {}, 2000),
    (error) => {
      assert.ok(error instanceof RuntimeMcpError)
      assert.equal(error.name, 'RuntimeMcpError')
      assert.equal(error.message, 'Missing method')
      assert.equal(error.code, 'MCP_METHOD_NOT_FOUND')
      return true
    },
  )
})
