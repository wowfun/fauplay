import type { AnnotationFilterTagOption } from '../../../types/index.ts'
import {
  buildAnnotationPathSnapshotFromTagViews,
  buildAnnotationPathStateFromTags,
  getStoredAnnotationTagsUpdatedAt,
  META_ANNOTATION_SOURCE,
  type AnnotationFileTagView,
  type StoredAnnotationTagRecord,
} from './annotationTagModel.ts'
import {
  applyAnnotationPathState,
  deriveAnnotationDisplaySnapshotFields,
} from './annotationDisplayPathStateModel.ts'
import {
  buildOptimisticAnnotationTagBinding,
  buildOptimisticAnnotationTagUnbinding,
  type OptimisticAnnotationTagPatch,
} from './annotationOptimisticTagMutationModel.ts'

export {
  applyAnnotationPathState,
  deriveAnnotationDisplaySnapshotFields,
} from './annotationDisplayPathStateModel.ts'
export type {
  AnnotationDisplaySnapshotDerivedFields,
  AnnotationPathStatePatch,
  AnnotationPathTagState,
  ApplyAnnotationPathStateParams,
} from './annotationDisplayPathStateModel.ts'
export {
  resolveAnnotationFilterUiGate,
} from './annotationFilterUiGateModel.ts'
export type {
  AnnotationFilterUiGate,
  AnnotationFilterUiGateReason,
  AnnotationFilterUiGateState,
} from './annotationFilterUiGateModel.ts'
export {
  buildOptimisticAnnotationTagBinding,
  buildOptimisticAnnotationTagUnbinding,
} from './annotationOptimisticTagMutationModel.ts'
export type {
  OptimisticAnnotationTagBindingParams,
  OptimisticAnnotationTagPatch,
  OptimisticAnnotationTagUnbindingParams,
} from './annotationOptimisticTagMutationModel.ts'

export type AnnotationDisplaySnapshotStatus = 'idle' | 'loading' | 'ready'

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
  | { type: 'apply-root-tag-views'; tagViews: AnnotationFileTagView[]; nowMs: number }
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
