import {
  getStoredAnnotationTagsUpdatedAt,
  META_ANNOTATION_SOURCE,
  type StoredAnnotationTagRecord,
} from './annotationTagModel.ts'

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
