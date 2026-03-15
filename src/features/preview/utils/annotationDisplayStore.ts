const SIDECAR_DIRNAME = '.fauplay'
const SIDECAR_FILENAME = '.annotations.v1.json'

type RootSnapshotStatus = 'idle' | 'loading' | 'ready'

interface RootAnnotationDisplaySnapshot {
  status: RootSnapshotStatus
  byPath: Record<string, Record<string, string>>
  inflight: Promise<void> | null
  loadedAtMs: number | null
}

interface SidecarAnnotationRecord {
  pathSnapshot: string
  status: string
  fieldValues: Record<string, string>
  updatedAt: number
}

interface SidecarParsedPayload {
  annotations: SidecarAnnotationRecord[]
}

interface PreloadAnnotationDisplaySnapshotParams {
  rootId?: string | null
  rootHandle: FileSystemDirectoryHandle | null
  force?: boolean
}

interface PatchAnnotationSetValueParams {
  rootId?: string | null
  relativePath: string
  fieldKey: string
  value: string
}

const rootSnapshots = new Map<string, RootAnnotationDisplaySnapshot>()
const listeners = new Set<() => void>()
let storeVersion = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

function sanitizeFieldValues(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}

  const result: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (typeof rawKey !== 'string' || typeof rawValue !== 'string') continue
    const key = rawKey.trim()
    const value = rawValue.trim()
    if (!key || !value) continue
    result[key] = value
  }
  return result
}

function toRecordUpdatedAt(value: unknown): number {
  if (!Number.isFinite(value)) return 0
  return Math.trunc(Number(value))
}

function parseSidecarJson(raw: string): SidecarParsedPayload {
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { annotations: [] }
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.annotations)) {
    return { annotations: [] }
  }

  const annotations: SidecarAnnotationRecord[] = []
  for (const item of parsed.annotations) {
    if (!isRecord(item)) continue
    const pathSnapshot = typeof item.pathSnapshot === 'string' ? normalizeRelativePath(item.pathSnapshot) : ''
    if (!pathSnapshot) continue
    const status = typeof item.status === 'string' ? item.status : ''
    const fieldValues = sanitizeFieldValues(item.fieldValues)
    if (Object.keys(fieldValues).length === 0) continue

    annotations.push({
      pathSnapshot,
      status,
      fieldValues,
      updatedAt: toRecordUpdatedAt(item.updatedAt),
    })
  }

  return { annotations }
}

function buildPathSnapshotByLatestRecord(payload: SidecarParsedPayload): Record<string, Record<string, string>> {
  const latestByPath = new Map<string, { updatedAt: number; fieldValues: Record<string, string> }>()

  for (const item of payload.annotations) {
    if (item.status !== 'active') continue

    const existing = latestByPath.get(item.pathSnapshot)
    if (existing && existing.updatedAt > item.updatedAt) {
      continue
    }

    latestByPath.set(item.pathSnapshot, {
      updatedAt: item.updatedAt,
      fieldValues: item.fieldValues,
    })
  }

  const byPath: Record<string, Record<string, string>> = {}
  for (const [path, item] of latestByPath.entries()) {
    byPath[path] = item.fieldValues
  }
  return byPath
}

function ensureRootSnapshot(rootId: string): RootAnnotationDisplaySnapshot {
  const existing = rootSnapshots.get(rootId)
  if (existing) return existing

  const next: RootAnnotationDisplaySnapshot = {
    status: 'idle',
    byPath: {},
    inflight: null,
    loadedAtMs: null,
  }
  rootSnapshots.set(rootId, next)
  return next
}

function emitStoreUpdate() {
  storeVersion += 1
  for (const listener of listeners) {
    listener()
  }
}

async function readSidecarFileText(rootHandle: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    const sidecarDir = await rootHandle.getDirectoryHandle(SIDECAR_DIRNAME)
    const sidecarFile = await sidecarDir.getFileHandle(SIDECAR_FILENAME)
    const file = await sidecarFile.getFile()
    return file.text()
  } catch {
    return null
  }
}

export async function preloadAnnotationDisplaySnapshot({
  rootId,
  rootHandle,
  force = false,
}: PreloadAnnotationDisplaySnapshotParams): Promise<void> {
  if (!rootId || !rootHandle) return

  const snapshot = ensureRootSnapshot(rootId)
  if (!force && snapshot.status === 'ready') return
  if (!force && snapshot.inflight) {
    await snapshot.inflight
    return
  }

  snapshot.status = 'loading'
  emitStoreUpdate()

  const loadTask = (async () => {
    const text = await readSidecarFileText(rootHandle)
    const parsed = text ? parseSidecarJson(text) : { annotations: [] }
    const byPath = buildPathSnapshotByLatestRecord(parsed)
    const target = ensureRootSnapshot(rootId)
    target.byPath = byPath
    target.status = 'ready'
    target.loadedAtMs = Date.now()
  })()
    .catch(() => {
      const target = ensureRootSnapshot(rootId)
      target.byPath = {}
      target.status = 'ready'
      target.loadedAtMs = Date.now()
    })
    .finally(() => {
      const target = ensureRootSnapshot(rootId)
      target.inflight = null
      emitStoreUpdate()
    })

  snapshot.inflight = loadTask
  await loadTask
}

export function patchAnnotationSetValue(params: PatchAnnotationSetValueParams) {
  const rootId = params.rootId
  if (!rootId) return

  const relativePath = normalizeRelativePath(params.relativePath)
  const fieldKey = params.fieldKey.trim()
  const value = params.value.trim()
  if (!relativePath || !fieldKey || !value) return

  const snapshot = ensureRootSnapshot(rootId)
  const existing = snapshot.byPath[relativePath] ?? {}
  snapshot.byPath = {
    ...snapshot.byPath,
    [relativePath]: {
      ...existing,
      [fieldKey]: value,
    },
  }
  snapshot.status = 'ready'
  if (snapshot.loadedAtMs === null) {
    snapshot.loadedAtMs = Date.now()
  }
  emitStoreUpdate()
}

export function getFileAnnotationFieldValues(
  rootId: string | null | undefined,
  relativePath: string | null | undefined
): Record<string, string> | null {
  if (!rootId || !relativePath) return null

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return null

  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return null
  return snapshot.byPath[normalizedPath] ?? null
}

export function subscribeAnnotationDisplayStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAnnotationDisplayStoreVersion(): number {
  return storeVersion
}
