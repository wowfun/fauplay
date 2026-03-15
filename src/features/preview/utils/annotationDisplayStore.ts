import type { AnnotationFilterTagOption } from '@/types'

const SIDECAR_DIRNAME = '.fauplay'
const SIDECAR_FILENAME = '.annotations.v1.json'

type RootSnapshotStatus = 'idle' | 'loading' | 'ready'

type AnnotationFilterUiGateReason =
  | 'no_root'
  | 'missing_sidecar_dir'
  | 'missing_sidecar_file'
  | 'no_filterable_annotations'

interface RootAnnotationDisplaySnapshot {
  status: RootSnapshotStatus
  byPath: Record<string, Record<string, string>>
  tagOptions: AnnotationFilterTagOption[]
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  hasAnyFilterableAnnotation: boolean
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

interface SidecarReadResult {
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  text: string | null
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

interface AnnotationFilterUiGateState {
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  hasAnyFilterableAnnotation: boolean
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

export function toAnnotationFilterTagKey(fieldKey: string, value: string): string {
  return `${encodeURIComponent(fieldKey)}=${encodeURIComponent(value)}`
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

function buildFilterTagOptions(byPath: Record<string, Record<string, string>>): AnnotationFilterTagOption[] {
  const countByTagKey = new Map<string, number>()
  const entryByTagKey = new Map<string, { fieldKey: string; value: string }>()

  for (const fieldValues of Object.values(byPath)) {
    for (const [fieldKey, value] of Object.entries(fieldValues)) {
      const tagKey = toAnnotationFilterTagKey(fieldKey, value)
      const prevCount = countByTagKey.get(tagKey) ?? 0
      countByTagKey.set(tagKey, prevCount + 1)
      if (!entryByTagKey.has(tagKey)) {
        entryByTagKey.set(tagKey, { fieldKey, value })
      }
    }
  }

  const options: AnnotationFilterTagOption[] = []
  for (const [tagKey, entry] of entryByTagKey.entries()) {
    options.push({
      tagKey,
      fieldKey: entry.fieldKey,
      value: entry.value,
      fileCount: countByTagKey.get(tagKey) ?? 0,
    })
  }

  options.sort((left, right) => {
    const fieldCmp = left.fieldKey.localeCompare(right.fieldKey, 'zh-Hans-CN')
    if (fieldCmp !== 0) return fieldCmp
    return left.value.localeCompare(right.value, 'zh-Hans-CN')
  })

  return options
}

function applyDerivedSnapshotFields(snapshot: RootAnnotationDisplaySnapshot) {
  snapshot.tagOptions = buildFilterTagOptions(snapshot.byPath)
  snapshot.hasAnyFilterableAnnotation = snapshot.tagOptions.length > 0
}

function ensureRootSnapshot(rootId: string): RootAnnotationDisplaySnapshot {
  const existing = rootSnapshots.get(rootId)
  if (existing) return existing

  const next: RootAnnotationDisplaySnapshot = {
    status: 'idle',
    byPath: {},
    tagOptions: [],
    hasSidecarDir: false,
    hasSidecarFile: false,
    hasAnyFilterableAnnotation: false,
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

async function readSidecarFileText(rootHandle: FileSystemDirectoryHandle): Promise<SidecarReadResult> {
  let sidecarDir: FileSystemDirectoryHandle
  try {
    sidecarDir = await rootHandle.getDirectoryHandle(SIDECAR_DIRNAME)
  } catch {
    return {
      hasSidecarDir: false,
      hasSidecarFile: false,
      text: null,
    }
  }

  let sidecarFile: FileSystemFileHandle
  try {
    sidecarFile = await sidecarDir.getFileHandle(SIDECAR_FILENAME)
  } catch {
    return {
      hasSidecarDir: true,
      hasSidecarFile: false,
      text: null,
    }
  }

  try {
    const file = await sidecarFile.getFile()
    const text = await file.text()
    return {
      hasSidecarDir: true,
      hasSidecarFile: true,
      text,
    }
  } catch {
    return {
      hasSidecarDir: true,
      hasSidecarFile: true,
      text: null,
    }
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
    const sidecarReadResult = await readSidecarFileText(rootHandle)
    const parsed = sidecarReadResult.text ? parseSidecarJson(sidecarReadResult.text) : { annotations: [] }
    const byPath = buildPathSnapshotByLatestRecord(parsed)
    const target = ensureRootSnapshot(rootId)
    target.byPath = byPath
    target.hasSidecarDir = sidecarReadResult.hasSidecarDir
    target.hasSidecarFile = sidecarReadResult.hasSidecarFile
    applyDerivedSnapshotFields(target)
    target.status = 'ready'
    target.loadedAtMs = Date.now()
  })()
    .catch(() => {
      const target = ensureRootSnapshot(rootId)
      target.byPath = {}
      target.hasSidecarDir = false
      target.hasSidecarFile = false
      applyDerivedSnapshotFields(target)
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
  snapshot.hasSidecarDir = true
  snapshot.hasSidecarFile = true
  applyDerivedSnapshotFields(snapshot)
  snapshot.status = 'ready'
  if (snapshot.loadedAtMs === null) {
    snapshot.loadedAtMs = Date.now()
  }
  emitStoreUpdate()
}

export function getAnnotationFilterUiGateState(rootId: string | null | undefined): AnnotationFilterUiGateState {
  if (!rootId) {
    return {
      hasSidecarDir: false,
      hasSidecarFile: false,
      hasAnyFilterableAnnotation: false,
    }
  }
  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) {
    return {
      hasSidecarDir: false,
      hasSidecarFile: false,
      hasAnyFilterableAnnotation: false,
    }
  }
  return {
    hasSidecarDir: snapshot.hasSidecarDir,
    hasSidecarFile: snapshot.hasSidecarFile,
    hasAnyFilterableAnnotation: snapshot.hasAnyFilterableAnnotation,
  }
}

export function isAnnotationFilterUiVisible(rootId: string | null | undefined): boolean {
  const gate = getAnnotationFilterUiGateState(rootId)
  return gate.hasSidecarFile && gate.hasAnyFilterableAnnotation
}

export function getAnnotationFilterUiGateReason(
  rootId: string | null | undefined
): AnnotationFilterUiGateReason | null {
  if (!rootId) return 'no_root'
  const gate = getAnnotationFilterUiGateState(rootId)
  if (!gate.hasSidecarDir) return 'missing_sidecar_dir'
  if (!gate.hasSidecarFile) return 'missing_sidecar_file'
  if (!gate.hasAnyFilterableAnnotation) return 'no_filterable_annotations'
  return null
}

export function getRootAnnotationFilterTagOptions(rootId: string | null | undefined): AnnotationFilterTagOption[] {
  if (!rootId) return []
  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return []
  return snapshot.tagOptions.map((item) => ({ ...item }))
}

export function getFileAnnotationTagKeys(
  rootId: string | null | undefined,
  relativePath: string | null | undefined
): string[] {
  const fieldValues = getFileAnnotationFieldValues(rootId, relativePath)
  if (!fieldValues) return []
  return Object.entries(fieldValues).map(([fieldKey, value]) => toAnnotationFilterTagKey(fieldKey, value))
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
