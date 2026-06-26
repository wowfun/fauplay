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

test('Remote Access Annotation Tags are served through Fauplay Runtime', async () => {
  const previousHome = process.env.HOME
  const previousToken = process.env.FAUPLAY_REMOTE_ACCESS_TOKEN
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fauplay-remote-tags-runtime-proxy-'))
  const remoteRoot = path.join(tempDir, 'remote-root')
  const testHome = path.join(tempDir, 'home')
  const globalConfigDir = path.join(testHome, '.fauplay', 'global')
  const runtimeRequests = []
  const tagRecord = {
    key: 'rating',
    value: '5',
    source: 'meta.annotation',
    appliedAt: 20,
    updatedAt: 20,
  }
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
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')

      if (req.url === '/v1/data/tags/options') {
        res.end(JSON.stringify({
          ok: true,
          items: [{
            tagKey: 'rating=5',
            key: 'rating',
            value: '5',
            source: 'meta.annotation',
            fileCount: 1,
          }],
        }))
        return
      }

      if (req.url === '/v1/data/tags/query') {
        res.end(JSON.stringify({
          ok: true,
          page: 1,
          size: 1000,
          total: 1,
          items: [{
            assetId: 'asset-1',
            absolutePath: path.join(remoteRoot, 'albums/photo.jpg'),
            relativePath: 'albums/photo.jpg',
            rootRelativePath: 'albums/photo.jpg',
            tags: [tagRecord],
            updatedAt: 20,
          }],
        }))
        return
      }

      if (req.url === '/v1/data/tags/file') {
        res.end(JSON.stringify({
          ok: true,
          file: {
            assetId: 'asset-1',
            absolutePath: path.join(remoteRoot, 'albums/photo.jpg'),
            relativePath: 'albums/photo.jpg',
            rootRelativePath: 'albums/photo.jpg',
            tags: [tagRecord],
          },
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

    const optionsResponse = await postRemoteJson(gatewayAddress, sessionCookie, '/v1/remote/tags/options', {
      rootId: 'root-a',
    })
    assert.deepEqual(optionsResponse, {
      ok: true,
      items: [{
        tagKey: 'rating=5',
        key: 'rating',
        value: '5',
        source: 'meta.annotation',
        fileCount: 1,
      }],
    })

    const queryResponse = await postRemoteJson(gatewayAddress, sessionCookie, '/v1/remote/tags/query', {
      rootId: 'root-a',
      includeTagKeys: ['rating=5'],
      includeMatchMode: 'and',
      page: 1,
      size: 1000,
    })
    assert.deepEqual(queryResponse, {
      ok: true,
      page: 1,
      size: 1000,
      total: 1,
      items: [{
        assetId: 'asset-1',
        relativePath: 'albums/photo.jpg',
        tags: [tagRecord],
        updatedAt: 20,
      }],
    })

    const fileResponse = await postRemoteJson(gatewayAddress, sessionCookie, '/v1/remote/tags/file', {
      rootId: 'root-a',
      relativePath: 'albums/photo.jpg',
    })
    assert.deepEqual(fileResponse, {
      ok: true,
      file: {
        assetId: 'asset-1',
        relativePath: 'albums/photo.jpg',
        tags: [tagRecord],
      },
    })

    assert.equal(JSON.stringify(queryResponse).includes(remoteRoot), false)
    assert.equal(JSON.stringify(fileResponse).includes(remoteRoot), false)
    assert.deepEqual(runtimeRequests.map((request) => ({
      method: request.method,
      url: request.url,
      body: JSON.parse(request.body),
    })), [
      {
        method: 'POST',
        url: '/v1/data/tags/options',
        body: { rootPath: remoteRoot },
      },
      {
        method: 'POST',
        url: '/v1/data/tags/query',
        body: {
          rootPath: remoteRoot,
          includeTagKeys: ['rating=5'],
          includeMatchMode: 'and',
          page: 1,
          size: 1000,
        },
      },
      {
        method: 'POST',
        url: '/v1/data/tags/file',
        body: {
          rootPath: remoteRoot,
          relativePath: 'albums/photo.jpg',
        },
      },
    ])
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
