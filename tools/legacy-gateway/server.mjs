import http from 'node:http'
import { createMcpRuntimeError } from './runtime-errors.mjs'
import {
  appendRemoteRuntimeSetCookies,
  forwardRemoteReadonlyFavoriteRemove,
  forwardRemoteReadonlyFavorites,
  forwardRemoteReadonlyFavoriteUpsert,
  forwardRemoteReadonlyFaceCrop,
  forwardRemoteReadonlyFacePeople,
  forwardRemoteReadonlyFileContent,
  forwardRemoteReadonlyFileList,
  forwardRemoteReadonlyFileThumbnail,
  forwardRemoteReadonlyPersonFaces,
  forwardRemoteReadonlyRoots,
  forwardRemoteReadonlySessionLogin,
  forwardRemoteReadonlySessionLogout,
  forwardRemoteReadonlyTagFile,
  forwardRemoteReadonlyTagOptions,
  forwardRemoteReadonlyTagQuery,
  forwardRemoteReadonlyTextPreview,
} from './remote-sessions.mjs'
import {
  formatRemoteAccessConfigSourceLog,
  getRemoteReadonlyCapabilities,
  loadRemoteReadonlyConfig,
} from './remote-readonly.mjs'

const DEFAULT_PORT = Number(process.env.FAUPLAY_GATEWAY_PORT || 3210)
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_RUNTIME_BASE_URL = 'http://127.0.0.1:3211'
const GATEWAY_VERSION = '0.2.0'

function resolveRuntimeBaseUrl(env = process.env) {
  const raw = (
    env.FAUPLAY_RUNTIME_BASE_URL
    || env.VITE_FAUPLAY_RUNTIME_BASE_URL
    || ''
  )
  const normalized = typeof raw === 'string' ? raw.trim() : ''
  return (normalized || DEFAULT_RUNTIME_BASE_URL).replace(/\/+$/, '')
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    throw createMcpRuntimeError('MCP_PARSE_ERROR', 'Request body must be valid JSON', 400)
  }
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

async function sendRemoteReadonlyError(res, error) {
  const statusCode = resolveErrorStatusCode(error)
  appendRemoteRuntimeSetCookies(res, Array.isArray(error?.setCookies) ? error.setCookies : [])
  sendJson(res, statusCode, toHttpErrorBody(error))
}

function resolveErrorStatusCode(error) {
  const explicit = Number(error?.statusCode)
  if (Number.isInteger(explicit) && explicit >= 100 && explicit <= 599) {
    return explicit
  }

  if (error?.code === 'SQLITE_CONSTRAINT') return 409
  if (error?.code === 'MCP_TOOL_NOT_FOUND') return 404
  if (error?.code === 'MCP_INVALID_PARAMS') return 400
  if (error?.code === 'MCP_SERVER_TIMEOUT') return 504
  if (error?.code === 'MCP_SERVER_CRASHED') return 502

  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  if (message.includes('required') || message.includes('invalid') || message.includes('must')) return 400
  if (message.includes('not found')) return 404
  return 500
}

function toHttpErrorBody(error) {
  const message = error instanceof Error ? error.message : 'Gateway request failed'
  const code = typeof error?.code === 'string' ? error.code : 'GATEWAY_HTTP_ERROR'
  return {
    ok: false,
    error: message,
    code,
  }
}

export async function startGatewayServer(options = {}) {
  const host = options.host || DEFAULT_HOST
  const port = Number(options.port || DEFAULT_PORT)
  const runtimeBaseUrl = typeof options.runtimeBaseUrl === 'string' && options.runtimeBaseUrl.trim()
    ? options.runtimeBaseUrl.trim()
    : resolveRuntimeBaseUrl()

  let remoteReadonlyConfig = await loadRemoteReadonlyConfig(runtimeBaseUrl)
  let remoteReadonlyConfigFingerprint = remoteReadonlyConfig.fingerprint

  const refreshRemoteReadonlyConfigIfNeeded = async () => {
    const nextConfig = await loadRemoteReadonlyConfig(runtimeBaseUrl)
    if (nextConfig.fingerprint === remoteReadonlyConfigFingerprint) {
      remoteReadonlyConfig = nextConfig
      return remoteReadonlyConfig
    }

    remoteReadonlyConfig = nextConfig
    remoteReadonlyConfigFingerprint = nextConfig.fingerprint
    return remoteReadonlyConfig
  }

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res)
    const method = req.method || 'GET'

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    const pathname = requestUrl.pathname

    if (method === 'GET' && pathname === '/v1/health') {
      sendJson(res, 200, {
        service: 'fauplay-local-gateway',
        version: GATEWAY_VERSION,
        status: 'ok',
      })
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/capabilities') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        sendJson(res, 200, getRemoteReadonlyCapabilities(currentRemoteReadonlyConfig))
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/session/login') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await refreshRemoteReadonlyConfigIfNeeded()
        await forwardRemoteReadonlySessionLogin(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/session/logout') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlySessionLogout(req, res, runtimeBaseUrl, {
          forgetDevice: normalizeBoolean(payload.forgetDevice),
        })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/roots') {
      try {
        await forwardRemoteReadonlyRoots(req, res, runtimeBaseUrl)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/favorites') {
      try {
        await forwardRemoteReadonlyFavorites(req, res, runtimeBaseUrl)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/favorites/upsert') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyFavoriteUpsert(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/favorites/remove') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyFavoriteRemove(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'GET' && pathname.startsWith('/v1/remote/faces/crops/')) {
      try {
        const faceId = decodeURIComponent(pathname.slice('/v1/remote/faces/crops/'.length))
        await forwardRemoteReadonlyFaceCrop(req, res, runtimeBaseUrl, faceId, {
          rootId: requestUrl.searchParams.get('rootId'),
          size: requestUrl.searchParams.get('size'),
          padding: requestUrl.searchParams.get('padding'),
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/files/content') {
      try {
        await forwardRemoteReadonlyFileContent(req, res, runtimeBaseUrl, {
          rootId: requestUrl.searchParams.get('rootId'),
          relativePath: requestUrl.searchParams.get('relativePath'),
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/files/thumbnail') {
      try {
        await forwardRemoteReadonlyFileThumbnail(req, res, runtimeBaseUrl, {
          rootId: requestUrl.searchParams.get('rootId'),
          relativePath: requestUrl.searchParams.get('relativePath'),
          sizePreset: requestUrl.searchParams.get('sizePreset'),
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/files/list') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyFileList(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/files/text-preview') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyTextPreview(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/options') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyTagOptions(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/query') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyTagQuery(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/file') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyTagFile(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/faces/list-people') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyFacePeople(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/faces/list-person-faces') {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await forwardRemoteReadonlyPersonFaces(req, res, runtimeBaseUrl, payload)
      } catch (error) {
        await sendRemoteReadonlyError(res, error)
      }
      return
    }

    sendJson(res, 404, {
      ok: false,
      error: 'Not found',
      code: 'MCP_METHOD_NOT_FOUND',
    })
  })

  server.listen(port, host, () => {
    console.log(`Fauplay gateway listening on http://${host}:${port}`)
    console.log(`[gateway] Fauplay Runtime API: ${runtimeBaseUrl}`)
    console.log('[gateway] Remote access config files:')
    for (const source of remoteReadonlyConfig.configSources) {
      console.log(formatRemoteAccessConfigSourceLog(source))
    }
  })

  const shutdown = async () => {
    server.close()
  }

  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })

  return server
}
