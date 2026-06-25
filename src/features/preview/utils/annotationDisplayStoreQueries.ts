import type { AnnotationFilterTagOption } from '@/types'
import {
  cloneGlobalAnnotationTagOptions,
  type GlobalAnnotationTagOptionsStatus,
} from '@/features/preview/lib/annotationGlobalTagOptionsModel'
import {
  resolveAnnotationFilterUiGate,
  type AnnotationFilterUiGateReason,
  type AnnotationFilterUiGateState,
} from '@/features/preview/lib/annotationDisplaySnapshotModel'
import {
  buildLogicalAnnotationTags as buildLogicalTags,
  normalizeAnnotationRelativePath as normalizeRelativePath,
  type AnnotationLogicalTag,
} from '@/features/preview/lib/annotationTagModel'
import {
  getGlobalAnnotationTagOptionsSnapshot,
  getRootSnapshot,
} from '@/features/preview/utils/annotationDisplayStoreState'

export interface GlobalAnnotationTagOptionsState {
  status: GlobalAnnotationTagOptionsStatus
  error: string | null
}

export function getAnnotationFilterUiGateState(rootId: string | null | undefined): AnnotationFilterUiGateState {
  if (!rootId) {
    return {
      hasSidecarDir: false,
      hasSidecarFile: false,
      hasAnyFilterableAnnotation: false,
    }
  }

  const snapshot = getRootSnapshot(rootId)
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
  return resolveAnnotationFilterUiGate(rootId ? getAnnotationFilterUiGateState(rootId) : null).isVisible
}

export function isAnnotationFilterUiGateResolved(rootId: string | null | undefined): boolean {
  if (!rootId) return false
  const snapshot = getRootSnapshot(rootId)
  return snapshot?.status === 'ready'
}

export function getAnnotationFilterUiGateReason(
  rootId: string | null | undefined
): AnnotationFilterUiGateReason | null {
  return resolveAnnotationFilterUiGate(rootId ? getAnnotationFilterUiGateState(rootId) : null).reason
}

export function getRootAnnotationFilterTagOptions(rootId: string | null | undefined): AnnotationFilterTagOption[] {
  if (!rootId) return []
  const snapshot = getRootSnapshot(rootId)
  if (!snapshot) return []
  return snapshot.tagOptions.map((item) => ({
    ...item,
    sources: [...item.sources],
  }))
}

export function getGlobalAnnotationTagOptions(): AnnotationFilterTagOption[] {
  return cloneGlobalAnnotationTagOptions(getGlobalAnnotationTagOptionsSnapshot().options)
}

export function getGlobalAnnotationTagOptionsState(): GlobalAnnotationTagOptionsState {
  const snapshot = getGlobalAnnotationTagOptionsSnapshot()
  return {
    status: snapshot.status,
    error: snapshot.error,
  }
}

export function getFileAnnotationTagKeys(
  rootId: string | null | undefined,
  relativePath: string | null | undefined
): string[] {
  if (!rootId || !relativePath) return []

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return []

  const snapshot = getRootSnapshot(rootId)
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

  const snapshot = getRootSnapshot(rootId)
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

  const snapshot = getRootSnapshot(rootId)
  if (!snapshot) return null

  const updatedAt = snapshot.byPathUpdatedAt[normalizedPath]
  if (!Number.isFinite(updatedAt)) return null
  return updatedAt
}
