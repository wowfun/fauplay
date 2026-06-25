import type { AnnotationFilterTagOption } from '../../../types/index.ts'
import {
  buildAnnotationFilterTagOptions,
  buildAnnotationPathSnapshotFromTagViews,
  buildAnnotationPathStateFromTags,
  buildLogicalAnnotationTags,
  getStoredAnnotationTagsUpdatedAt,
  META_ANNOTATION_SOURCE,
  type AnnotationGatewayFileTagView,
  type StoredAnnotationTagRecord,
} from './annotationTagModel.ts'

export type AnnotationDisplaySnapshotStatus = 'idle' | 'loading' | 'ready'

export interface AnnotationDisplaySnapshotDerivedFields {
  tagKeysByPath: Record<string, string[]>
  tagOptions: AnnotationFilterTagOption[]
  hasAnyFilterableAnnotation: boolean
}

export interface AnnotationDisplaySnapshotState {
  status: AnnotationDisplaySnapshotStatus
  rawTagsByPath: Record<string, StoredAnnotationTagRecord[]>
  byPathUpdatedAt: Record<string, number>
  tagKeysByPath: Record<string, string[]>
  tagOptions: AnnotationFilterTagOption[]
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  hasAnyFilterableAnnotation: boolean
  loadedAtMs: number | null
}

export interface AnnotationDisplayPathRollbackState {
  relativePath: string
  rawTags: StoredAnnotationTagRecord[] | null
  updatedAt: number | null
  hadUpdatedAt: boolean
}

export type AnnotationDisplaySnapshotAction =
  | { type: 'mark-loading' }
  | { type: 'mark-root-unavailable'; nowMs: number }
  | { type: 'apply-root-tag-views'; tagViews: AnnotationGatewayFileTagView[]; nowMs: number }
  | { type: 'apply-root-load-error'; nowMs: number }
  | { type: 'apply-file-tags'; relativePath: string; tags: unknown[]; nowMs: number }
  | { type: 'set-meta-value'; relativePath: string; key: string; value: string; nowMs: number }
  | { type: 'bind-meta-tag'; relativePath: string; key: string; value: string; nowMs: number }
  | { type: 'unbind-meta-tag'; relativePath: string; key: string; value: string; nowMs: number }
  | { type: 'restore-path'; rollback: AnnotationDisplayPathRollbackState | null | undefined; nowMs: number }

