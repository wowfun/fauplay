import type { AnnotationFilterTagOption } from '@/types'

export const META_ANNOTATION_SOURCE = 'meta.annotation'

export interface AnnotationLogicalTag {
  tagKey: string
  key: string
  value: string
  sources: string[]
  hasMetaAnnotation: boolean
  representativeSource: string
  updatedAt: number
}

export interface StoredAnnotationTagRecord {
  key: string
  value: string
  source: string
  appliedAt: number
  updatedAt: number
}

export interface AnnotationGatewayTagRecord {
  key?: string
  value?: string
  source?: string
  appliedAt?: number
  updatedAt?: number
}

export interface AnnotationGatewayTagOptionRecord extends AnnotationGatewayTagRecord {
  fileCount?: number
}

export interface AnnotationGatewayFileTagView {
  relativePath?: string
  tags?: AnnotationGatewayTagRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeAnnotationRelativePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

export function toAnnotationFilterTagKey(key: string, value: string): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

export function getAnnotationFilterTagIdentity(tagKey: string): { key: string; value: string } | null {
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

export function getStoredAnnotationTagsUpdatedAt(rawTags: StoredAnnotationTagRecord[]): number {
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

export function normalizeStoredAnnotationTagRecord(tag: unknown): StoredAnnotationTagRecord | null {
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

export function buildLogicalAnnotationTags(rawTags: StoredAnnotationTagRecord[]): AnnotationLogicalTag[] {
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

export function buildAnnotationFilterTagOptions(
  rawTagsByPath: Record<string, StoredAnnotationTagRecord[]>
): AnnotationFilterTagOption[] {
  const countByTagKey = new Map<string, number>()
  const entryByTagKey = new Map<string, {
    key: string
    value: string
    sources: Set<string>
    hasMetaAnnotation: boolean
  }>()

  for (const rawTags of Object.values(rawTagsByPath)) {
    const logicalTags = buildLogicalAnnotationTags(rawTags)
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

export function buildGlobalAnnotationTagOptions(
  optionRecords: AnnotationGatewayTagOptionRecord[]
): AnnotationFilterTagOption[] {
  const entryByTagKey = new Map<string, {
    key: string
    value: string
    sources: Set<string>
    hasMetaAnnotation: boolean
    fileCount?: number
  }>()

  for (const record of optionRecords) {
    const normalized = normalizeStoredAnnotationTagRecord(record)
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

export function readAnnotationTagViewsFromResult(rawResult: unknown): AnnotationGatewayFileTagView[] {
  if (!isRecord(rawResult)) return []
  if (!Array.isArray(rawResult.items)) return []
  return rawResult.items.filter((item): item is AnnotationGatewayFileTagView => isRecord(item))
}

export function readAnnotationTagOptionsFromResult(rawResult: unknown): AnnotationGatewayTagOptionRecord[] {
  if (Array.isArray(rawResult)) {
    return rawResult.filter((item): item is AnnotationGatewayTagOptionRecord => isRecord(item))
  }
  if (!isRecord(rawResult)) return []
  if (Array.isArray(rawResult.items)) {
    return rawResult.items.filter((item): item is AnnotationGatewayTagOptionRecord => isRecord(item))
  }
  if (Array.isArray(rawResult.options)) {
    return rawResult.options.filter((item): item is AnnotationGatewayTagOptionRecord => isRecord(item))
  }
  return []
}

export function buildAnnotationPathSnapshotFromTagViews(tagViews: AnnotationGatewayFileTagView[]) {
  const rawTagsByPath: Record<string, StoredAnnotationTagRecord[]> = {}
  const byPathUpdatedAt: Record<string, number> = {}

  for (const view of tagViews) {
    const relativePath = typeof view.relativePath === 'string'
      ? normalizeAnnotationRelativePath(view.relativePath)
      : ''
    if (!relativePath) continue

    const rawTags = (Array.isArray(view.tags) ? view.tags : [])
      .map((tag) => normalizeStoredAnnotationTagRecord(tag))
      .filter((tag): tag is StoredAnnotationTagRecord => tag !== null)

    if (rawTags.length === 0) continue

    rawTagsByPath[relativePath] = rawTags
    byPathUpdatedAt[relativePath] = getStoredAnnotationTagsUpdatedAt(rawTags)
  }

  return {
    rawTagsByPath,
    byPathUpdatedAt,
  }
}

export function buildAnnotationPathStateFromTags(tags: unknown[]): {
  rawTags: StoredAnnotationTagRecord[] | null
  updatedAt: number | null
} {
  const rawTags = tags
    .map((tag) => normalizeStoredAnnotationTagRecord(tag))
    .filter((tag): tag is StoredAnnotationTagRecord => tag !== null)

  if (rawTags.length === 0) {
    return {
      rawTags: null,
      updatedAt: null,
    }
  }

  return {
    rawTags,
    updatedAt: getStoredAnnotationTagsUpdatedAt(rawTags),
  }
}
