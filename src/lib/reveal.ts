const REVEAL_HELPER_URL = 'http://127.0.0.1:3210/reveal'
const ROOT_PATH_STORAGE_KEY = 'fauplay:host-root-path-map'

type RootPathMap = Record<string, string>

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

export async function revealInSystemExplorer(relativePath: string, rootPath: string): Promise<void> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(REVEAL_HELPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath, relativePath }),
      signal: controller.signal,
    })

    const result = await response.json().catch(() => ({ ok: false, error: 'Invalid response' }))
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Failed to reveal file')
    }
  } finally {
    window.clearTimeout(timeoutId)
  }
}
