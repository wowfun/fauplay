import http from 'node:http'
import { createRevealPlugin } from './plugins/reveal.mjs'

const DEFAULT_PORT = Number(process.env.FAUPLAY_GATEWAY_PORT || 3210)
const DEFAULT_HOST = '127.0.0.1'
const GATEWAY_VERSION = '0.1.0'

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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
  return JSON.parse(raw)
}

function createPluginRuntime() {
  const plugins = [createRevealPlugin()]
  const actionMap = new Map()

  for (const plugin of plugins) {
    for (const action of plugin.manifest.actions) {
      if (actionMap.has(action.actionId)) {
        throw new Error(`Duplicate actionId: ${action.actionId}`)
      }
      actionMap.set(action.actionId, { plugin, action })
    }
  }

  return { plugins, actionMap }
}

export function startGatewayServer(options = {}) {
  const host = options.host || DEFAULT_HOST
  const port = Number(options.port || DEFAULT_PORT)
  const runtime = createPluginRuntime()

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res)

    if (req.method === 'OPTIONS') {
      sendJson(res, 204, { ok: true })
      return
    }

    const url = req.url || '/'

    if (req.method === 'GET' && url === '/v1/health') {
      sendJson(res, 200, {
        ok: true,
        data: {
          service: 'fauplay-local-gateway',
          version: GATEWAY_VERSION,
        },
      })
      return
    }

    if (req.method === 'GET' && url === '/v1/capabilities') {
      sendJson(res, 200, {
        ok: true,
        data: {
          actions: runtime.plugins.flatMap((plugin) => plugin.manifest.actions),
          plugins: runtime.plugins.map((plugin) => ({
            id: plugin.manifest.id,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
          })),
        },
      })
      return
    }

    if (req.method === 'POST' && url === '/v1/actions/execute') {
      try {
        const payload = await readJsonBody(req)
        const actionId = payload.actionId
        if (!actionId || typeof actionId !== 'string') {
          sendJson(res, 400, {
            ok: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'actionId is required',
            },
          })
          return
        }

        const found = runtime.actionMap.get(actionId)
        if (!found) {
          sendJson(res, 404, {
            ok: false,
            error: {
              code: 'ACTION_NOT_FOUND',
              message: `Unknown actionId: ${actionId}`,
            },
          })
          return
        }

        const result = await found.plugin.execute(payload)
        sendJson(res, 200, {
          ok: true,
          data: result ?? {},
        })
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: {
            code: 'ACTION_EXECUTION_FAILED',
            message: error instanceof Error ? error.message : 'Action execution failed',
          },
        })
      }
      return
    }

    if (req.method === 'POST' && (url === '/v1/mutations/plan' || url === '/v1/mutations/commit')) {
      sendJson(res, 501, {
        ok: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Mutation endpoints are reserved for next milestone',
        },
      })
      return
    }

    sendJson(res, 404, {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Not found',
      },
    })
  })

  server.listen(port, host, () => {
    console.log(`Fauplay gateway listening on http://${host}:${port}`)
  })

  return server
}
