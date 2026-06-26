import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createRuntimeRemoteAccessConfig,
  handleRuntimeRemoteAccessHostRequest,
} from './remote-runtime-fixture.mjs'

test('Remote Access Listing is served through Fauplay Runtime', async () => {
  const previousHome = process.env.HOME
  const previousToken = process.env.FAUPLAY_REMOTE_ACCESS_TOKEN
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fauplay-remote-list-runtime-proxy-'))
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
      if (await handleRuntimeRemoteAccessHostRequest(req, res, {
        config: createRuntimeRemoteAccessConfig({ rootPath: remoteRoot }),
      })) {
        return
      }

      const body = await readRequestBody(req)
      runtimeRequests.push({
        method: req.method,
        url: req.url,
        body,
      })
      if (req.method === 'POST' && req.url === '/v1/remote/files/list') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          ok: true,
          rootId: 'root-a',
          path: 'albums',
          flattenView: true,
          items: [
            {
              name: 'runtime-only.jpg',
              path: 'albums/runtime-only.jpg',
              kind: 'file',
              size: 12,
              lastModifiedMs: 1767225600000,
              mimeType: 'image/jpeg',
              previewKind: 'image',
              displayPath: 'albums/runtime-only.jpg',
            },
            {
              name: 'nested',
              path: 'albums/nested',
              kind: 'directory',
              isEmpty: false,
              entryCount: 2,
              displayPath: 'albums/nested',
            },
          ],
          isTruncated: true,
          nextOffset: 2,
        }))
        return
      }

      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
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

    const response = await fetch(`${gatewayAddress}/v1/remote/files/list`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rootId: 'root-a',
        path: 'albums',
        flattenView: true,
      }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      ok: true,
      rootId: 'root-a',
      path: 'albums',
      flattenView: true,
      items: [
        {
          name: 'runtime-only.jpg',
          path: 'albums/runtime-only.jpg',
          kind: 'file',
          size: 12,
          lastModifiedMs: 1767225600000,
          mimeType: 'image/jpeg',
          previewKind: 'image',
          displayPath: 'albums/runtime-only.jpg',
        },
        {
          name: 'nested',
          path: 'albums/nested',
          kind: 'directory',
          isEmpty: false,
          entryCount: 2,
          displayPath: 'albums/nested',
        },
      ],
      isTruncated: true,
      nextOffset: 2,
    })
    assert.equal(runtimeRequests.length, 1)
    assert.equal(runtimeRequests[0].method, 'POST')
    const runtimeRequestUrl = new URL(runtimeRequests[0].url, runtimeAddress)
    assert.equal(runtimeRequestUrl.pathname, '/v1/remote/files/list')
    assert.deepEqual(JSON.parse(runtimeRequests[0].body), {
      rootId: 'root-a',
      path: 'albums',
      flattenView: true,
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

async function readRequestBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  return body
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