export interface AnnotationDisplaySnapshotReduction {
  snapshot: AnnotationDisplaySnapshotState
  changed: boolean
  rollback: AnnotationDisplayPathRollbackState | null
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

export function createAnnotationDisplaySnapshotState(
  overrides: Partial<AnnotationDisplaySnapshotState> = {}
): AnnotationDisplaySnapshotState {
  return withDerivedSnapshotFields({
    status: 'idle',
    rawTagsByPath: {},
    byPathUpdatedAt: {},
    tagKeysByPath: {},
    tagOptions: [],
    hasSidecarDir: false,
    hasSidecarFile: false,
    hasAnyFilterableAnnotation: false,
    loadedAtMs: null,
    ...overrides,
  })
}

export function reduceAnnotationDisplaySnapshot(
  snapshot: AnnotationDisplaySnapshotState,
  action: AnnotationDisplaySnapshotAction,
): AnnotationDisplaySnapshotReduction {
  switch (action.type) {
    case 'mark-loading':
      return changedReduction({
        ...snapshot,
        status: 'loading',
      })

    case 'mark-root-unavailable':
      return changedReduction(createAnnotationDisplaySnapshotState({
        status: 'ready',
        hasSidecarDir: false,
        hasSidecarFile: false,
        loadedAtMs: action.nowMs,
      }))

    case 'apply-root-tag-views': {
      const pathSnapshot = buildAnnotationPathSnapshotFromTagViews(action.tagViews)
      return changedReduction(withDerivedSnapshotFields({
        ...snapshot,
        rawTagsByPath: pathSnapshot.rawTagsByPath,
        byPathUpdatedAt: pathSnapshot.byPathUpdatedAt,
        hasSidecarDir: true,
        hasSidecarFile: true,
        status: 'ready',
        loadedAtMs: action.nowMs,
      }))
    }

    case 'apply-root-load-error':
      return changedReduction(createAnnotationDisplaySnapshotState({
        status: 'ready',
        hasSidecarDir: true,
        hasSidecarFile: false,
        loadedAtMs: action.nowMs,
      }))

    case 'apply-file-tags': {
      const pathPatch = applyAnnotationPathState({
        rawTagsByPath: snapshot.rawTagsByPath,
        byPathUpdatedAt: snapshot.byPathUpdatedAt,
        relativePath: action.relativePath,
        state: buildAnnotationPathStateFromTags(action.tags),
      })
      return changedReduction(withDerivedSnapshotFields({
        ...snapshot,
        rawTagsByPath: pathPatch.rawTagsByPath,
        byPathUpdatedAt: pathPatch.byPathUpdatedAt,
        hasSidecarDir: true,
        hasSidecarFile: true,
        status: snapshot.status === 'idle' ? 'ready' : snapshot.status,
        loadedAtMs: snapshot.status === 'idle' ? action.nowMs : snapshot.loadedAtMs,
      }))
    }

    case 'set-meta-value': {
      const normalized = normalizeSnapshotMutationInput(action)
      if (!normalized) return unchangedReduction(snapshot)

      const existingRawTags = snapshot.rawTagsByPath[normalized.relativePath] ?? []
      const retainedRawTags = existingRawTags.filter((tag) => !(
        tag.source === META_ANNOTATION_SOURCE
        && tag.key === normalized.key
      ))

      return changedReduction(applyOptimisticAnnotationPatch({
        snapshot,
        relativePath: normalized.relativePath,
        patch: buildOptimisticAnnotationTagBinding({
          existingRawTags: retainedRawTags,
          key: normalized.key,
          value: normalized.value,
          updatedAt: action.nowMs,
        }),
        nowMs: action.nowMs,
      }))
    }

    case 'bind-meta-tag': {
      const normalized = normalizeSnapshotMutationInput(action)
      if (!normalized) return unchangedReduction(snapshot)

      const existingRawTags = snapshot.rawTagsByPath[normalized.relativePath] ?? []
      const patch = buildOptimisticAnnotationTagBinding({
        existingRawTags,
        key: normalized.key,
        value: normalized.value,
        updatedAt: action.nowMs,
      })
      if (!patch.changed) return unchangedReduction(snapshot)

      return {
        snapshot: applyOptimisticAnnotationPatch({
          snapshot,
          relativePath: normalized.relativePath,
          patch,
          nowMs: action.nowMs,
        }),
        changed: true,
        rollback: createAnnotationDisplayPathRollback(snapshot, normalized.relativePath),
      }
    }

    case 'unbind-meta-tag': {
      const normalized = normalizeSnapshotMutationInput(action)
      if (!normalized) return unchangedReduction(snapshot)

      const existingRawTags = snapshot.rawTagsByPath[normalized.relativePath] ?? []
      const patch = buildOptimisticAnnotationTagUnbinding({
        existingRawTags,
        key: normalized.key,
        value: normalized.value,
      })
      if (!patch.changed) return unchangedReduction(snapshot)

      return {
        snapshot: applyOptimisticAnnotationPatch({
          snapshot,
          relativePath: normalized.relativePath,
          patch,
          nowMs: action.nowMs,
        }),
        changed: true,
        rollback: createAnnotationDisplayPathRollback(snapshot, normalized.relativePath),
      }
    }

    case 'restore-path':
      if (!action.rollback) return unchangedReduction(snapshot)
      return changedReduction(restoreAnnotationDisplayPathSnapshot(snapshot, action.rollback, action.nowMs))
  }
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

function withDerivedSnapshotFields(snapshot: AnnotationDisplaySnapshotState): AnnotationDisplaySnapshotState {
  const derivedFields = deriveAnnotationDisplaySnapshotFields(snapshot.rawTagsByPath)
  return {
    ...snapshot,
    tagKeysByPath: derivedFields.tagKeysByPath,
    tagOptions: derivedFields.tagOptions,
    hasAnyFilterableAnnotation: derivedFields.hasAnyFilterableAnnotation,
  }
}

function changedReduction(
  snapshot: AnnotationDisplaySnapshotState,
  rollback: AnnotationDisplayPathRollbackState | null = null
): AnnotationDisplaySnapshotReduction {
  return {
    snapshot,
    changed: true,
    rollback,
  }
}

function unchangedReduction(snapshot: AnnotationDisplaySnapshotState): AnnotationDisplaySnapshotReduction {
  return {
    snapshot,
    changed: false,
    rollback: null,
  }
}

function normalizeSnapshotMutationInput(action: {
  relativePath: string
  key: string
  value: string
}): { relativePath: string; key: string; value: string } | null {
  const relativePath = action.relativePath
  const key = action.key.trim()
  const value = action.value.trim()
  if (!relativePath || !key || !value) return null
  return {
    relativePath,
    key,
    value,
  }
}

function createAnnotationDisplayPathRollback(
  snapshot: AnnotationDisplaySnapshotState,
  relativePath: string,
): AnnotationDisplayPathRollbackState {
  const previousRawTags = snapshot.rawTagsByPath[relativePath]
  const previousUpdatedAt = snapshot.byPathUpdatedAt[relativePath]

  return {
    relativePath,
    rawTags: previousRawTags ? cloneStoredAnnotationTags(previousRawTags) : null,
    updatedAt: Number.isFinite(previousUpdatedAt) ? previousUpdatedAt : null,
    hadUpdatedAt: relativePath in snapshot.byPathUpdatedAt,
  }
}

function applyOptimisticAnnotationPatch({
  snapshot,
  relativePath,
  patch,
  nowMs,
}: {
  snapshot: AnnotationDisplaySnapshotState
  relativePath: string
  patch: OptimisticAnnotationTagPatch
  nowMs: number
}): AnnotationDisplaySnapshotState {
  const pathPatch = applyAnnotationPathState({
    rawTagsByPath: snapshot.rawTagsByPath,
    byPathUpdatedAt: snapshot.byPathUpdatedAt,
    relativePath,
    state: patch,
  })

  return withDerivedSnapshotFields({
    ...snapshot,
    rawTagsByPath: pathPatch.rawTagsByPath,
    byPathUpdatedAt: pathPatch.byPathUpdatedAt,
    hasSidecarDir: true,
    hasSidecarFile: true,
    status: 'ready',
    loadedAtMs: snapshot.loadedAtMs ?? nowMs,
  })
}

function restoreAnnotationDisplayPathSnapshot(
  snapshot: AnnotationDisplaySnapshotState,
  rollback: AnnotationDisplayPathRollbackState,
  nowMs: number,
): AnnotationDisplaySnapshotState {
  const restoredRawTags = rollback.rawTags ? cloneStoredAnnotationTags(rollback.rawTags) : null
  const pathPatch = applyAnnotationPathState({
    rawTagsByPath: snapshot.rawTagsByPath,
    byPathUpdatedAt: snapshot.byPathUpdatedAt,
    relativePath: rollback.relativePath,
    state: {
      rawTags: restoredRawTags,
      updatedAt: restoredRawTags && restoredRawTags.length > 0
        ? rollback.updatedAt ?? getStoredAnnotationTagsUpdatedAt(restoredRawTags)
        : null,
    },
  })

  let byPathUpdatedAt = pathPatch.byPathUpdatedAt
  if ((!restoredRawTags || restoredRawTags.length === 0) && rollback.hadUpdatedAt && rollback.updatedAt !== null) {
    byPathUpdatedAt = {
      ...byPathUpdatedAt,
      [rollback.relativePath]: rollback.updatedAt,
    }
  }

  return withDerivedSnapshotFields({
    ...snapshot,
    rawTagsByPath: pathPatch.rawTagsByPath,
    byPathUpdatedAt,
    hasSidecarDir: true,
    hasSidecarFile: true,
    status: 'ready',
    loadedAtMs: snapshot.loadedAtMs ?? nowMs,
  })
}

function cloneStoredAnnotationTags(rawTags: StoredAnnotationTagRecord[]): StoredAnnotationTagRecord[] {
  return rawTags.map((tag) => ({ ...tag }))
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
