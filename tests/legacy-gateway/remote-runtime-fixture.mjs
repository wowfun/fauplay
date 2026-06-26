export function createRuntimeRemoteAccessConfig({
  rootPath,
  rootId = 'root-a',
  label = 'Root A',
  rootSource = 'manual',
  fingerprint = 'test-remote-access-config-v1',
} = {}) {
  if (typeof rootPath !== 'string' || !rootPath) {
    throw new Error('rootPath is required')
  }

  return {
    enabled: true,
    configured: true,
    authConfigured: true,
    rootSource,
    roots: [{
      id: rootId,
      label,
      path: rootPath,
      realPath: rootPath,
    }],
    configSources: [
      {
        label: 'default',
        path: 'src/config/remote-access.json',
        loaded: true,
      },
      {
        label: 'global',
        path: 'test-home/.fauplay/global/remote-access.json',
        loaded: true,
      },
      {
        label: 'global-env',
        path: 'test-home/.fauplay/global/.env',
        loaded: true,
      },
    ],
    fingerprint,
  }
}

export async function handleRuntimeRemoteAccessHostRequest(req, res, {
  config,
  expectedToken = 'secret-token',
} = {}) {
  if (req.method === 'GET' && req.url === '/v1/remote/access/config') {
    sendJson(res, 200, config)
    return true
  }

  if (req.method === 'POST' && req.url === '/v1/remote/access/authorize') {
    const body = await readRequestBody(req)
    let payload = {}
    try {
      payload = body ? JSON.parse(body) : {}
    } catch {
      sendJson(res, 400, {
        ok: false,
        error: 'Invalid JSON',
        code: 'REMOTE_INVALID_PARAMS',
      })
      return true
    }

    if (payload?.bearerToken === expectedToken) {
      sendJson(res, 200, { ok: true })
      return true
    }

    sendJson(res, 401, {
      ok: false,
      error: 'Unauthorized',
      code: 'REMOTE_UNAUTHORIZED',
    })
    return true
  }

  return false
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

async function readRequestBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  return body
}
