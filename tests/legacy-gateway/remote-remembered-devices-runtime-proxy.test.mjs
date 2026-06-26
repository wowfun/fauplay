import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('Remote Access Remembered Devices are served through Fauplay Runtime', async () => {
  const previousHome = process.env.HOME
  const previousToken = process.env.FAUPLAY_REMOTE_ACCESS_TOKEN
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fauplay-remote-remembered-runtime-proxy-'))
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
      res.setHeader('Content-Type', 'application/json')

      if (req.method === 'POST' && req.url === '/v1/remote/remembered-devices/create') {
        res.statusCode = 200
        res.end(JSON.stringify({
          ok: true,
          device: {
            id: 'runtime-device-a',
            cookieValue: 'runtime-device-a.secret-create',
            label: 'Desk Device',
            autoLabel: 'Chrome · Linux',
            userAgentSummary: 'Linux · Chrome',
            expiresAtMs: 4102444800000,
          },
        }))
        return
      }

      if (req.method === 'POST' && req.url === '/v1/remote/remembered-devices/rotate') {
        res.statusCode = 200
        res.end(JSON.stringify({
          ok: true,
          device: {
            id: 'runtime-device-a',
            cookieValue: 'runtime-device-a.secret-rotate',
            label: 'Desk Device',
            autoLabel: 'Chrome · Linux',
            userAgentSummary: 'Linux · Chrome',
            expiresAtMs: 4102444800000,
          },
        }))
        return
      }

      if (req.method === 'POST' && req.url === '/v1/remote/remembered-devices/revoke') {
        res.statusCode = 200
        res.end(JSON.stringify({
          ok: true,
          revokedDeviceIds: ['runtime-device-a'],
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

    const loginResponse = await fetch(`${gatewayAddress}/v1/remote/session/login`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
        'User-Agent': 'FauplayTest Chrome/126 Linux',
      },
      body: JSON.stringify({
        rememberDevice: true,
        rememberDeviceLabel: ' Desk   Device ',
      }),
    })
    assert.equal(loginResponse.status, 204)
    const loginCookies = responseCookies(loginResponse)
    const rememberCookie = findCookie(loginCookies, '__Host-fauplay-remote-remember-device')
    assert.equal(
      rememberCookie,
      '__Host-fauplay-remote-remember-device=runtime-device-a.secret-create',
    )

    const rootsResponse = await fetch(`${gatewayAddress}/v1/remote/roots`, {
      headers: {
        Cookie: rememberCookie,
      },
    })
    assert.equal(rootsResponse.status, 200)
    assert.deepEqual(await rootsResponse.json(), {
      ok: true,
      items: [{ id: 'root-a', label: 'Root A' }],
    })
    const rotatedCookies = responseCookies(rootsResponse)
    const rotatedRememberCookie = findCookie(rotatedCookies, '__Host-fauplay-remote-remember-device')
    const rotatedSessionCookie = findCookie(rotatedCookies, '__Host-fauplay-remote-session')
    assert.equal(
      rotatedRememberCookie,
      '__Host-fauplay-remote-remember-device=runtime-device-a.secret-rotate',
    )
    assert.match(rotatedSessionCookie, /^__Host-fauplay-remote-session=/)

    const logoutResponse = await fetch(`${gatewayAddress}/v1/remote/session/logout`, {
      method: 'POST',
      headers: {
        Cookie: `${rotatedSessionCookie}; ${rotatedRememberCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ forgetDevice: true }),
    })
    assert.equal(logoutResponse.status, 200)

    const rememberedRequests = runtimeRequests
      .filter((request) => request.url.startsWith('/v1/remote/remembered-devices/'))
      .map((request) => ({
        method: request.method,
        url: request.url,
        body: request.body ? JSON.parse(request.body) : null,
      }))
    assert.deepEqual(rememberedRequests, [
      {
        method: 'POST',
        url: '/v1/remote/remembered-devices/create',
        body: {
          label: 'Desk Device',
          userAgent: 'FauplayTest Chrome/126 Linux',
        },
      },
      {
        method: 'POST',
        url: '/v1/remote/remembered-devices/rotate',
        body: {
          cookieValue: 'runtime-device-a.secret-create',
        },
      },
      {
        method: 'POST',
        url: '/v1/remote/remembered-devices/revoke',
        body: {
          cookieValue: 'runtime-device-a.secret-rotate',
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

function responseCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie()
  }
  const raw = response.headers.get('set-cookie') ?? ''
  return raw.split(/,\s*(?=__Host-fauplay-remote-)/).filter(Boolean)
}

function findCookie(cookies, name) {
  return cookies
    .map((item) => item.split(';')[0])
    .find((item) => item.startsWith(`${name}=`))
    ?? ''
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
