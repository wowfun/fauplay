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
