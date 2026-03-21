import type { AnnotationFilterTagOption } from '@/types'
import { callGatewayHttp } from '@/lib/gateway'
import { ensureRootPath } from '@/lib/reveal'

const TAG_QUERY_PAGE_SIZE = 1000
const ANNOTATION_SOURCE = 'meta.annotation'

type RootSnapshotStatus = 'idle' | 'loading' | 'ready'

type AnnotationFilterUiGateReason =
  | 'no_root'
  | 'missing_sidecar_dir'
  | 'missing_sidecar_file'
  | 'no_filterable_annotations'

interface RootAnnotationDisplaySnapshot {
  status: RootSnapshotStatus
  byPath: Record<string, Record<string, string>>
  byPathUpdatedAt: Record<string, number>
  tagKeysByPath: Record<string, string[]>
  tagOptions: AnnotationFilterTagOption[]
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  hasAnyFilterableAnnotation: boolean
  inflight: Promise<void> | null
  loadedAtMs: number | null
}

interface PreloadAnnotationDisplaySnapshotParams {
  rootId?: string | null
  rootHandle: FileSystemDirectoryHandle | null
  force?: boolean
}

interface PreloadFileAnnotationDisplaySnapshotParams {
  rootId?: string | null
  rootHandle: FileSystemDirectoryHandle | null
  relativePath: string
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

interface GatewayTagRecord {
  key?: string
  value?: string
  source?: string
  appliedAt?: number
  updatedAt?: number
}

interface GatewayFileTagView {
  relativePath?: string
  tags?: GatewayTagRecord[]
}

interface GatewayTagQueryResult {
  items?: GatewayFileTagView[]
  total?: number
}

interface GatewayFileTagResult {
  file?: GatewayFileTagView | null
}

const rootSnapshots = new Map<string, RootAnnotationDisplaySnapshot>()
const fileInflightLoads = new Map<string, Promise<void>>()
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

function parseAnnotationFilterTagKey(tagKey: string): { fieldKey: string; value: string } | null {
  if (!tagKey || !tagKey.includes('=')) return null

  const separator = tagKey.indexOf('=')
  const rawFieldKey = tagKey.slice(0, separator)
  const rawValue = tagKey.slice(separator + 1)

  try {
    const fieldKey = decodeURIComponent(rawFieldKey)
    const value = decodeURIComponent(rawValue)
    if (!fieldKey || !value) return null
    return { fieldKey, value }
  } catch {
    return null
  }
}

function buildFilterTagOptions(tagKeysByPath: Record<string, string[]>): AnnotationFilterTagOption[] {
  const countByTagKey = new Map<string, number>()
  const entryByTagKey = new Map<string, { fieldKey: string; value: string }>()

  for (const tagKeys of Object.values(tagKeysByPath)) {
    const deduped = new Set(tagKeys)
    for (const tagKey of deduped) {
      const parsed = parseAnnotationFilterTagKey(tagKey)
      if (!parsed) continue
      countByTagKey.set(tagKey, (countByTagKey.get(tagKey) ?? 0) + 1)
      if (!entryByTagKey.has(tagKey)) {
        entryByTagKey.set(tagKey, {
          fieldKey: parsed.fieldKey,
          value: parsed.value,
        })
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
  snapshot.tagOptions = buildFilterTagOptions(snapshot.tagKeysByPath)
  snapshot.hasAnyFilterableAnnotation = snapshot.tagOptions.length > 0
}

function ensureRootSnapshot(rootId: string): RootAnnotationDisplaySnapshot {
  const existing = rootSnapshots.get(rootId)
  if (existing) return existing

  const next: RootAnnotationDisplaySnapshot = {
    status: 'idle',
    byPath: {},
    byPathUpdatedAt: {},
    tagKeysByPath: {},
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

function resetSnapshot(snapshot: RootAnnotationDisplaySnapshot) {
  snapshot.byPath = {}
  snapshot.byPathUpdatedAt = {}
  snapshot.tagKeysByPath = {}
  snapshot.tagOptions = []
  snapshot.hasAnyFilterableAnnotation = false
}

function emitStoreUpdate() {
  storeVersion += 1
  for (const listener of listeners) {
    listener()
  }
}

function readTagViewsFromResult(rawResult: unknown): GatewayFileTagView[] {
  if (!isRecord(rawResult)) return []
  if (!Array.isArray(rawResult.items)) return []
  return rawResult.items.filter((item): item is GatewayFileTagView => isRecord(item))
}

async function loadAllTagViews(rootPath: string): Promise<GatewayFileTagView[]> {
  let page = 1
  let total = Number.POSITIVE_INFINITY
  const items: GatewayFileTagView[] = []

  while (items.length < total) {
    const result = await callGatewayHttp<GatewayTagQueryResult>('/v1/data/tags/query', {
      rootPath,
      page,
      size: TAG_QUERY_PAGE_SIZE,
      includeTagKeys: [],
      excludeTagKeys: [],
      includeMatchMode: 'or',
    })

    const batch = readTagViewsFromResult(result)
    items.push(...batch)

    const nextTotal = Number(result.total)
    total = Number.isFinite(nextTotal) && nextTotal >= 0 ? nextTotal : items.length

    if (batch.length < TAG_QUERY_PAGE_SIZE) {
      break
    }

    page += 1
    if (page > 10000) {
      break
    }
  }

  return items
}

function toUpdatedAt(value: unknown, fallbackValue?: unknown): number {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return Math.max(0, Math.trunc(numeric))

  const fallbackNumeric = Number(fallbackValue)
  if (Number.isFinite(fallbackNumeric)) return Math.max(0, Math.trunc(fallbackNumeric))

  return 0
}

function toAnnotationTag(tag: unknown): { fieldKey: string; value: string; updatedAt: number } | null {
  if (!isRecord(tag)) return null

  const source = typeof tag.source === 'string' ? tag.source.trim() : ''
  if (source !== ANNOTATION_SOURCE) return null

  const fieldKey = typeof tag.key === 'string' ? tag.key.trim() : ''
  const value = typeof tag.value === 'string' ? tag.value.trim() : ''
  if (!fieldKey || !value) return null

  const updatedAt = toUpdatedAt(tag.appliedAt, tag.updatedAt)
  return {
    fieldKey,
    value,
    updatedAt,
  }
}

function buildPathSnapshotFromTagViews(tagViews: GatewayFileTagView[]) {
  const byPath: Record<string, Record<string, string>> = {}
  const byPathUpdatedAt: Record<string, number> = {}
  const tagKeysByPath: Record<string, string[]> = {}

  for (const view of tagViews) {
    const relativePath = typeof view.relativePath === 'string'
      ? normalizeRelativePath(view.relativePath)
      : ''
    if (!relativePath) continue

    const tags = Array.isArray(view.tags) ? view.tags : []
    if (tags.length === 0) continue

    const latestValueByField = new Map<string, { value: string; updatedAt: number }>()
    const tagKeySet = new Set<string>()
    let maxUpdatedAt = 0

    for (const tag of tags) {
      const parsed = toAnnotationTag(tag)
      if (!parsed) continue

      const tagKey = toAnnotationFilterTagKey(parsed.fieldKey, parsed.value)
      tagKeySet.add(tagKey)
      maxUpdatedAt = Math.max(maxUpdatedAt, parsed.updatedAt)

      const existing = latestValueByField.get(parsed.fieldKey)
      if (!existing || parsed.updatedAt >= existing.updatedAt) {
        latestValueByField.set(parsed.fieldKey, {
          value: parsed.value,
          updatedAt: parsed.updatedAt,
        })
      }
    }

    if (tagKeySet.size === 0) continue

    byPath[relativePath] = {}
    for (const [fieldKey, entry] of latestValueByField.entries()) {
      byPath[relativePath][fieldKey] = entry.value
    }

    tagKeysByPath[relativePath] = [...tagKeySet]
    byPathUpdatedAt[relativePath] = maxUpdatedAt
  }

  return {
    byPath,
    byPathUpdatedAt,
    tagKeysByPath,
  }
}

function buildPathStateFromTags(tags: unknown[]): {
  fieldValues: Record<string, string> | null
  updatedAt: number | null
  tagKeys: string[]
} {
  const latestValueByField = new Map<string, { value: string; updatedAt: number }>()
  const tagKeySet = new Set<string>()
  let maxUpdatedAt = 0

  for (const tag of tags) {
    const parsed = toAnnotationTag(tag)
    if (!parsed) continue

    const tagKey = toAnnotationFilterTagKey(parsed.fieldKey, parsed.value)
    tagKeySet.add(tagKey)
    maxUpdatedAt = Math.max(maxUpdatedAt, parsed.updatedAt)

    const existing = latestValueByField.get(parsed.fieldKey)
    if (!existing || parsed.updatedAt >= existing.updatedAt) {
      latestValueByField.set(parsed.fieldKey, {
        value: parsed.value,
        updatedAt: parsed.updatedAt,
      })
    }
  }

  if (tagKeySet.size === 0) {
    return {
      fieldValues: null,
      updatedAt: null,
      tagKeys: [],
    }
  }

  const fieldValues: Record<string, string> = {}
  for (const [fieldKey, entry] of latestValueByField.entries()) {
    fieldValues[fieldKey] = entry.value
  }

  return {
    fieldValues,
    updatedAt: maxUpdatedAt,
    tagKeys: [...tagKeySet],
  }
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function applyFileTagsToSnapshot(
  snapshot: RootAnnotationDisplaySnapshot,
  relativePath: string,
  state: {
    fieldValues: Record<string, string> | null
    updatedAt: number | null
    tagKeys: string[]
  }
) {
  if (!state.fieldValues || state.tagKeys.length === 0) {
    snapshot.byPath = removeRecordKey(snapshot.byPath, relativePath)
    snapshot.byPathUpdatedAt = removeRecordKey(snapshot.byPathUpdatedAt, relativePath)
    snapshot.tagKeysByPath = removeRecordKey(snapshot.tagKeysByPath, relativePath)
    return
  }

  snapshot.byPath = {
    ...snapshot.byPath,
    [relativePath]: state.fieldValues,
  }
  snapshot.byPathUpdatedAt = {
    ...snapshot.byPathUpdatedAt,
    [relativePath]: state.updatedAt ?? 0,
  }
  snapshot.tagKeysByPath = {
    ...snapshot.tagKeysByPath,
    [relativePath]: state.tagKeys,
  }
}

function createFileLoadKey(rootId: string, relativePath: string): string {
  return `${rootId}:${relativePath}`
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
    const rootPath = ensureRootPath({
      rootLabel: rootHandle.name || 'current-folder',
      rootId,
      promptIfMissing: false,
    })
    const target = ensureRootSnapshot(rootId)

    if (!rootPath) {
      resetSnapshot(target)
      target.hasSidecarDir = false
      target.hasSidecarFile = false
      target.status = 'ready'
      target.loadedAtMs = Date.now()
      return
    }

    try {
      const views = await loadAllTagViews(rootPath)
      const derived = buildPathSnapshotFromTagViews(views)
      target.byPath = derived.byPath
      target.byPathUpdatedAt = derived.byPathUpdatedAt
      target.tagKeysByPath = derived.tagKeysByPath
      target.hasSidecarDir = true
      target.hasSidecarFile = true
      applyDerivedSnapshotFields(target)
      target.status = 'ready'
      target.loadedAtMs = Date.now()
    } catch {
      resetSnapshot(target)
      target.hasSidecarDir = true
      target.hasSidecarFile = false
      target.status = 'ready'
      target.loadedAtMs = Date.now()
    }
  })()
    .finally(() => {
      const target = ensureRootSnapshot(rootId)
      target.inflight = null
      emitStoreUpdate()
    })

  snapshot.inflight = loadTask
  await loadTask
}

export async function preloadFileAnnotationDisplaySnapshot({
  rootId,
  rootHandle,
  relativePath,
  force = false,
}: PreloadFileAnnotationDisplaySnapshotParams): Promise<void> {
  if (!rootId || !rootHandle) return

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return

  const snapshot = ensureRootSnapshot(rootId)
  if (!force && snapshot.byPath[normalizedPath]) {
    return
  }

  const rootPath = ensureRootPath({
    rootLabel: rootHandle.name || 'current-folder',
    rootId,
    promptIfMissing: false,
  })
  if (!rootPath) return

  const loadKey = createFileLoadKey(rootId, normalizedPath)
  if (!force) {
    const inflight = fileInflightLoads.get(loadKey)
    if (inflight) {
      await inflight
      return
    }
  }

  const loadTask = (async () => {
    const result = await callGatewayHttp<GatewayFileTagResult>('/v1/data/tags/file', {
      rootPath,
      relativePath: normalizedPath,
    })
    const fileView = isRecord(result.file) ? result.file : null
    const tags = fileView && Array.isArray(fileView.tags) ? fileView.tags : []
    const state = buildPathStateFromTags(tags)

    const target = ensureRootSnapshot(rootId)
    applyFileTagsToSnapshot(target, normalizedPath, state)
    target.hasSidecarDir = true
    target.hasSidecarFile = true
    if (target.status === 'idle') {
      target.status = 'ready'
      target.loadedAtMs = Date.now()
    }
    applyDerivedSnapshotFields(target)
    emitStoreUpdate()
  })()
    .catch(() => {
      // Ignore per-file query failures to avoid blocking preview rendering.
    })
    .finally(() => {
      fileInflightLoads.delete(loadKey)
    })

  fileInflightLoads.set(loadKey, loadTask)
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
  const existingFieldValues = snapshot.byPath[relativePath] ?? {}
  const previousValue = existingFieldValues[fieldKey]
  const nextTagKey = toAnnotationFilterTagKey(fieldKey, value)
  const currentTagKeys = snapshot.tagKeysByPath[relativePath] ?? []
  const tagKeySet = new Set(currentTagKeys)

  if (previousValue) {
    tagKeySet.delete(toAnnotationFilterTagKey(fieldKey, previousValue))
  }
  tagKeySet.add(nextTagKey)

  snapshot.byPath = {
    ...snapshot.byPath,
    [relativePath]: {
      ...existingFieldValues,
      [fieldKey]: value,
    },
  }
  snapshot.byPathUpdatedAt = {
    ...snapshot.byPathUpdatedAt,
    [relativePath]: Date.now(),
  }
  snapshot.tagKeysByPath = {
    ...snapshot.tagKeysByPath,
    [relativePath]: [...tagKeySet],
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
  if (!rootId || !relativePath) return []

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return []

  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return []

  const fromTagKeys = snapshot.tagKeysByPath[normalizedPath]
  if (Array.isArray(fromTagKeys) && fromTagKeys.length > 0) {
    return [...fromTagKeys]
  }

  const fieldValues = snapshot.byPath[normalizedPath]
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

export function getFileAnnotationUpdatedAt(
  rootId: string | null | undefined,
  relativePath: string | null | undefined
): number | null {
  if (!rootId || !relativePath) return null

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return null

  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return null

  const updatedAt = snapshot.byPathUpdatedAt[normalizedPath]
  if (!Number.isFinite(updatedAt)) return null
  return updatedAt
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
