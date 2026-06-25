import {
  createAnnotationDisplaySnapshotState,
  reduceAnnotationDisplaySnapshot,
  type AnnotationDisplayPathRollbackState,
  type AnnotationDisplaySnapshotAction,
  type AnnotationDisplaySnapshotState,
} from '@/features/preview/lib/annotationDisplaySnapshotModel'
import {
  createGlobalAnnotationTagOptionsState,
  type GlobalAnnotationTagOptionsSnapshot,
} from '@/features/preview/lib/annotationGlobalTagOptionsModel'

export interface RootAnnotationDisplaySnapshot extends AnnotationDisplaySnapshotState {
  inflight: Promise<void> | null
}

export interface GlobalAnnotationTagOptionsStoreSnapshot extends GlobalAnnotationTagOptionsSnapshot {
  inflight: Promise<void> | null
}

export type PatchRollback = (() => void) | null

const rootSnapshots = new Map<string, RootAnnotationDisplaySnapshot>()
const fileInflightLoads = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const globalTagOptionsSnapshot: GlobalAnnotationTagOptionsStoreSnapshot = {
  ...createGlobalAnnotationTagOptionsState(),
  inflight: null,
}
let storeVersion = 0

export function getRootSnapshot(rootId: string): RootAnnotationDisplaySnapshot | undefined {
  return rootSnapshots.get(rootId)
}

export function ensureRootSnapshot(rootId: string): RootAnnotationDisplaySnapshot {
  const existing = rootSnapshots.get(rootId)
  if (existing) return existing

  const next: RootAnnotationDisplaySnapshot = {
    ...createAnnotationDisplaySnapshotState(),
    inflight: null,
  }
  rootSnapshots.set(rootId, next)
  return next
}

export function getGlobalAnnotationTagOptionsSnapshot(): GlobalAnnotationTagOptionsStoreSnapshot {
  return globalTagOptionsSnapshot
}

export function getFileInflightLoad(loadKey: string): Promise<void> | undefined {
  return fileInflightLoads.get(loadKey)
}

export function setFileInflightLoad(loadKey: string, loadTask: Promise<void>): void {
  fileInflightLoads.set(loadKey, loadTask)
}

export function deleteFileInflightLoad(loadKey: string): void {
  fileInflightLoads.delete(loadKey)
}

export function emitStoreUpdate() {
  storeVersion += 1
  for (const listener of listeners) {
    listener()
  }
}

function assignRootSnapshotState(
  snapshot: RootAnnotationDisplaySnapshot,
  state: AnnotationDisplaySnapshotState,
) {
  snapshot.status = state.status
  snapshot.rawTagsByPath = state.rawTagsByPath
  snapshot.byPathUpdatedAt = state.byPathUpdatedAt
  snapshot.tagKeysByPath = state.tagKeysByPath
  snapshot.tagOptions = state.tagOptions
  snapshot.hasSidecarDir = state.hasSidecarDir
  snapshot.hasSidecarFile = state.hasSidecarFile
  snapshot.hasAnyFilterableAnnotation = state.hasAnyFilterableAnnotation
  snapshot.loadedAtMs = state.loadedAtMs
}

export function applyRootSnapshotAction(
  snapshot: RootAnnotationDisplaySnapshot,
  action: AnnotationDisplaySnapshotAction,
) {
  const reduction = reduceAnnotationDisplaySnapshot(snapshot, action)
  assignRootSnapshotState(snapshot, reduction.snapshot)
  return reduction
}

export function assignGlobalTagOptionsState(
  snapshot: GlobalAnnotationTagOptionsStoreSnapshot,
  state: GlobalAnnotationTagOptionsSnapshot,
) {
  snapshot.status = state.status
  snapshot.options = state.options
  snapshot.error = state.error
  snapshot.loadedAtMs = state.loadedAtMs
}

export function createPathRollback(
  snapshot: RootAnnotationDisplaySnapshot,
  rollback: AnnotationDisplayPathRollbackState,
): () => void {
  return () => {
    applyRootSnapshotAction(snapshot, {
      type: 'restore-path',
      rollback,
      nowMs: Date.now(),
    })
    emitStoreUpdate()
  }
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
