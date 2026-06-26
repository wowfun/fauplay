import http from 'node:http'
import { stat } from 'node:fs/promises'
import { createMcpRuntimeError } from './runtime-errors.mjs'
import {
  createRuntimeMcpBridge,
  resolveRuntimeMcpBaseUrl,
} from './runtime-mcp-bridge.mjs'
import { GLOBAL_ENV_PATH, loadGlobalEnvFile } from './env.mjs'
import {
  parseRemoteByteRangeHeader,
  readRuntimeFaceCrop,
  readRuntimeFileContent,
  readRuntimeFileThumbnail,
  readRuntimeTextPreview,
  sendRemoteRangeNotSatisfiable,
  sendRuntimeFileContentResponse,
} from './remote-file-access.mjs'
import {
  findHttpGatewayRoute,
  handleHttpGatewayRoute,
} from './http-routes.mjs'
import {
  clearRemoteReadonlyLoginFailures,
  clearRemoteReadonlySession,
  clearRemoteRememberedDevice,
  createRemoteBudgetExceededError,
  ensureRemoteReadonlyLoginAllowed,
  ensureRemoteReadonlySessionAuthorized,
  issueRemoteReadonlySession,
  issueRemoteRememberedDevice,
  normalizeRememberedDeviceLabel,
  readRemoteReadonlyClientId,
  registerRemoteReadonlyLoginFailure,
  REMOTE_REMEMBER_DEVICE_TTL_MS,
} from './remote-sessions.mjs'
import {
  ensureRemoteReadonlyAuthorized,
  formatRemoteAccessConfigSourceLog,
  getRemoteReadonlyCapabilities,
  getRemoteReadonlyFileTags,
  listRemoteReadonlyFavorites,
  listRemoteReadonlyFiles,
  listRemoteReadonlyPeople,
  listRemoteReadonlyPersonFaces,
  listRemoteReadonlyPublishedRoots,
  listRemoteReadonlyRoots,
  listRemoteReadonlyTagOptions,
  loadRemoteReadonlyConfig,
  queryRemoteReadonlyFilesByTags,
  removeRemoteReadonlyFavorite,
  resolveRemoteRoot,
  resolveRemoteReadonlyFileResource,
  resolveRemoteReadonlyThumbnailResource,
  upsertRemoteReadonlyFavorite,
} from './remote-readonly.mjs'
import {
  createRemoteRememberedDeviceStore,
} from './remembered-devices.mjs'

const DEFAULT_PORT = Number(process.env.FAUPLAY_GATEWAY_PORT || 3210)
const DEFAULT_HOST = '127.0.0.1'
const GATEWAY_VERSION = '0.2.0'
const REMOTE_CONTENT_CACHE_CONTROL = 'private, no-store'
const REMOTE_DERIVATIVE_CACHE_CONTROL = 'private, max-age=300'
const REMOTE_MAX_RANGE_BYTES = readPositiveIntegerEnv('FAUPLAY_REMOTE_MAX_RANGE_BYTES', 16 * 1024 * 1024)

function readPositiveIntegerEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

async function readOptionalFileFingerprint(filePath) {
  try {
    const result = await stat(filePath)
    return `${result.size}:${Math.trunc(result.mtimeMs)}`
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return 'missing'
    }
    throw error
  }
}

