import type { AnnotationFilterTagOption } from '@/types'
import { getActiveRemoteWorkspace, isRemoteReadonlyProviderActive } from '@/lib/accessState'
import { callGatewayHttp, callRemoteGatewayHttp } from '@/lib/gateway'
import { ensureRootPath } from '@/lib/reveal'

const TAG_QUERY_PAGE_SIZE = 1000
const META_ANNOTATION_SOURCE = 'meta.annotation'

type RootSnapshotStatus = 'idle' | 'loading' | 'ready'
type GlobalTagOptionsStatus = 'idle' | 'loading' | 'ready'

type AnnotationFilterUiGateReason =
  | 'no_root'
  | 'missing_sidecar_dir'
  | 'missing_sidecar_file'
  | 'no_filterable_annotations'

export interface AnnotationLogicalTag {
  tagKey: string
  key: string
  value: string
  sources: string[]
  hasMetaAnnotation: boolean
  representativeSource: string
  updatedAt: number
}

interface RootAnnotationDisplaySnapshot {
  status: RootSnapshotStatus
  rawTagsByPath: Record<string, StoredTagRecord[]>
  byPathUpdatedAt: Record<string, number>
  tagKeysByPath: Record<string, string[]>
  tagOptions: AnnotationFilterTagOption[]
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  hasAnyFilterableAnnotation: boolean
  inflight: Promise<void> | null
  loadedAtMs: number | null
}

interface GlobalAnnotationTagOptionsSnapshot {
  status: GlobalTagOptionsStatus
  options: AnnotationFilterTagOption[]
  error: string | null
  inflight: Promise<void> | null
  loadedAtMs: number | null
}

interface PreloadAnnotationDisplaySnapshotParams {
  rootId?: string | null
  rootHandle: FileSystemDirectoryHandle | null
  rootLabel?: string | null
  force?: boolean
}

interface PreloadFileAnnotationDisplaySnapshotParams {
  rootId?: string | null
  rootHandle: FileSystemDirectoryHandle | null
  rootLabel?: string | null
  relativePath: string
  force?: boolean
}

interface PreloadGlobalAnnotationTagOptionsParams {
  force?: boolean
}

interface PatchAnnotationSetValueParams {
  rootId?: string | null
  relativePath: string
  fieldKey: string
  value: string
}

interface PatchAnnotationTagBindingParams {
  rootId?: string | null
  relativePath: string
  key: string
  value: string
}

type PatchRollback = (() => void) | null

interface AnnotationFilterUiGateState {
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  hasAnyFilterableAnnotation: boolean
}

export interface GlobalAnnotationTagOptionsState {
  status: GlobalTagOptionsStatus
  error: string | null
}

interface StoredTagRecord {
  key: string
  value: string
  source: string
  appliedAt: number
  updatedAt: number
}

interface GatewayTagRecord {
  key?: string
  value?: string
  source?: string
  appliedAt?: number
  updatedAt?: number
}

