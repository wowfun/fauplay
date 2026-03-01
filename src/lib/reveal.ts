const GATEWAY_EXECUTE_URL = 'http://127.0.0.1:3210/v1/actions/execute'
const LEGACY_REVEAL_HELPER_URL = 'http://127.0.0.1:3210/reveal'
const LEGACY_OPEN_HELPER_URL = 'http://127.0.0.1:3210/open'
const ROOT_PATH_STORAGE_KEY = 'fauplay:host-root-path-map'

type RootPathMap = Record<string, string>
type LegacyAction = 'reveal' | 'openDefault'

interface GatewayErrorShape {
  ok?: boolean
  error?: {
    code?: string
    message?: string
  }
}

class GatewayActionError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'GatewayActionError'
    this.code = code
  }
}

function getRootPathMap(): RootPathMap {
  const raw = localStorage.getItem(ROOT_PATH_STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as RootPathMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function setRootPathMap(pathMap: RootPathMap) {
  localStorage.setItem(ROOT_PATH_STORAGE_KEY, JSON.stringify(pathMap))
}

function askRootPath(rootLabel: string, existing: string): string | null {
  const input = window.prompt(
    `请输入目录「${rootLabel}」在系统中的绝对路径（Windows 路径或 /mnt/... 路径）`,
    existing
  )
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed
}

export function ensureRootPath(rootLabel: string): string | null {
  const pathMap = getRootPathMap()
  const existing = pathMap[rootLabel] || ''
  const next = existing || askRootPath(rootLabel, existing)
  if (!next) return null
  if (pathMap[rootLabel] !== next) {
    setRootPathMap({ ...pathMap, [rootLabel]: next })
  }
  return next
}

function shouldFallbackToLegacy(error: unknown): boolean {
  if (!(error instanceof GatewayActionError)) return true
  if (!error.code) return true
  return error.code === 'NOT_FOUND' || error.code === 'ACTION_NOT_FOUND'
}

async function fetchWithTimeout(
  url: string,
  payload: Record<string, unknown>,
  fallbackMessage: string
): Promise<void> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const result = await response.json().catch(() => ({ ok: false, error: 'Invalid response' }))
    if (!response.ok || !result?.ok) {
      throw new Error((result as { error?: string }).error || fallbackMessage)
    }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function executeGatewayAction(actionId: string, rootPath: string, relativePath: string): Promise<void> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(GATEWAY_EXECUTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionId,
        context: {
          workspaceId: 'web-app',
          currentPath: '',
          selectedPaths: [relativePath],
        },
        payload: {
          rootPath,
          relativePath,
        },
      }),
      signal: controller.signal,
    })

    const result = (await response
      .json()
      .catch(() => ({ ok: false, error: { message: 'Invalid response' } }))) as GatewayErrorShape
    if (!response.ok || result.ok !== true) {
      throw new GatewayActionError(
        result.error?.message || 'Failed to execute gateway action',
        result.error?.code
      )
    }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function executeActionWithLegacyFallback(
  actionId: 'system.reveal' | 'system.openDefault',
  legacyAction: LegacyAction,
  relativePath: string,
  rootPath: string
): Promise<void> {
  try {
    await executeGatewayAction(actionId, rootPath, relativePath)
    return
  } catch (error) {
    if (!shouldFallbackToLegacy(error)) {
      throw error
    }
  }

  const legacyUrl = legacyAction === 'reveal' ? LEGACY_REVEAL_HELPER_URL : LEGACY_OPEN_HELPER_URL
  const fallbackMessage = legacyAction === 'reveal' ? 'Failed to reveal file' : 'Failed to open file'
  await fetchWithTimeout(legacyUrl, { rootPath, relativePath }, fallbackMessage)
}

export async function revealInSystemExplorer(relativePath: string, rootPath: string): Promise<void> {
  await executeActionWithLegacyFallback('system.reveal', 'reveal', relativePath, rootPath)
}

export async function openWithSystemDefaultApp(relativePath: string, rootPath: string): Promise<void> {
  await executeActionWithLegacyFallback('system.openDefault', 'openDefault', relativePath, rootPath)
}
