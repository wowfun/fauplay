import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('Remote Access Favorite Folders are served through Fauplay Runtime', async () => {
  const previousHome = process.env.HOME
  const previousToken = process.env.FAUPLAY_REMOTE_ACCESS_TOKEN
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fauplay-remote-favorites-runtime-proxy-'))
  const remoteRoot = path.join(tempDir, 'remote-root')
  const testHome = path.join(tempDir, 'home')
  const globalConfigDir = path.join(testHome, '.fauplay', 'global')
  const runtimeRequests = []
  let runtimeServer = null
  let gatewayServer = null

  try {
    await mkdir(remoteRoot, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })
    await writeFile(
      path.join(globalConfigDir, 'remote-access.json'),
      JSON.stringify({
        enabled: true,
        rootSource: 'manual',
        roots: [
          {
            id: 'root-a',
            label: 'Root A',
            path: remoteRoot,
          },
        ],
      }),
    )

    process.env.HOME = testHome
    process.env.FAUPLAY_REMOTE_ACCESS_TOKEN = 'secret-token'

    runtimeServer = http.createServer(async (req, res) => {
      const body = await readRequestBody(req)
      runtimeRequests.push({
        method: req.method,
        url: req.url,
        body,
      })
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')

      if (req.method === 'GET' && req.url === '/v1/remote/shared-favorites') {
        res.end(JSON.stringify({
          ok: true,
          items: [
            {
              rootId: 'root-a',
              path: 'albums/runtime',
              favoritedAtMs: 100,
            },
            {
              rootId: 'stale-root',
              path: 'stale',
              favoritedAtMs: 200,
            },
          ],
        }))
        return
      }

      if (req.method === 'POST' && req.url === '/v1/remote/shared-favorites/upsert') {
        res.end(JSON.stringify({
          ok: true,
          item: {
            rootId: 'root-a',
            path: 'albums/new',
            favoritedAtMs: 456,
          },
        }))
        return
      }

      if (req.method === 'POST' && req.url === '/v1/remote/shared-favorites/remove') {
        res.end(JSON.stringify({
          ok: true,
          removed: true,
        }))
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ ok: false, error: 'unexpected Runtime path' }))
    })
    await listen(runtimeServer, 0)
    const runtimeAddress = serverAddress(runtimeServer)

    const gatewayPort = await reservePort()
    const { startGatewayServer } = await import('../../tools/legacy-gateway/server.mjs')
    gatewayServer = await startGatewayServer({
      host: '127.0.0.1',
      port: gatewayPort,
      runtimeBaseUrl: runtimeAddress,
    })
    if (!gatewayServer.listening) {
      await once(gatewayServer, 'listening')
    }
    const gatewayAddress = `http://127.0.0.1:${gatewayPort}`
    const sessionCookie = await loginRemoteSession(gatewayAddress)

    const listResponse = await getRemoteJson(gatewayAddress, sessionCookie, '/v1/remote/favorites')
    assert.deepEqual(listResponse, {
      ok: true,
      items: [{
        rootId: 'root-a',
        path: 'albums/runtime',
        favoritedAtMs: 100,
      }],
    })

    const upsertResponse = await postRemoteJson(gatewayAddress, sessionCookie, '/v1/remote/favorites/upsert', {
      rootId: 'root-a',
      path: 'albums/new',
    })
    assert.deepEqual(upsertResponse, {
      ok: true,
      item: {
        rootId: 'root-a',
        path: 'albums/new',
        favoritedAtMs: 456,
      },
    })

    const removeResponse = await postRemoteJson(gatewayAddress, sessionCookie, '/v1/remote/favorites/remove', {
      rootId: 'root-a',
      path: 'albums/runtime',
    })
    assert.deepEqual(removeResponse, { ok: true })

    const observedRequests = runtimeRequests.map((request) => ({
      method: request.method,
      url: request.url,
      body: request.body ? JSON.parse(request.body) : null,
    }))
    assert.equal(observedRequests.length, 3)
    assert.deepEqual(observedRequests[0], {
      method: 'GET',
      url: '/v1/remote/shared-favorites',
      body: null,
    })
    assert.equal(observedRequests[1].method, 'POST')
    assert.equal(observedRequests[1].url, '/v1/remote/shared-favorites/upsert')
    assert.equal(observedRequests[1].body.rootId, 'root-a')
    assert.equal(observedRequests[1].body.path, 'albums/new')
    assert.equal(typeof observedRequests[1].body.favoritedAtMs, 'number')
    assert.deepEqual(observedRequests[2], {
      method: 'POST',
      url: '/v1/remote/shared-favorites/remove',
      body: {
        rootId: 'root-a',
        path: 'albums/runtime',
      },
    })
  } finally {
    if (gatewayServer) await closeServer(gatewayServer)
    if (runtimeServer) await closeServer(runtimeServer)
    if (typeof previousHome === 'string') {
      process.env.HOME = previousHome
    } else {
      delete process.env.HOME
    }
    if (typeof previousToken === 'string') {
      process.env.FAUPLAY_REMOTE_ACCESS_TOKEN = previousToken
    } else {
      delete process.env.FAUPLAY_REMOTE_ACCESS_TOKEN
    }
    await rm(tempDir, { recursive: true, force: true })
  }
})

async function getRemoteJson(gatewayAddress, sessionCookie, endpointPath) {
  const response = await fetch(`${gatewayAddress}${endpointPath}`, {
    method: 'GET',
    headers: {
      Cookie: sessionCookie,
    },
  })
  assert.equal(response.status, 200)
  return response.json()
}

async function postRemoteJson(gatewayAddress, sessionCookie, endpointPath, body) {
  const response = await fetch(`${gatewayAddress}${endpointPath}`, {
    method: 'POST',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200)
  return response.json()
}

async function loginRemoteSession(gatewayAddress) {
  const loginResponse = await fetch(`${gatewayAddress}/v1/remote/session/login`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer secret-token',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  assert.equal(loginResponse.status, 204)
  const rawSetCookie = typeof loginResponse.headers.getSetCookie === 'function'
    ? loginResponse.headers.getSetCookie().join(',')
    : (loginResponse.headers.get('set-cookie') ?? '')
  const sessionCookie = rawSetCookie
    .split(/,\s*(?=__Host-fauplay-remote-)/)
    .map((item) => item.split(';')[0])
    .find((item) => item.startsWith('__Host-fauplay-remote-session='))
    ?? ''
  assert.match(sessionCookie, /^__Host-fauplay-remote-session=/)
  return sessionCookie
}

async function readRequestBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  return body
}

async function reservePort() {
  const server = http.createServer()
  await listen(server, 0)
  const { port } = server.address()
  await closeServer(server)
  return port
}

async function listen(server, port) {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
}

function serverAddress(server) {
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
