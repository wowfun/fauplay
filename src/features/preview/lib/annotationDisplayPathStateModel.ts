import type { AnnotationFilterTagOption } from '../../../types/index.ts'
import {
  buildAnnotationFilterTagOptions,
  buildLogicalAnnotationTags,
  type StoredAnnotationTagRecord,
} from './annotationTagModel.ts'

export interface AnnotationDisplaySnapshotDerivedFields {
  tagKeysByPath: Record<string, string[]>
  tagOptions: AnnotationFilterTagOption[]
  hasAnyFilterableAnnotation: boolean
}

export interface AnnotationPathTagState {
  rawTags: StoredAnnotationTagRecord[] | null
  updatedAt: number | null
}

export interface ApplyAnnotationPathStateParams {
  rawTagsByPath: Record<string, StoredAnnotationTagRecord[]>
  byPathUpdatedAt: Record<string, number>
  relativePath: string
  state: AnnotationPathTagState
}

export interface AnnotationPathStatePatch {
  rawTagsByPath: Record<string, StoredAnnotationTagRecord[]>
  byPathUpdatedAt: Record<string, number>
}

export function deriveAnnotationDisplaySnapshotFields(
  rawTagsByPath: Record<string, StoredAnnotationTagRecord[]>
): AnnotationDisplaySnapshotDerivedFields {
  const tagKeysByPath: Record<string, string[]> = {}
  for (const [relativePath, rawTags] of Object.entries(rawTagsByPath)) {
    const logicalTags = buildLogicalAnnotationTags(rawTags)
    if (logicalTags.length === 0) continue
    tagKeysByPath[relativePath] = logicalTags.map((item) => item.tagKey)
  }

  const tagOptions = buildAnnotationFilterTagOptions(rawTagsByPath)
  return {
    tagKeysByPath,
    tagOptions,
    hasAnyFilterableAnnotation: tagOptions.length > 0,
  }
}

export function applyAnnotationPathState({
  rawTagsByPath,
  byPathUpdatedAt,
  relativePath,
  state,
}: ApplyAnnotationPathStateParams): AnnotationPathStatePatch {
  if (!state.rawTags || state.rawTags.length === 0) {
    return {
      rawTagsByPath: removeRecordKey(rawTagsByPath, relativePath),
      byPathUpdatedAt: removeRecordKey(byPathUpdatedAt, relativePath),
    }
  }

  return {
    rawTagsByPath: {
      ...rawTagsByPath,
      [relativePath]: state.rawTags,
    },
    byPathUpdatedAt: {
      ...byPathUpdatedAt,
      [relativePath]: state.updatedAt ?? 0,
    },
  }
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
