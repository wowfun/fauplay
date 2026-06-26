import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRuntimePluginCapabilityClient,
} from '../../src/lib/runtimeApi/pluginCapabilities.ts'
import { MCP_SESSION_HEADER } from '../../src/lib/runtimeApi/mcpClient.ts'

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: init.headers,
  })
}

test('Runtime plugin capability client lists normalized tools when the Runtime is healthy', async () => {
  const requests = []
  const client = createRuntimePluginCapabilityClient({
    buildRuntimeUrl: (endpointPath) => `http://127.0.0.1:3211${endpointPath}`,
    createRequestId: () => 11,
    fetch: async (url, init) => {
      const method = init.method ?? 'GET'
      const payload = typeof init.body === 'string' ? JSON.parse(init.body) : null
      requests.push({ url, method, payload })

      if (url.endsWith('/v1/health')) {
        return jsonResponse({ status: 'ok' })
      }

      if (payload?.method === 'initialize') {
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
          { headers: { [MCP_SESSION_HEADER]: 'session-plugins' } },
        )
      }

      if (payload?.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }

      return jsonResponse({
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          tools: [
            {
              name: 'media.searchSameDurationVideos',
              annotations: {
                title: 'Same duration videos',
                mutation: false,
                scopes: ['workspace'],
              },
            },
          ],
        },
      })
    },
  })

  const snapshot = await client.loadCapabilities()

  assert.equal(snapshot.online, true)
  assert.deepEqual(snapshot.tools, [
    {
      name: 'media.searchSameDurationVideos',
      title: 'Same duration videos',
      mutation: false,
      scopes: ['workspace'],
      toolOptions: [],
      toolActions: [],
    },
  ])
  assert.deepEqual(
    requests.map((request) => [request.method, request.payload?.method ?? request.url]),
    [
      ['GET', 'http://127.0.0.1:3211/v1/health'],
      ['POST', 'initialize'],
      ['POST', 'notifications/initialized'],
      ['POST', 'tools/list'],
    ],
  )
})

test('Runtime plugin capability client resets the MCP session when Runtime health is unavailable', async () => {
  const mcpMethods = []
  let healthStatus = 'ok'
  let initializeCount = 0
  const client = createRuntimePluginCapabilityClient({
    buildRuntimeUrl: (endpointPath) => `http://127.0.0.1:3211${endpointPath}`,
    fetch: async (url, init) => {
      const payload = typeof init.body === 'string' ? JSON.parse(init.body) : null

      if (url.endsWith('/v1/health')) {
        return jsonResponse({ status: healthStatus })
      }

      mcpMethods.push(payload.method)
      if (payload.method === 'initialize') {
        initializeCount += 1
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
          { headers: { [MCP_SESSION_HEADER]: `session-${initializeCount}` } },
        )
      }

      if (payload.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }

      return jsonResponse({
        jsonrpc: '2.0',
        id: payload.id,
        result: { tools: [{ name: 'local.data' }] },
      })
    },
  })

  assert.equal((await client.loadCapabilities()).online, true)
  healthStatus = 'starting'
  assert.deepEqual(await client.loadCapabilities(), { online: false, tools: [] })
  await client.listTools()

  assert.deepEqual(mcpMethods, [
    'initialize',
    'notifications/initialized',
    'tools/list',
    'initialize',
    'notifications/initialized',
    'tools/list',
  ])
})
