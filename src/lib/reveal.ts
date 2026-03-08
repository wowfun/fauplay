const ROOT_PATH_STORAGE_KEY = 'fauplay:host-root-path-map'

interface RootPathMapV2 {
  version: 2
  byRootId: Record<string, string>
  byRootLabel: Record<string, string>
}

type LegacyRootPathMap = Record<string, string>

interface EnsureRootPathOptions {
  rootLabel: string
  rootId?: string | null
  promptIfMissing?: boolean
}

function toEmptyMap(): RootPathMapV2 {
  return {
    version: 2,
    byRootId: {},
    byRootLabel: {},
  }
}

function sanitizePath(path: string): string | null {
  const trimmed = path.trim()
  return trimmed ? trimmed : null
}

function parseRootPathMap(raw: string | null): RootPathMapV2 {
  if (!raw) return toEmptyMap()

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return toEmptyMap()

    const candidate = parsed as Partial<RootPathMapV2>
    if (candidate.version === 2) {
      const byRootId = candidate.byRootId && typeof candidate.byRootId === 'object'
        ? candidate.byRootId as Record<string, string>
        : {}
      const byRootLabel = candidate.byRootLabel && typeof candidate.byRootLabel === 'object'
        ? candidate.byRootLabel as Record<string, string>
        : {}
      return {
        version: 2,
        byRootId,
        byRootLabel,
      }
    }

    // Legacy payload: Record<rootLabel, rootPath>
    const legacy = parsed as LegacyRootPathMap
    const byRootLabel: Record<string, string> = {}
    for (const [key, value] of Object.entries(legacy)) {
      if (typeof value !== 'string') continue
      const normalized = sanitizePath(value)
      if (!normalized) continue
      byRootLabel[key] = normalized
    }

    return {
      version: 2,
      byRootId: {},
      byRootLabel,
    }
  } catch {
    return toEmptyMap()
  }
}

function getRootPathMap(): RootPathMapV2 {
  const raw = localStorage.getItem(ROOT_PATH_STORAGE_KEY)
  return parseRootPathMap(raw)
}

function setRootPathMap(pathMap: RootPathMapV2): void {
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

function resolveExistingPath(
  pathMap: RootPathMapV2,
  rootId: string | null | undefined,
  rootLabel: string
): string {
  if (rootId && pathMap.byRootId[rootId]) {
    return pathMap.byRootId[rootId]
  }
  return pathMap.byRootLabel[rootLabel] || ''
}

export function ensureRootPath({
  rootLabel,
  rootId,
  promptIfMissing = true,
}: EnsureRootPathOptions): string | null {
  const pathMap = getRootPathMap()
  const existing = resolveExistingPath(pathMap, rootId, rootLabel)

  if (!existing && !promptIfMissing) {
    return null
  }

  const next = existing || askRootPath(rootLabel, existing)
  if (!next) return null

  const nextByRootId = rootId
    ? { ...pathMap.byRootId, [rootId]: next }
    : pathMap.byRootId
  const nextByRootLabel = { ...pathMap.byRootLabel, [rootLabel]: next }

  const shouldWrite = (
    nextByRootLabel[rootLabel] !== pathMap.byRootLabel[rootLabel]
    || (rootId ? nextByRootId[rootId] !== pathMap.byRootId[rootId] : false)
    || pathMap.version !== 2
  )

  if (shouldWrite) {
    setRootPathMap({
      version: 2,
      byRootId: nextByRootId,
      byRootLabel: nextByRootLabel,
    })
  }

  return next
}
