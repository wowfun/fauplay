import { normalizeAnnotationRelativePath as normalizeRelativePath } from '@/features/preview/lib/annotationTagModel'
import {
  applyRootSnapshotAction,
  createPathRollback,
  emitStoreUpdate,
  ensureRootSnapshot,
  type PatchRollback,
} from '@/features/preview/utils/annotationDisplayStoreState'

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

export function patchAnnotationSetValue(params: PatchAnnotationSetValueParams) {
  const rootId = params.rootId
  if (!rootId) return

  const relativePath = normalizeRelativePath(params.relativePath)
  const key = params.fieldKey.trim()
  const value = params.value.trim()
  if (!relativePath || !key || !value) return

  const snapshot = ensureRootSnapshot(rootId)
  applyRootSnapshotAction(snapshot, {
    type: 'set-meta-value',
    relativePath,
    key,
    value,
    nowMs: Date.now(),
  })
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
  const reduction = applyRootSnapshotAction(snapshot, {
    type: 'bind-meta-tag',
    relativePath,
    key,
    value,
    nowMs: Date.now(),
  })
  if (!reduction.changed || !reduction.rollback) return null

  emitStoreUpdate()
  return createPathRollback(snapshot, reduction.rollback)
}

export function patchAnnotationTagUnbinding(params: PatchAnnotationTagBindingParams): PatchRollback {
  const rootId = params.rootId
  if (!rootId) return null

  const relativePath = normalizeRelativePath(params.relativePath)
  const key = params.key.trim()
  const value = params.value.trim()
  if (!relativePath || !key || !value) return null

  const snapshot = ensureRootSnapshot(rootId)
  const reduction = applyRootSnapshotAction(snapshot, {
    type: 'unbind-meta-tag',
    relativePath,
    key,
    value,
    nowMs: Date.now(),
  })
  if (!reduction.changed || !reduction.rollback) return null

  emitStoreUpdate()
  return createPathRollback(snapshot, reduction.rollback)
}