interface GatewayTagOptionRecord extends GatewayTagRecord {
  fileCount?: number
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

interface GatewayTagOptionsResult {
  items?: GatewayTagOptionRecord[]
  options?: GatewayTagOptionRecord[]
}

const rootSnapshots = new Map<string, RootAnnotationDisplaySnapshot>()
const fileInflightLoads = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const globalTagOptionsSnapshot: GlobalAnnotationTagOptionsSnapshot = {
  status: 'idle',
  options: [],
  error: null,
  inflight: null,
  loadedAtMs: null,
}
let storeVersion = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

export function toAnnotationFilterTagKey(key: string, value: string): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function parseAnnotationFilterTagKey(tagKey: string): { key: string; value: string } | null {
  if (!tagKey || !tagKey.includes('=')) return null

  const separator = tagKey.indexOf('=')
  const rawKey = tagKey.slice(0, separator)
  const rawValue = tagKey.slice(separator + 1)

  try {
    const key = decodeURIComponent(rawKey)
    const value = decodeURIComponent(rawValue)
    if (!key || !value) return null
    return { key, value }
  } catch {
    return null
  }
}

function compareSource(left: string, right: string): number {
  if (left === META_ANNOTATION_SOURCE && right !== META_ANNOTATION_SOURCE) return -1
  if (left !== META_ANNOTATION_SOURCE && right === META_ANNOTATION_SOURCE) return 1
  return left.localeCompare(right)
}

function toSortedSources(sourceSet: Iterable<string>): string[] {
  return [...new Set(sourceSet)].sort(compareSource)
}

function getRepresentativeSource(sources: string[]): string {
  return sources[0] ?? ''
}

function compareLogicalIdentity(
  left: Pick<AnnotationLogicalTag, 'key' | 'value'>,
  right: Pick<AnnotationLogicalTag, 'key' | 'value'>
): number {
  const keyCmp = left.key.localeCompare(right.key, 'zh-Hans-CN')
  if (keyCmp !== 0) return keyCmp
  return left.value.localeCompare(right.value, 'zh-Hans-CN')
}

function computeUpdatedAt(rawTags: StoredTagRecord[]): number {
  let maxUpdatedAt = 0
  for (const tag of rawTags) {
    maxUpdatedAt = Math.max(maxUpdatedAt, tag.updatedAt)
  }
  return maxUpdatedAt
}

function toUpdatedAt(value: unknown, fallbackValue?: unknown): number {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return Math.max(0, Math.trunc(numeric))

  const fallbackNumeric = Number(fallbackValue)
  if (Number.isFinite(fallbackNumeric)) return Math.max(0, Math.trunc(fallbackNumeric))

  return 0
}

function normalizeStoredTagRecord(tag: unknown): StoredTagRecord | null {
  if (!isRecord(tag)) return null

  const key = typeof tag.key === 'string' ? tag.key.trim() : ''
  const value = typeof tag.value === 'string' ? tag.value.trim() : ''
  const source = typeof tag.source === 'string' ? tag.source.trim() : ''
  if (!key || !value || !source) return null

  const updatedAt = toUpdatedAt(tag.appliedAt, tag.updatedAt)
  return {
    key,
    value,
    source,
    appliedAt: updatedAt,
    updatedAt,
  }
}

function buildLogicalTags(rawTags: StoredTagRecord[]): AnnotationLogicalTag[] {
  const entryByTagKey = new Map<string, {
    key: string
    value: string
    sources: Set<string>
    updatedAt: number
    hasMetaAnnotation: boolean
  }>()

  for (const tag of rawTags) {
    const tagKey = toAnnotationFilterTagKey(tag.key, tag.value)
    const existing = entryByTagKey.get(tagKey)
    if (existing) {
      existing.sources.add(tag.source)
      existing.updatedAt = Math.max(existing.updatedAt, tag.updatedAt)
      existing.hasMetaAnnotation = existing.hasMetaAnnotation || tag.source === META_ANNOTATION_SOURCE
      continue
    }

    entryByTagKey.set(tagKey, {
      key: tag.key,
      value: tag.value,
      sources: new Set([tag.source]),
      updatedAt: tag.updatedAt,
      hasMetaAnnotation: tag.source === META_ANNOTATION_SOURCE,
    })
  }

  const logicalTags = [...entryByTagKey.entries()].map(([tagKey, entry]) => {
    const sources = toSortedSources(entry.sources)
    return {
      tagKey,
      key: entry.key,
      value: entry.value,
      sources,
      hasMetaAnnotation: entry.hasMetaAnnotation,
      representativeSource: getRepresentativeSource(sources),
      updatedAt: entry.updatedAt,
    } satisfies AnnotationLogicalTag
  })

  logicalTags.sort(compareLogicalIdentity)
  return logicalTags
}

function buildFilterTagOptions(rawTagsByPath: Record<string, StoredTagRecord[]>): AnnotationFilterTagOption[] {
  const countByTagKey = new Map<string, number>()
  const entryByTagKey = new Map<string, {
    key: string
    value: string
    sources: Set<string>
    hasMetaAnnotation: boolean
  }>()

  for (const rawTags of Object.values(rawTagsByPath)) {
    const logicalTags = buildLogicalTags(rawTags)
    for (const logicalTag of logicalTags) {
      countByTagKey.set(logicalTag.tagKey, (countByTagKey.get(logicalTag.tagKey) ?? 0) + 1)

      const existing = entryByTagKey.get(logicalTag.tagKey)
      if (existing) {
        logicalTag.sources.forEach((source) => existing.sources.add(source))
        existing.hasMetaAnnotation = existing.hasMetaAnnotation || logicalTag.hasMetaAnnotation
        continue
      }

      entryByTagKey.set(logicalTag.tagKey, {
        key: logicalTag.key,
        value: logicalTag.value,
        sources: new Set(logicalTag.sources),
        hasMetaAnnotation: logicalTag.hasMetaAnnotation,
      })
    }
  }

  const options: AnnotationFilterTagOption[] = []
  for (const [tagKey, entry] of entryByTagKey.entries()) {
    const sources = toSortedSources(entry.sources)
    options.push({
      tagKey,
      key: entry.key,
      value: entry.value,
      sources,
      hasMetaAnnotation: entry.hasMetaAnnotation,
      representativeSource: getRepresentativeSource(sources),
      fileCount: countByTagKey.get(tagKey) ?? 0,
    })
  }

  options.sort((left, right) => compareLogicalIdentity(left, right))
  return options
}

function buildGlobalTagOptions(optionRecords: GatewayTagOptionRecord[]): AnnotationFilterTagOption[] {
  const entryByTagKey = new Map<string, {
    key: string
    value: string
    sources: Set<string>
    hasMetaAnnotation: boolean
    fileCount?: number
  }>()

  for (const record of optionRecords) {
    const normalized = normalizeStoredTagRecord(record)
    if (!normalized) continue

    const tagKey = toAnnotationFilterTagKey(normalized.key, normalized.value)
    const existing = entryByTagKey.get(tagKey)
    if (existing) {
      existing.sources.add(normalized.source)
      existing.hasMetaAnnotation = existing.hasMetaAnnotation || normalized.source === META_ANNOTATION_SOURCE
      const numericFileCount = Number(record.fileCount)
      if (Number.isFinite(numericFileCount) && numericFileCount >= 0) {
        existing.fileCount = Math.max(existing.fileCount ?? 0, Math.trunc(numericFileCount))
      }
      continue
    }

    const numericFileCount = Number(record.fileCount)
    entryByTagKey.set(tagKey, {
      key: normalized.key,
      value: normalized.value,
      sources: new Set([normalized.source]),
      hasMetaAnnotation: normalized.source === META_ANNOTATION_SOURCE,
      fileCount: Number.isFinite(numericFileCount) && numericFileCount >= 0 ? Math.trunc(numericFileCount) : undefined,
    })
  }

  const options: AnnotationFilterTagOption[] = []
  for (const [tagKey, entry] of entryByTagKey.entries()) {
    const sources = toSortedSources(entry.sources)
    options.push({
      tagKey,
      key: entry.key,
      value: entry.value,
      sources,
      hasMetaAnnotation: entry.hasMetaAnnotation,
      representativeSource: getRepresentativeSource(sources),
      fileCount: entry.fileCount,
    })
  }

  options.sort((left, right) => compareLogicalIdentity(left, right))
  return options
}

function applyDerivedSnapshotFields(snapshot: RootAnnotationDisplaySnapshot) {
  const tagKeysByPath: Record<string, string[]> = {}
  for (const [relativePath, rawTags] of Object.entries(snapshot.rawTagsByPath)) {
    const logicalTags = buildLogicalTags(rawTags)
    if (logicalTags.length === 0) continue
    tagKeysByPath[relativePath] = logicalTags.map((item) => item.tagKey)
  }

  snapshot.tagKeysByPath = tagKeysByPath
  snapshot.tagOptions = buildFilterTagOptions(snapshot.rawTagsByPath)
  snapshot.hasAnyFilterableAnnotation = snapshot.tagOptions.length > 0
}

function ensureRootSnapshot(rootId: string): RootAnnotationDisplaySnapshot {
  const existing = rootSnapshots.get(rootId)
  if (existing) return existing

  const next: RootAnnotationDisplaySnapshot = {
    status: 'idle',
    rawTagsByPath: {},
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
  snapshot.rawTagsByPath = {}
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

function readTagOptionsFromResult(rawResult: unknown): GatewayTagOptionRecord[] {
  if (Array.isArray(rawResult)) {
    return rawResult.filter((item): item is GatewayTagOptionRecord => isRecord(item))
  }
  if (!isRecord(rawResult)) return []
  if (Array.isArray(rawResult.items)) {
    return rawResult.items.filter((item): item is GatewayTagOptionRecord => isRecord(item))
  }
  if (Array.isArray(rawResult.options)) {
    return rawResult.options.filter((item): item is GatewayTagOptionRecord => isRecord(item))
  }
  return []
}

interface ResolvedAnnotationTarget {
  remoteRootId: string | null
  rootPath: string | null
}

function resolveAnnotationTarget(
  rootId: string,
  rootHandle: FileSystemDirectoryHandle | null,
  rootLabel?: string | null
): ResolvedAnnotationTarget {
  if (isRemoteReadonlyProviderActive()) {
    const remoteWorkspace = getActiveRemoteWorkspace()
    if (remoteWorkspace?.uiRootId === rootId) {
      return {
        remoteRootId: remoteWorkspace.configRootId,
        rootPath: null,
      }
    }
  }

  const resolvedRootPath = ensureRootPath({
    rootLabel: rootLabel || rootHandle?.name || 'current-folder',
    rootId,
    promptIfMissing: false,
  })

  return {
    remoteRootId: null,
    rootPath: resolvedRootPath,
  }
}

async function loadAllTagViews(target: ResolvedAnnotationTarget): Promise<GatewayFileTagView[]> {
  let page = 1
  let total = Number.POSITIVE_INFINITY
  const items: GatewayFileTagView[] = []

  while (items.length < total) {
    const result = target.remoteRootId
      ? await callRemoteGatewayHttp<GatewayTagQueryResult>('/v1/remote/tags/query', {
        rootId: target.remoteRootId,
        page,
        size: TAG_QUERY_PAGE_SIZE,
        includeTagKeys: [],
        excludeTagKeys: [],
        includeMatchMode: 'or',
      })
      : await callGatewayHttp<GatewayTagQueryResult>('/v1/data/tags/query', {
        rootPath: target.rootPath,
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

function buildPathSnapshotFromTagViews(tagViews: GatewayFileTagView[]) {
  const rawTagsByPath: Record<string, StoredTagRecord[]> = {}
  const byPathUpdatedAt: Record<string, number> = {}

  for (const view of tagViews) {
    const relativePath = typeof view.relativePath === 'string'
      ? normalizeRelativePath(view.relativePath)
      : ''
    if (!relativePath) continue

    const rawTags = (Array.isArray(view.tags) ? view.tags : [])
      .map((tag) => normalizeStoredTagRecord(tag))
      .filter((tag): tag is StoredTagRecord => tag !== null)

    if (rawTags.length === 0) continue

    rawTagsByPath[relativePath] = rawTags
    byPathUpdatedAt[relativePath] = computeUpdatedAt(rawTags)
  }

  return {
    rawTagsByPath,
    byPathUpdatedAt,
  }
}

function buildPathStateFromTags(tags: unknown[]): {
  rawTags: StoredTagRecord[] | null
  updatedAt: number | null
} {
  const rawTags = tags
    .map((tag) => normalizeStoredTagRecord(tag))
    .filter((tag): tag is StoredTagRecord => tag !== null)

  if (rawTags.length === 0) {
    return {
      rawTags: null,
      updatedAt: null,
    }
  }

  return {
    rawTags,
    updatedAt: computeUpdatedAt(rawTags),
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
    rawTags: StoredTagRecord[] | null
    updatedAt: number | null
  }
) {
  if (!state.rawTags || state.rawTags.length === 0) {
    snapshot.rawTagsByPath = removeRecordKey(snapshot.rawTagsByPath, relativePath)
    snapshot.byPathUpdatedAt = removeRecordKey(snapshot.byPathUpdatedAt, relativePath)
    return
  }

  snapshot.rawTagsByPath = {
    ...snapshot.rawTagsByPath,
    [relativePath]: state.rawTags,
  }
  snapshot.byPathUpdatedAt = {
    ...snapshot.byPathUpdatedAt,
    [relativePath]: state.updatedAt ?? 0,
  }
}

function createFileLoadKey(rootId: string, relativePath: string): string {
  return `${rootId}:${relativePath}`
}

function updateSnapshotForOptimisticMutation(snapshot: RootAnnotationDisplaySnapshot) {
  snapshot.hasSidecarDir = true
  snapshot.hasSidecarFile = true
  snapshot.status = 'ready'
  if (snapshot.loadedAtMs === null) {
    snapshot.loadedAtMs = Date.now()
  }
}

function createPathRollback(snapshot: RootAnnotationDisplaySnapshot, relativePath: string): () => void {
  const previousRawTags = snapshot.rawTagsByPath[relativePath]
    ? snapshot.rawTagsByPath[relativePath].map((tag) => ({ ...tag }))
    : null
  const previousUpdatedAt = snapshot.byPathUpdatedAt[relativePath]
  const hadUpdatedAt = relativePath in snapshot.byPathUpdatedAt

  return () => {
    if (!previousRawTags || previousRawTags.length === 0) {
      snapshot.rawTagsByPath = removeRecordKey(snapshot.rawTagsByPath, relativePath)
      snapshot.byPathUpdatedAt = hadUpdatedAt
        ? {
          ...snapshot.byPathUpdatedAt,
          [relativePath]: previousUpdatedAt,
        }
        : removeRecordKey(snapshot.byPathUpdatedAt, relativePath)
    } else {
      snapshot.rawTagsByPath = {
        ...snapshot.rawTagsByPath,
        [relativePath]: previousRawTags,
      }
      snapshot.byPathUpdatedAt = {
        ...snapshot.byPathUpdatedAt,
        [relativePath]: previousUpdatedAt,
      }
    }

    updateSnapshotForOptimisticMutation(snapshot)
    applyDerivedSnapshotFields(snapshot)
    emitStoreUpdate()
  }
}

export async function preloadAnnotationDisplaySnapshot({
  rootId,
  rootHandle,
  rootLabel,
  force = false,
}: PreloadAnnotationDisplaySnapshotParams): Promise<void> {
  if (!rootId) return

  const snapshot = ensureRootSnapshot(rootId)
  if (!force && snapshot.status === 'ready') return
  if (!force && snapshot.inflight) {
    await snapshot.inflight
    return
  }

  snapshot.status = 'loading'
  emitStoreUpdate()

  const loadTask = (async () => {
    const targetDescriptor = resolveAnnotationTarget(rootId, rootHandle, rootLabel)
    const target = ensureRootSnapshot(rootId)

    if (!targetDescriptor.rootPath && !targetDescriptor.remoteRootId) {
      resetSnapshot(target)
      target.hasSidecarDir = false
      target.hasSidecarFile = false
      target.status = 'ready'
      target.loadedAtMs = Date.now()
      return
    }

    try {
      const views = await loadAllTagViews(targetDescriptor)
      const derived = buildPathSnapshotFromTagViews(views)
      target.rawTagsByPath = derived.rawTagsByPath
      target.byPathUpdatedAt = derived.byPathUpdatedAt
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
  rootLabel,
  relativePath,
  force = false,
}: PreloadFileAnnotationDisplaySnapshotParams): Promise<void> {
  if (!rootId) return

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return

  const snapshot = ensureRootSnapshot(rootId)
  if (!force && normalizedPath in snapshot.rawTagsByPath) {
    return
  }

  const targetDescriptor = resolveAnnotationTarget(rootId, rootHandle, rootLabel)
  if (!targetDescriptor.rootPath && !targetDescriptor.remoteRootId) return

  const loadKey = createFileLoadKey(rootId, normalizedPath)
  if (!force) {
    const inflight = fileInflightLoads.get(loadKey)
    if (inflight) {
      await inflight
      return
    }
  }

  const loadTask = (async () => {
    const result = targetDescriptor.remoteRootId
      ? await callRemoteGatewayHttp<GatewayFileTagResult>('/v1/remote/tags/file', {
        rootId: targetDescriptor.remoteRootId,
        relativePath: normalizedPath,
      })
      : await callGatewayHttp<GatewayFileTagResult>('/v1/data/tags/file', {
        rootPath: targetDescriptor.rootPath,
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

export async function preloadGlobalAnnotationTagOptions({
  force = false,
}: PreloadGlobalAnnotationTagOptionsParams = {}): Promise<void> {
  if (!force && globalTagOptionsSnapshot.status === 'ready' && globalTagOptionsSnapshot.error === null) return
  if (!force && globalTagOptionsSnapshot.inflight) {
    await globalTagOptionsSnapshot.inflight
    return
  }

  globalTagOptionsSnapshot.status = 'loading'
  globalTagOptionsSnapshot.error = null
  emitStoreUpdate()

  const loadTask = (async () => {
    try {
      const result = isRemoteReadonlyProviderActive() && getActiveRemoteWorkspace()
        ? await callRemoteGatewayHttp<GatewayTagOptionsResult>('/v1/remote/tags/options', {
          rootId: getActiveRemoteWorkspace()!.configRootId,
        })
        : await callGatewayHttp<GatewayTagOptionsResult>('/v1/data/tags/options', {})
      const rawOptions = readTagOptionsFromResult(result)
      globalTagOptionsSnapshot.options = buildGlobalTagOptions(rawOptions)
      globalTagOptionsSnapshot.error = null
      globalTagOptionsSnapshot.status = 'ready'
      globalTagOptionsSnapshot.loadedAtMs = Date.now()
    } catch (error) {
      globalTagOptionsSnapshot.options = []
      globalTagOptionsSnapshot.error = error instanceof Error ? error.message : '读取标签候选失败'
      globalTagOptionsSnapshot.status = 'ready'
      globalTagOptionsSnapshot.loadedAtMs = Date.now()
    }
  })()
    .finally(() => {
      globalTagOptionsSnapshot.inflight = null
      emitStoreUpdate()
    })

  globalTagOptionsSnapshot.inflight = loadTask
  await loadTask
}

export function patchAnnotationSetValue(params: PatchAnnotationSetValueParams) {
  const rootId = params.rootId
  if (!rootId) return

  const relativePath = normalizeRelativePath(params.relativePath)
  const key = params.fieldKey.trim()
  const value = params.value.trim()
  if (!relativePath || !key || !value) return

  const snapshot = ensureRootSnapshot(rootId)
  const existingRawTags = snapshot.rawTagsByPath[relativePath] ?? []
  const nextUpdatedAt = Date.now()
  const retainedRawTags = existingRawTags.filter((tag) => !(
    tag.source === META_ANNOTATION_SOURCE
    && tag.key === key
  ))

  const nextRawTags: StoredTagRecord[] = [
    ...retainedRawTags,
    {
      key,
      value,
      source: META_ANNOTATION_SOURCE,
      appliedAt: nextUpdatedAt,
      updatedAt: nextUpdatedAt,
    },
  ]

  snapshot.rawTagsByPath = {
    ...snapshot.rawTagsByPath,
    [relativePath]: nextRawTags,
  }
  snapshot.byPathUpdatedAt = {
    ...snapshot.byPathUpdatedAt,
    [relativePath]: nextUpdatedAt,
  }
  updateSnapshotForOptimisticMutation(snapshot)
  applyDerivedSnapshotFields(snapshot)
  emitStoreUpdate()
}

export function patchAnnotationTagBinding(params: PatchAnnotationTagBindingParams): PatchRollback {
  const rootId = params.rootId
  if (!rootId) return null

  const relativePath = normalizeRelativePath(params.relativePath)
  const key = params.key.trim()
  const value = params.value.trim()
  if (!relativePath || !key || !value) return null

  const snapshot = ensureRootSnapshot(rootId)
  const existingRawTags = snapshot.rawTagsByPath[relativePath] ?? []
  const alreadyBound = existingRawTags.some((tag) => (
    tag.source === META_ANNOTATION_SOURCE
    && tag.key === key
    && tag.value === value
  ))
  if (alreadyBound) return null

  const rollback = createPathRollback(snapshot, relativePath)
  const nextUpdatedAt = Date.now()
  const nextRawTags: StoredTagRecord[] = [
    ...existingRawTags,
    {
      key,
      value,
      source: META_ANNOTATION_SOURCE,
      appliedAt: nextUpdatedAt,
      updatedAt: nextUpdatedAt,
    },
  ]

  snapshot.rawTagsByPath = {
    ...snapshot.rawTagsByPath,
    [relativePath]: nextRawTags,
  }
  snapshot.byPathUpdatedAt = {
    ...snapshot.byPathUpdatedAt,
    [relativePath]: nextUpdatedAt,
  }
  updateSnapshotForOptimisticMutation(snapshot)
  applyDerivedSnapshotFields(snapshot)
  emitStoreUpdate()
  return rollback
}

export function patchAnnotationTagUnbinding(params: PatchAnnotationTagBindingParams): PatchRollback {
  const rootId = params.rootId
  if (!rootId) return null

  const relativePath = normalizeRelativePath(params.relativePath)
  const key = params.key.trim()
  const value = params.value.trim()
  if (!relativePath || !key || !value) return null

  const snapshot = ensureRootSnapshot(rootId)
  const existingRawTags = snapshot.rawTagsByPath[relativePath] ?? []
  const nextRawTags = existingRawTags.filter((tag) => !(
    tag.source === META_ANNOTATION_SOURCE
    && tag.key === key
    && tag.value === value
  ))

  if (nextRawTags.length === existingRawTags.length) {
    return null
  }

  const rollback = createPathRollback(snapshot, relativePath)
  if (nextRawTags.length === 0) {
    snapshot.rawTagsByPath = removeRecordKey(snapshot.rawTagsByPath, relativePath)
    snapshot.byPathUpdatedAt = removeRecordKey(snapshot.byPathUpdatedAt, relativePath)
  } else {
    snapshot.rawTagsByPath = {
      ...snapshot.rawTagsByPath,
      [relativePath]: nextRawTags,
    }
    snapshot.byPathUpdatedAt = {
      ...snapshot.byPathUpdatedAt,
      [relativePath]: computeUpdatedAt(nextRawTags),
    }
  }

  updateSnapshotForOptimisticMutation(snapshot)
  applyDerivedSnapshotFields(snapshot)
  emitStoreUpdate()
  return rollback
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

export function isAnnotationFilterUiGateResolved(rootId: string | null | undefined): boolean {
  if (!rootId) return false
  const snapshot = rootSnapshots.get(rootId)
  return snapshot?.status === 'ready'
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
  return snapshot.tagOptions.map((item) => ({
    ...item,
    sources: [...item.sources],
  }))
}

export function getGlobalAnnotationTagOptions(): AnnotationFilterTagOption[] {
  return globalTagOptionsSnapshot.options.map((item) => ({
    ...item,
    sources: [...item.sources],
  }))
}

export function getGlobalAnnotationTagOptionsState(): GlobalAnnotationTagOptionsState {
  return {
    status: globalTagOptionsSnapshot.status,
    error: globalTagOptionsSnapshot.error,
  }
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

  return [...(snapshot.tagKeysByPath[normalizedPath] ?? [])]
}

export function getFileLogicalTags(
  rootId: string | null | undefined,
  relativePath: string | null | undefined
): AnnotationLogicalTag[] {
  if (!rootId || !relativePath) return []

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return []

  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return []

  const rawTags = snapshot.rawTagsByPath[normalizedPath]
  if (!rawTags) return []

  return buildLogicalTags(rawTags).map((tag) => ({
    ...tag,
    sources: [...tag.sources],
  }))
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

export function getAnnotationFilterTagIdentity(tagKey: string): { key: string; value: string } | null {
  return parseAnnotationFilterTagKey(tagKey)
}
