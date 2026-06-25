import type { AnnotationFilterTagOption } from '../../../types/index.ts'
import {
  buildAnnotationFilterTagOptions,
  buildLogicalAnnotationTags,
  getStoredAnnotationTagsUpdatedAt,
  META_ANNOTATION_SOURCE,
  type StoredAnnotationTagRecord,
} from './annotationTagModel.ts'

export interface AnnotationDisplaySnapshotDerivedFields {
  tagKeysByPath: Record<string, string[]>
  tagOptions: AnnotationFilterTagOption[]
  hasAnyFilterableAnnotation: boolean
}

export type AnnotationFilterUiGateReason =
  | 'no_root'
  | 'missing_sidecar_dir'
  | 'missing_sidecar_file'
  | 'no_filterable_annotations'

export interface AnnotationFilterUiGateState {
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  hasAnyFilterableAnnotation: boolean
}

export interface AnnotationFilterUiGate {
  isVisible: boolean
  reason: AnnotationFilterUiGateReason | null
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

export interface OptimisticAnnotationTagBindingParams {
  existingRawTags: StoredAnnotationTagRecord[]
  key: string
  value: string
  updatedAt: number
}

export interface OptimisticAnnotationTagUnbindingParams {
  existingRawTags: StoredAnnotationTagRecord[]
  key: string
  value: string
}

export interface OptimisticAnnotationTagPatch {
  changed: boolean
  rawTags: StoredAnnotationTagRecord[] | null
  updatedAt: number | null
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

export function resolveAnnotationFilterUiGate(
  gateState: AnnotationFilterUiGateState | null,
): AnnotationFilterUiGate {
  if (!gateState) {
    return {
      isVisible: false,
      reason: 'no_root',
    }
  }
  if (!gateState.hasSidecarDir) {
    return {
      isVisible: false,
      reason: 'missing_sidecar_dir',
    }
  }
  if (!gateState.hasSidecarFile) {
    return {
      isVisible: false,
      reason: 'missing_sidecar_file',
    }
  }
  if (!gateState.hasAnyFilterableAnnotation) {
    return {
      isVisible: false,
      reason: 'no_filterable_annotations',
    }
  }
  return {
    isVisible: true,
    reason: null,
  }
}

export function buildOptimisticAnnotationTagBinding({
  existingRawTags,
  key,
  value,
  updatedAt,
}: OptimisticAnnotationTagBindingParams): OptimisticAnnotationTagPatch {
  const alreadyBound = existingRawTags.some((tag) => (
    tag.source === META_ANNOTATION_SOURCE
    && tag.key === key
    && tag.value === value
  ))
  if (alreadyBound) {
    return {
      changed: false,
      rawTags: existingRawTags,
      updatedAt: getStoredAnnotationTagsUpdatedAt(existingRawTags),
    }
  }

  const rawTags = [
    ...existingRawTags,
    {
      key,
      value,
      source: META_ANNOTATION_SOURCE,
      appliedAt: updatedAt,
      updatedAt,
    },
  ]
  return {
    changed: true,
    rawTags,
    updatedAt,
  }
}

export function buildOptimisticAnnotationTagUnbinding({
  existingRawTags,
  key,
  value,
}: OptimisticAnnotationTagUnbindingParams): OptimisticAnnotationTagPatch {
  const rawTags = existingRawTags.filter((tag) => !(
    tag.source === META_ANNOTATION_SOURCE
    && tag.key === key
    && tag.value === value
  ))

  if (rawTags.length === existingRawTags.length) {
    return {
      changed: false,
      rawTags: existingRawTags,
      updatedAt: getStoredAnnotationTagsUpdatedAt(existingRawTags),
    }
  }

  if (rawTags.length === 0) {
    return {
      changed: true,
      rawTags: null,
      updatedAt: null,
    }
  }

  return {
    changed: true,
    rawTags,
    updatedAt: getStoredAnnotationTagsUpdatedAt(rawTags),
  }
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
