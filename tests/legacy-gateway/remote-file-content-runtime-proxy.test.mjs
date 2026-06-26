import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import test from 'node:test'

test('Remote Access file content is served through Fauplay Runtime', async () => {
  const previousHome = process.env.HOME
  const previousToken = process.env.FAUPLAY_REMOTE_ACCESS_TOKEN
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fauplay-remote-runtime-proxy-'))
  const remoteRoot = path.join(tempDir, 'remote-root')
  const testHome = path.join(tempDir, 'home')
  const globalConfigDir = path.join(testHome, '.fauplay', 'global')
  const runtimeRequests = []
  let runtimeServer = null
  let gatewayServer = null

  try {
    await mkdir(remoteRoot, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })
    await writeFile(path.join(remoteRoot, 'sample.txt'), 'abcdef', 'utf8')
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

    runtimeServer = http.createServer((req, res) => {
      runtimeRequests.push({
        url: req.url,
        range: req.headers.range,
      })
      res.statusCode = 206
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Content-Range', 'bytes 1-3/6')
      res.setHeader('Content-Length', '3')
      res.end('XYZ')
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

    const response = await fetch(`${gatewayAddress}/v1/remote/files/content?rootId=root-a&relativePath=sample.txt`, {
      headers: {
        Cookie: sessionCookie,
        Range: 'bytes=1-3',
      },
    })

    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), 'bytes 1-3/6')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(await response.text(), 'XYZ')
    assert.equal(runtimeRequests.length, 1)
    assert.equal(runtimeRequests[0].range, 'bytes=1-3')
    const runtimeRequestUrl = new URL(runtimeRequests[0].url, runtimeAddress)
    assert.equal(runtimeRequestUrl.pathname, '/v1/files/content')
    assert.equal(runtimeRequestUrl.searchParams.get('absolutePath'), path.join(remoteRoot, 'sample.txt'))

    const invalidRangeResponse = await fetch(`${gatewayAddress}/v1/remote/files/content?rootId=root-a&relativePath=sample.txt`, {
      headers: {
        Cookie: sessionCookie,
        Range: 'bytes=99-100',
      },
    })
    assert.equal(invalidRangeResponse.status, 416)
    assert.equal(invalidRangeResponse.headers.get('content-range'), 'bytes */6')
    assert.equal(await invalidRangeResponse.text(), '')
    assert.equal(runtimeRequests.length, 1)
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
