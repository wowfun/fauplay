import { listReviewFaces, type FaceApiContext } from '@/features/faces/api'
import type { FaceRecord, FaceReviewBucket } from '@/features/faces/types'
import {
  ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY,
  ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY,
  type AnnotationFilterTagOption,
} from '@/types'

const REVIEW_PAGE_SIZE = 500

type RootSnapshotStatus = 'idle' | 'loading' | 'ready'

interface RootReviewFilterTagSnapshot {
  status: RootSnapshotStatus
  tagKeysByPath: Record<string, string[]>
  tagOptions: AnnotationFilterTagOption[]
  inflight: Promise<void> | null
  loadedAtMs: number | null
}

const rootSnapshots = new Map<string, RootReviewFilterTagSnapshot>()
const listeners = new Set<() => void>()
let storeVersion = 0

function emitStoreUpdate(): void {
  storeVersion += 1
  for (const listener of listeners) {
    listener()
  }
}

function ensureRootSnapshot(rootId: string): RootReviewFilterTagSnapshot {
  const existing = rootSnapshots.get(rootId)
  if (existing) return existing

  const next: RootReviewFilterTagSnapshot = {
    status: 'idle',
    tagKeysByPath: {},
    tagOptions: [],
    inflight: null,
    loadedAtMs: null,
  }
  rootSnapshots.set(rootId, next)
  return next
}

function resetSnapshot(snapshot: RootReviewFilterTagSnapshot): void {
  snapshot.tagKeysByPath = {}
  snapshot.tagOptions = []
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:[\\/]/.test(path)
}

function normalizeReviewAssetPath(assetPath: string | null | undefined): string | null {
  const rawPath = assetPath?.trim()
  if (!rawPath) return null

  const slashPath = rawPath.replace(/\\/g, '/')
  if (isAbsolutePathLike(slashPath)) return null

  const normalizedPath = normalizeRelativePath(slashPath)
  if (!normalizedPath) return null
  if (normalizedPath.split('/').some((part) => part === '..')) return null
  return normalizedPath
}

function buildVirtualOption(tagKey: string, value: string, fileCount: number): AnnotationFilterTagOption {
  return {
    tagKey,
    key: '人物管理',
    value,
    sources: [],
    hasMetaAnnotation: false,
    representativeSource: '',
    fileCount,
  }
}

function buildSnapshotData(reviewFacesByBucket: Record<FaceReviewBucket, FaceRecord[]>): {
  tagKeysByPath: Record<string, string[]>
  tagOptions: AnnotationFilterTagOption[]
} {
  const tagKeysByPath = new Map<string, Set<string>>()
  const unassignedFilePathSet = new Set<string>()
  const ignoredFilePathSet = new Set<string>()

  const applyBucket = (bucket: FaceReviewBucket, faces: FaceRecord[]) => {
    const tagKey = bucket === 'unassigned'
      ? ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY
      : ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY
    const filePathSet = bucket === 'unassigned' ? unassignedFilePathSet : ignoredFilePathSet

    for (const face of faces) {
      const relativePath = normalizeReviewAssetPath(face.assetPath)
      if (!relativePath) continue

      filePathSet.add(relativePath)
      const existing = tagKeysByPath.get(relativePath) ?? new Set<string>()
      existing.add(tagKey)
      tagKeysByPath.set(relativePath, existing)
    }
  }

  applyBucket('unassigned', reviewFacesByBucket.unassigned)
  applyBucket('ignored', reviewFacesByBucket.ignored)

  const nextTagKeysByPath: Record<string, string[]> = {}
  for (const [relativePath, tagKeySet] of tagKeysByPath.entries()) {
    nextTagKeysByPath[relativePath] = [...tagKeySet]
  }

  const tagOptions: AnnotationFilterTagOption[] = []
  if (unassignedFilePathSet.size > 0) {
    tagOptions.push(
      buildVirtualOption(
        ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY,
        '未归属',
        unassignedFilePathSet.size,
      )
    )
  }
  if (ignoredFilePathSet.size > 0) {
    tagOptions.push(
      buildVirtualOption(
        ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY,
        '误检/忽略',
        ignoredFilePathSet.size,
      )
    )
  }

  return {
    tagKeysByPath: nextTagKeysByPath,
    tagOptions,
  }
}

async function loadAllReviewFaces(
  context: FaceApiContext,
  bucket: FaceReviewBucket
): Promise<FaceRecord[]> {
  const items: FaceRecord[] = []
  let page = 1

  while (true) {
    const batch = await listReviewFaces(context, {
      scope: 'root',
      bucket,
      page,
      size: REVIEW_PAGE_SIZE,
    })
    items.push(...batch)
    if (batch.length < REVIEW_PAGE_SIZE) {
      break
    }
    page += 1
    if (page > 10000) {
      break
    }
  }

  return items
}

export function subscribeReviewFilterTagStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getReviewFilterTagStoreVersion(): number {
  return storeVersion
}

export function isReviewFilterTagSnapshotReady(rootId: string | null | undefined): boolean {
  if (!rootId) return false
  return rootSnapshots.get(rootId)?.status === 'ready'
}

export function getRootReviewFilterTagOptions(rootId: string | null | undefined): AnnotationFilterTagOption[] {
  if (!rootId) return []
  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return []
  return snapshot.tagOptions.map((option) => ({
    ...option,
    sources: [...option.sources],
  }))
}

export function getFileReviewFilterTagKeys(
  rootId: string | null | undefined,
  relativePath: string | null | undefined,
): string[] {
  if (!rootId || !relativePath) return []

  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return []

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return []
  return [...(snapshot.tagKeysByPath[normalizedPath] ?? [])]
}

export async function preloadReviewFilterTagSnapshot({
  rootId,
  rootHandle,
  force = false,
}: FaceApiContext & { force?: boolean }): Promise<void> {
  if (!rootId) return

  const snapshot = ensureRootSnapshot(rootId)
  if (!force && snapshot.status === 'ready' && snapshot.loadedAtMs !== null) {
    return
  }
  if (snapshot.inflight) {
    return snapshot.inflight
  }

  snapshot.status = 'loading'
  emitStoreUpdate()

  const previousTagKeysByPath = snapshot.tagKeysByPath
  const previousTagOptions = snapshot.tagOptions

  const promise = (async () => {
    if (!rootHandle) {
      resetSnapshot(snapshot)
      snapshot.status = 'ready'
      snapshot.loadedAtMs = null
      return
    }

    try {
      const context: FaceApiContext = { rootHandle, rootId }
      const [unassignedFaces, ignoredFaces] = await Promise.all([
        loadAllReviewFaces(context, 'unassigned'),
        loadAllReviewFaces(context, 'ignored'),
      ])
      const { tagKeysByPath, tagOptions } = buildSnapshotData({
        unassigned: unassignedFaces,
        ignored: ignoredFaces,
      })

      snapshot.tagKeysByPath = tagKeysByPath
      snapshot.tagOptions = tagOptions
      snapshot.status = 'ready'
      snapshot.loadedAtMs = Date.now()
    } catch {
      snapshot.tagKeysByPath = previousTagKeysByPath
      snapshot.tagOptions = previousTagOptions
      snapshot.status = 'ready'
    }
  })()

  snapshot.inflight = promise
  try {
    await promise
  } finally {
    if (snapshot.inflight === promise) {
      snapshot.inflight = null
    }
    emitStoreUpdate()
  }
}