async function createRemoteReadonlyRuntimeFingerprint(configSources) {
  const parts = []
  for (const source of configSources) {
    parts.push(`${source.label}:${await readOptionalFileFingerprint(source.path)}`)
  }
  parts.push(`env:${await readOptionalFileFingerprint(GLOBAL_ENV_PATH)}`)
  return parts.join('|')
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

async function sendRemoteReadonlyError(res, remoteSessions, remoteRememberedDevices, req, error) {
  const statusCode = resolveErrorStatusCode(error)
  if (statusCode === 401) {
    clearRemoteReadonlySession(res, remoteSessions, req)
    await clearRemoteRememberedDevice(res, remoteSessions, remoteRememberedDevices, req)
  }
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
    : resolveRuntimeMcpBaseUrl()
  const runtime = createRuntimeMcpBridge({
    baseUrl: runtimeBaseUrl,
    callTimeoutMs: Number(process.env.FAUPLAY_RUNTIME_MCP_CALL_TIMEOUT_MS || process.env.FAUPLAY_MCP_CALL_TIMEOUT_MS || 120000),
    initTimeoutMs: Number(process.env.FAUPLAY_RUNTIME_MCP_INIT_TIMEOUT_MS || process.env.FAUPLAY_MCP_INIT_TIMEOUT_MS || 5000),
  })

  let remoteReadonlyConfig = await loadRemoteReadonlyConfig()
  const hydrateRemoteReadonlyRoots = async (config) => {
    if (config.rootSource === 'local-browser-sync') {
      config.roots = await listRemoteReadonlyPublishedRoots(runtimeBaseUrl)
    }
    return config
  }
  await hydrateRemoteReadonlyRoots(remoteReadonlyConfig)
  let remoteReadonlyConfigFingerprint = await createRemoteReadonlyRuntimeFingerprint(remoteReadonlyConfig.configSources)

  const remoteReadonlySessions = new Map()
  const remoteReadonlyLoginAttempts = new Map()
  const remoteRememberedDevices = createRemoteRememberedDeviceStore({
    ttlMs: REMOTE_REMEMBER_DEVICE_TTL_MS,
  })

  const refreshRemoteReadonlyConfigIfNeeded = async () => {
    const nextFingerprint = await createRemoteReadonlyRuntimeFingerprint(remoteReadonlyConfig.configSources)
    if (nextFingerprint === remoteReadonlyConfigFingerprint) {
      return hydrateRemoteReadonlyRoots(remoteReadonlyConfig)
    }

    remoteReadonlySessions.clear()
    remoteReadonlyLoginAttempts.clear()
    await remoteRememberedDevices.clearAll()
    delete process.env.FAUPLAY_REMOTE_ACCESS_TOKEN
    await loadGlobalEnvFile()
    remoteReadonlyConfig = await loadRemoteReadonlyConfig()
    await hydrateRemoteReadonlyRoots(remoteReadonlyConfig)
    remoteReadonlyConfigFingerprint = await createRemoteReadonlyRuntimeFingerprint(remoteReadonlyConfig.configSources)
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
      const remoteClientId = readRemoteReadonlyClientId(req)
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        const rememberDevice = normalizeBoolean(payload.rememberDevice)
        const rememberDeviceLabel = rememberDevice
          ? normalizeRememberedDeviceLabel(payload.rememberDeviceLabel)
          : ''
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        const nowMs = Date.now()
        ensureRemoteReadonlyLoginAllowed(remoteReadonlyLoginAttempts, remoteClientId)
        ensureRemoteReadonlyAuthorized(currentRemoteReadonlyConfig, req.headers)
        clearRemoteReadonlyLoginFailures(remoteReadonlyLoginAttempts, remoteClientId)
        let rememberedDeviceId = null
        if (rememberDevice) {
          const rememberedDevice = await issueRemoteRememberedDevice(
            res,
            remoteReadonlySessions,
            remoteRememberedDevices,
            req,
            nowMs,
            { label: rememberDeviceLabel },
          )
          rememberedDeviceId = rememberedDevice.id
        } else {
          await clearRemoteRememberedDevice(res, remoteReadonlySessions, remoteRememberedDevices, req)
        }
        issueRemoteReadonlySession(res, remoteReadonlySessions, req, nowMs, { rememberedDeviceId })
        res.statusCode = 204
        res.end()
      } catch (error) {
        if (resolveErrorStatusCode(error) === 401) {
          registerRemoteReadonlyLoginFailure(remoteReadonlyLoginAttempts, remoteClientId)
        }
        clearRemoteReadonlySession(res, remoteReadonlySessions, req)
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
        clearRemoteReadonlySession(res, remoteReadonlySessions, req)
        if (normalizeBoolean(payload.forgetDevice)) {
          await clearRemoteRememberedDevice(res, remoteReadonlySessions, remoteRememberedDevices, req)
        }
        sendJson(res, 200, {
          ok: true,
        })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/roots') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        sendJson(res, 200, {
          ok: true,
          items: listRemoteReadonlyRoots(currentRemoteReadonlyConfig),
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/favorites') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const items = await listRemoteReadonlyFavorites(currentRemoteReadonlyConfig, runtimeBaseUrl)
        sendJson(res, 200, { ok: true, items })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/favorites/upsert') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        const item = await upsertRemoteReadonlyFavorite(currentRemoteReadonlyConfig, payload, runtimeBaseUrl)
        sendJson(res, 200, { ok: true, item })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/favorites/remove') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        await removeRemoteReadonlyFavorite(currentRemoteReadonlyConfig, payload, runtimeBaseUrl)
        sendJson(res, 200, { ok: true })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname.startsWith('/v1/remote/faces/crops/')) {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const faceId = decodeURIComponent(pathname.slice('/v1/remote/faces/crops/'.length))
        const rootId = requestUrl.searchParams.get('rootId')
        const size = requestUrl.searchParams.get('size')
        const padding = requestUrl.searchParams.get('padding')
        const root = resolveRemoteRoot(currentRemoteReadonlyConfig, rootId)
        const result = await readRuntimeFaceCrop(runtimeBaseUrl, {
          faceId,
          rootPath: root.path,
          ...(size !== null ? { size } : {}),
          ...(padding !== null ? { padding } : {}),
        })
        sendRuntimeFileContentResponse(res, result, {
          cacheControl: REMOTE_DERIVATIVE_CACHE_CONTROL,
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/files/content') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const resource = await resolveRemoteReadonlyFileResource(currentRemoteReadonlyConfig, {
          rootId: requestUrl.searchParams.get('rootId'),
          relativePath: requestUrl.searchParams.get('relativePath'),
        })
        const requestedRange = parseRemoteByteRangeHeader(req.headers.range, resource.sizeBytes)
        if (requestedRange && requestedRange.invalid === true) {
          sendRemoteRangeNotSatisfiable(res, resource.sizeBytes, {
            cacheControl: REMOTE_CONTENT_CACHE_CONTROL,
            lastModifiedMs: resource.lastModifiedMs,
          })
          return
        }
        if (
          requestedRange
          && requestedRange.end - requestedRange.start + 1 > REMOTE_MAX_RANGE_BYTES
        ) {
          throw createRemoteBudgetExceededError('Requested media range exceeds remote budget')
        }
        const result = await readRuntimeFileContent(runtimeBaseUrl, {
          absolutePath: resource.absolutePath,
          rangeHeader: req.headers.range,
        })
        sendRuntimeFileContentResponse(
          res,
          result,
          {
            cacheControl: REMOTE_CONTENT_CACHE_CONTROL,
            lastModifiedMs: resource.lastModifiedMs,
          },
        )
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'GET' && pathname === '/v1/remote/files/thumbnail') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const resource = await resolveRemoteReadonlyThumbnailResource(currentRemoteReadonlyConfig, {
          rootId: requestUrl.searchParams.get('rootId'),
          relativePath: requestUrl.searchParams.get('relativePath'),
          sizePreset: requestUrl.searchParams.get('sizePreset'),
        })
        const result = await readRuntimeFileThumbnail(runtimeBaseUrl, {
          absolutePath: resource.absolutePath,
          sizePreset: requestUrl.searchParams.get('sizePreset'),
        })
        sendRuntimeFileContentResponse(res, result, {
          cacheControl: REMOTE_DERIVATIVE_CACHE_CONTROL,
        })
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (findHttpGatewayRoute(method, pathname)) {
      try {
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }

        const result = await handleHttpGatewayRoute(runtime, method, pathname, payload, requestUrl)
        sendJson(res, 200, result ?? { ok: true })
      } catch (error) {
        sendJson(res, resolveErrorStatusCode(error), toHttpErrorBody(error))
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/files/list') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await listRemoteReadonlyFiles(currentRemoteReadonlyConfig, payload, runtimeBaseUrl))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/files/text-preview') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        const resource = await resolveRemoteReadonlyFileResource(currentRemoteReadonlyConfig, {
          rootId: payload.rootId,
          relativePath: payload.relativePath,
        })
        sendJson(res, 200, await readRuntimeTextPreview(runtimeBaseUrl, {
          absolutePath: resource.absolutePath,
          ...(typeof payload.sizeLimitBytes !== 'undefined' ? { sizeLimitBytes: payload.sizeLimitBytes } : {}),
        }))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/options') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await listRemoteReadonlyTagOptions(currentRemoteReadonlyConfig, payload, runtimeBaseUrl))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/query') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await queryRemoteReadonlyFilesByTags(currentRemoteReadonlyConfig, payload, runtimeBaseUrl))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/tags/file') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await getRemoteReadonlyFileTags(currentRemoteReadonlyConfig, payload, runtimeBaseUrl))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/faces/list-people') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await listRemoteReadonlyPeople(currentRemoteReadonlyConfig, payload, runtimeBaseUrl))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
      }
      return
    }

    if (method === 'POST' && pathname === '/v1/remote/faces/list-person-faces') {
      try {
        const currentRemoteReadonlyConfig = await refreshRemoteReadonlyConfigIfNeeded()
        await ensureRemoteReadonlySessionAuthorized(
          currentRemoteReadonlyConfig,
          req,
          res,
          remoteReadonlySessions,
          remoteRememberedDevices,
        )
        const payload = await readJsonBody(req)
        if (!isObjectRecord(payload)) {
          throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'Request body must be a JSON object', 400)
        }
        sendJson(res, 200, await listRemoteReadonlyPersonFaces(currentRemoteReadonlyConfig, payload, runtimeBaseUrl))
      } catch (error) {
        await sendRemoteReadonlyError(res, remoteReadonlySessions, remoteRememberedDevices, req, error)
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
    console.log(`[gateway] Runtime MCP bridge: ${runtimeBaseUrl.replace(/\/+$/, '')}/v1/mcp`)
    console.log('[gateway] Remote access config files:')
    for (const source of remoteReadonlyConfig.configSources) {
      console.log(formatRemoteAccessConfigSourceLog(source))
    }
  })

  const shutdown = async () => {
    server.close()
    await runtime.shutdown()
  }

  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })

  return server
}
