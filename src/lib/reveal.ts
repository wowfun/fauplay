import {
  listRuntimeLocalRootBindings,
  upsertRuntimeLocalRootBinding,
} from '@/lib/runtimeApi'

const ROOT_PATH_STORAGE_KEY = 'fauplay:host-root-path-map'
const ROOT_PATH_MAP_UPDATED_EVENT = 'fauplay:root-path-map-updated'
const ROOT_BINDING_RUNTIME_TIMEOUT_MS = 2000

interface RootPathMapV3 {
  version: 3
  byRootId: Record<string, string>
}

export interface LocalRootBinding {
  rootId: string
  rootPath: string
}

interface EnsureRootPathOptions {
  rootLabel: string
  rootId: string
  promptIfMissing?: boolean
  forcePrompt?: boolean
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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROOT_PATH_MAP_UPDATED_EVENT))
  }
}

function isSameRootPathMap(left: RootPathMapV3, right: RootPathMapV3): boolean {
  const leftKeys = Object.keys(left.byRootId)
  const rightKeys = Object.keys(right.byRootId)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => left.byRootId[key] === right.byRootId[key])
}

function persistLocalRootBindingToRuntime(rootId: string, rootPath: string): void {
  void upsertRuntimeLocalRootBinding(
    {
      rootId,
      rootPath,
    },
    ROOT_BINDING_RUNTIME_TIMEOUT_MS
  ).catch(() => undefined)
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
  forcePrompt = false,
}: EnsureRootPathOptions): string | null {
  if (!rootId) return null

  const pathMap = getRootPathMap()
  const existing = pathMap.byRootId[rootId] || ''

  if (!existing && !promptIfMissing && !forcePrompt) {
    return null
  }

  const next = forcePrompt
    ? askRootPath(rootLabel, existing)
    : (existing || askRootPath(rootLabel, existing))
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
    persistLocalRootBindingToRuntime(rootId, next)
  }

  return next
}

export function getBoundRootPath(rootId: string): string | null {
  if (!rootId) return null
  const pathMap = getRootPathMap()
  return pathMap.byRootId[rootId] || null
}

export function listLocalRootBindings(): LocalRootBinding[] {
  const pathMap = getRootPathMap()
  return Object.entries(pathMap.byRootId)
    .map(([rootId, rootPath]) => ({
      rootId,
      rootPath,
    }))
    .filter((entry) => entry.rootId && entry.rootPath)
}

export async function syncLocalRootBindingsFromRuntime(): Promise<void> {
  try {
    const localMap = getRootPathMap()
    const runtimeBindings = await listRuntimeLocalRootBindings(ROOT_BINDING_RUNTIME_TIMEOUT_MS)
    const runtimeRootIds = new Set(runtimeBindings.items.map((item) => item.rootId))
    const nextMap: RootPathMapV3 = {
      version: 3,
      byRootId: {
        ...localMap.byRootId,
      },
    }

    for (const item of runtimeBindings.items) {
      if (!item.rootId || !item.rootPath) continue
      nextMap.byRootId[item.rootId] = item.rootPath
    }

    if (!isSameRootPathMap(localMap, nextMap)) {
      setRootPathMap(nextMap)
    }

    await Promise.allSettled(
      Object.entries(localMap.byRootId)
        .filter(([rootId, rootPath]) => rootId && rootPath && !runtimeRootIds.has(rootId))
        .map(([rootId, rootPath]) => (
          upsertRuntimeLocalRootBinding(
            {
              rootId,
              rootPath,
            },
            ROOT_BINDING_RUNTIME_TIMEOUT_MS
          )
        ))
    )
  } catch {
    // Keep the local mirror usable when Fauplay Runtime is unavailable.
  }
}

export function getRootPathMapUpdatedEventName(): string {
  return ROOT_PATH_MAP_UPDATED_EVENT
}

export function getRootPathStorageKey(): string {
  return ROOT_PATH_STORAGE_KEY
}
