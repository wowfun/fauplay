const ROOT_PATH_STORAGE_KEY = 'fauplay:host-root-path-map'

interface RootPathMapV3 {
  version: 3
  byRootId: Record<string, string>
}

interface EnsureRootPathOptions {
  rootLabel: string
  rootId: string
  promptIfMissing?: boolean
}

interface ParsedRootPathMap {
  map: RootPathMapV3
  shouldRewrite: boolean
}

function toEmptyMap(): RootPathMapV3 {
  return {
    version: 3,
    byRootId: {},
  }
}

function sanitizePath(path: string): string | null {
  const trimmed = path.trim()
  return trimmed ? trimmed : null
}

function sanitizeRootIdMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}

  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const normalized = sanitizePath(value)
    if (!normalized) continue
    next[key] = normalized
  }
  return next
}

function parseRootPathMap(raw: string | null): ParsedRootPathMap {
  if (!raw) {
    return {
      map: toEmptyMap(),
      shouldRewrite: false,
    }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return {
        map: toEmptyMap(),
        shouldRewrite: true,
      }
    }

    const candidate = parsed as Partial<RootPathMapV3>
    if (candidate.version !== 3 || !candidate.byRootId || typeof candidate.byRootId !== 'object') {
      return {
        map: toEmptyMap(),
        shouldRewrite: true,
      }
    }

    const byRootId = sanitizeRootIdMap(candidate.byRootId)
    const rawByRootId = candidate.byRootId as Record<string, unknown>
    const hasInvalidEntries = Object.keys(rawByRootId).length !== Object.keys(byRootId).length
    return {
      map: {
        version: 3,
        byRootId,
      },
      shouldRewrite: hasInvalidEntries,
    }
  } catch {
    return {
      map: toEmptyMap(),
      shouldRewrite: true,
    }
  }
}

function getRootPathMap(): RootPathMapV3 {
  const raw = localStorage.getItem(ROOT_PATH_STORAGE_KEY)
  const parsed = parseRootPathMap(raw)
  if (parsed.shouldRewrite) {
    setRootPathMap(parsed.map)
  }
  return parsed.map
}

function setRootPathMap(pathMap: RootPathMapV3): void {
  localStorage.setItem(ROOT_PATH_STORAGE_KEY, JSON.stringify(pathMap))
}

function askRootPath(rootLabel: string, existing: string): string | null {
  const input = window.prompt(
    `请输入目录「${rootLabel}」在系统中的绝对路径（Windows 路径或 /mnt/... 路径）`,
    existing
  )
  if (!input) return null
  return sanitizePath(input)
}

export function ensureRootPath({
  rootLabel,
  rootId,
  promptIfMissing = true,
}: EnsureRootPathOptions): string | null {
  if (!rootId) return null

  const pathMap = getRootPathMap()
  const existing = pathMap.byRootId[rootId] || ''

  if (!existing && !promptIfMissing) {
    return null
  }

  const next = existing || askRootPath(rootLabel, existing)
  if (!next) return null

  const shouldWrite = pathMap.byRootId[rootId] !== next

  if (shouldWrite) {
    const nextByRootId = {
      ...pathMap.byRootId,
      [rootId]: next,
    }
    setRootPathMap({
      version: 3,
      byRootId: nextByRootId,
    })
  }

  return next
}
