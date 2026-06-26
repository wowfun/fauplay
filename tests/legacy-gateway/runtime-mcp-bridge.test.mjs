import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRuntimeMcpBridge,
  resolveRuntimeMcpBaseUrl,
} from '../../tools/legacy-gateway/runtime-mcp-bridge.mjs'

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: init.headers,
  })
}

test('Runtime MCP bridge initializes once and calls tools through Fauplay Runtime', async () => {
  const requests = []
  const bridge = createRuntimeMcpBridge({
    baseUrl: 'http://127.0.0.1:3211/',
    callTimeoutMs: 2000,
    initTimeoutMs: 2000,
    fetch: async (url, init) => {
      const payload = JSON.parse(init.body)
      requests.push({
        url,
        headers: init.headers,
        payload,
      })

      if (payload.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            protocolVersion: '2025-11-05',
            capabilities: {},
            serverInfo: { name: 'fauplay-runtime', version: '0.0.0' },
          },
        }, {
          headers: { 'mcp-session-id': 'runtime-session-1' },
        })
      }

      if (payload.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }

      return jsonResponse({
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          detected: 1,
          faces: [{ faceId: 'face-1' }],
        },
      })
    },
  })

  assert.deepEqual(
    await bridge.callTool(' vision.face ', { operation: 'detectAsset' }),
    {
      detected: 1,
      faces: [{ faceId: 'face-1' }],
    },
  )
  assert.deepEqual(
    await bridge.callTool('vision.face', { operation: 'detectAsset' }),
    {
      detected: 1,
      faces: [{ faceId: 'face-1' }],
    },
  )

  assert.deepEqual(
    requests.map((request) => request.payload.method),
    ['initialize', 'notifications/initialized', 'tools/call', 'tools/call'],
  )
  assert.equal(requests[0].url, 'http://127.0.0.1:3211/v1/mcp')
  assert.equal(requests[0].headers['mcp-session-id'], undefined)
  assert.equal(requests[1].headers['mcp-session-id'], 'runtime-session-1')
  assert.equal(requests[2].headers['mcp-session-id'], 'runtime-session-1')
  assert.equal(requests[2].payload.params.name, 'vision.face')
  assert.deepEqual(requests[2].payload.params.arguments, { operation: 'detectAsset' })
})

test('Runtime MCP bridge maps Runtime JSON-RPC errors to legacy HTTP errors', async () => {
  const bridge = createRuntimeMcpBridge({
    baseUrl: 'http://127.0.0.1:3211',
    fetch: async (_url, init) => {
      const payload = JSON.parse(init.body)
      if (payload.method === 'initialize') {
        return jsonResponse({ jsonrpc: '2.0', id: payload.id, result: {} }, {
          headers: { 'mcp-session-id': 'runtime-session-2' },
        })
      }
      if (payload.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }
      return jsonResponse({
        jsonrpc: '2.0',
        id: payload.id,
        error: {
          code: -32000,
          message: 'Unknown tool: missing.tool',
          data: { code: 'MCP_TOOL_NOT_FOUND' },
        },
      })
    },
  })

  await assert.rejects(
    () => bridge.callTool('missing.tool', {}),
    (error) => {
      assert.equal(error.code, 'MCP_TOOL_NOT_FOUND')
      assert.equal(error.statusCode, 404)
      assert.equal(error.message, 'Unknown tool: missing.tool')
      return true
    },
  )
})

test('Runtime MCP bridge resolves the Fauplay Runtime base URL from environment', () => {
  assert.equal(
    resolveRuntimeMcpBaseUrl({
      FAUPLAY_RUNTIME_BASE_URL: ' http://127.0.0.1:4311/ ',
      VITE_FAUPLAY_RUNTIME_BASE_URL: 'http://ignored.example',
    }),
    'http://127.0.0.1:4311',
  )
  assert.equal(
    resolveRuntimeMcpBaseUrl({
      VITE_FAUPLAY_RUNTIME_BASE_URL: ' http://127.0.0.1:5311/ ',
    }),
    'http://127.0.0.1:5311',
  )
})
