import type { AnnotationFilterTagOption } from '@/types'
import { getActiveRemoteWorkspace, isRemoteReadonlyProviderActive } from '@/lib/accessState'
import { callRemoteAccessHttp } from '@/lib/remoteAccess'
import { ensureRootPath } from '@/lib/reveal'
import { callRuntimeHttp } from '@/lib/runtimeApi'
import {
  resolveAnnotationRequestTarget,
  type AnnotationHttpRequest,
  type AnnotationRequestTarget,
} from '@/features/preview/lib/annotationRequestPlanModel'
import {
  loadAnnotationFileTags,
  loadAnnotationTagViews,
  loadGlobalAnnotationTagOptionRecords,
} from '@/features/preview/lib/annotationTagQueryLoader'
import {
  cloneGlobalAnnotationTagOptions,
  createGlobalAnnotationTagOptionsState,
  reduceGlobalAnnotationTagOptions,
  type GlobalAnnotationTagOptionsSnapshot,
  type GlobalAnnotationTagOptionsStatus,
} from '@/features/preview/lib/annotationGlobalTagOptionsModel'
import {
  createAnnotationDisplaySnapshotState,
  reduceAnnotationDisplaySnapshot,
  resolveAnnotationFilterUiGate,
  type AnnotationDisplayPathRollbackState,
  type AnnotationDisplaySnapshotAction,
  type AnnotationDisplaySnapshotState,
  type AnnotationFilterUiGateReason,
  type AnnotationFilterUiGateState,
} from '@/features/preview/lib/annotationDisplaySnapshotModel'
import {
  buildLogicalAnnotationTags as buildLogicalTags,
  getAnnotationFilterTagIdentity as parseAnnotationFilterTagKey,
  normalizeAnnotationRelativePath as normalizeRelativePath,
} from '@/features/preview/lib/annotationTagModel'
import type {
  AnnotationLogicalTag,
} from '@/features/preview/lib/annotationTagModel'

export type { AnnotationLogicalTag } from '@/features/preview/lib/annotationTagModel'
export { toAnnotationFilterTagKey } from '@/features/preview/lib/annotationTagModel'

interface RootAnnotationDisplaySnapshot extends AnnotationDisplaySnapshotState {
  inflight: Promise<void> | null
}

interface GlobalAnnotationTagOptionsStoreSnapshot extends GlobalAnnotationTagOptionsSnapshot {
  inflight: Promise<void> | null
}

interface PreloadAnnotationDisplaySnapshotParams {
  rootId?: string | null
  rootHandle: FileSystemDirectoryHandle | null
  rootLabel?: string | null
  force?: boolean
}

interface PreloadFileAnnotationDisplaySnapshotParams {
  rootId?: string | null
  rootHandle: FileSystemDirectoryHandle | null
  rootLabel?: string | null
  relativePath: string
  force?: boolean
}

interface PreloadGlobalAnnotationTagOptionsParams {
  force?: boolean
}

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

type PatchRollback = (() => void) | null

export interface GlobalAnnotationTagOptionsState {
  status: GlobalAnnotationTagOptionsStatus
  error: string | null
}

const rootSnapshots = new Map<string, RootAnnotationDisplaySnapshot>()
const fileInflightLoads = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const globalTagOptionsSnapshot: GlobalAnnotationTagOptionsStoreSnapshot = {
  ...createGlobalAnnotationTagOptionsState(),
  inflight: null,
}
let storeVersion = 0

function ensureRootSnapshot(rootId: string): RootAnnotationDisplaySnapshot {
  const existing = rootSnapshots.get(rootId)
  if (existing) return existing

  const next: RootAnnotationDisplaySnapshot = {
    ...createAnnotationDisplaySnapshotState(),
    inflight: null,
  }
  rootSnapshots.set(rootId, next)
  return next
}

function emitStoreUpdate() {
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

function applyRootSnapshotAction(
  snapshot: RootAnnotationDisplaySnapshot,
  action: AnnotationDisplaySnapshotAction,
) {
  const reduction = reduceAnnotationDisplaySnapshot(snapshot, action)
  assignRootSnapshotState(snapshot, reduction.snapshot)
  return reduction
}

function assignGlobalTagOptionsState(
  snapshot: GlobalAnnotationTagOptionsStoreSnapshot,
  state: GlobalAnnotationTagOptionsSnapshot,
) {
  snapshot.status = state.status
  snapshot.options = state.options
  snapshot.error = state.error
  snapshot.loadedAtMs = state.loadedAtMs
}

function resolveAnnotationTarget(
  rootId: string,
  rootHandle: FileSystemDirectoryHandle | null,
  rootLabel?: string | null
): AnnotationRequestTarget {
  const remoteReadonlyActive = isRemoteReadonlyProviderActive()
  const activeRemoteWorkspace = getActiveRemoteWorkspace()
  const remoteTarget = resolveAnnotationRequestTarget({
    rootId,
    rootPath: null,
    remoteReadonlyActive,
    activeRemoteWorkspace,
  })
  if (remoteTarget.kind === 'remote') {
    return remoteTarget
  }

  const resolvedRootPath = ensureRootPath({
    rootLabel: rootLabel || rootHandle?.name || 'current-folder',
    rootId,
    promptIfMissing: false,
  })

  return resolveAnnotationRequestTarget({
    rootId,
    rootPath: resolvedRootPath,
    remoteReadonlyActive: false,
    activeRemoteWorkspace: null,
  })
}

function callAnnotationHttp<T>(request: AnnotationHttpRequest): Promise<T> {
  return request.transport === 'remote'
    ? callRemoteAccessHttp<T>(request.path, request.body)
    : callRuntimeHttp<T>(request.path, request.body)
}

function createFileLoadKey(rootId: string, relativePath: string): string {
  return `${rootId}:${relativePath}`
}

function createPathRollback(
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

export async function preloadAnnotationDisplaySnapshot({
  rootId,
  rootHandle,
  rootLabel,
  force = false,
}: PreloadAnnotationDisplaySnapshotParams): Promise<void> {
  if (!rootId) return

  const snapshot = ensureRootSnapshot(rootId)
  if (!force && snapshot.status === 'ready') return
  if (!force && snapshot.inflight) {
    await snapshot.inflight
    return
  }

  applyRootSnapshotAction(snapshot, { type: 'mark-loading' })
  emitStoreUpdate()

  const loadTask = (async () => {
    const targetDescriptor = resolveAnnotationTarget(rootId, rootHandle, rootLabel)
    const target = ensureRootSnapshot(rootId)

    if (targetDescriptor.kind === 'unavailable') {
      applyRootSnapshotAction(target, {
        type: 'mark-root-unavailable',
        nowMs: Date.now(),
      })
      return
    }

    try {
      const views = await loadAnnotationTagViews({
        target: targetDescriptor,
        callAnnotationHttp,
      })
      applyRootSnapshotAction(target, {
        type: 'apply-root-tag-views',
        tagViews: views,
        nowMs: Date.now(),
      })
    } catch {
      applyRootSnapshotAction(target, {
        type: 'apply-root-load-error',
        nowMs: Date.now(),
      })
    }
  })()
    .finally(() => {
      const target = ensureRootSnapshot(rootId)
      target.inflight = null
      emitStoreUpdate()
    })

  snapshot.inflight = loadTask
  await loadTask
}

export async function preloadFileAnnotationDisplaySnapshot({
  rootId,
  rootHandle,
  rootLabel,
  relativePath,
  force = false,
}: PreloadFileAnnotationDisplaySnapshotParams): Promise<void> {
  if (!rootId) return

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return

  const snapshot = ensureRootSnapshot(rootId)
  if (!force && normalizedPath in snapshot.rawTagsByPath) {
    return
  }

  const targetDescriptor = resolveAnnotationTarget(rootId, rootHandle, rootLabel)
  if (targetDescriptor.kind === 'unavailable') return

  const loadKey = createFileLoadKey(rootId, normalizedPath)
  if (!force) {
    const inflight = fileInflightLoads.get(loadKey)
    if (inflight) {
      await inflight
      return
    }
  }

  const loadTask = (async () => {
    const tags = await loadAnnotationFileTags({
      target: targetDescriptor,
      relativePath: normalizedPath,
      callAnnotationHttp,
    })

    const target = ensureRootSnapshot(rootId)
    applyRootSnapshotAction(target, {
      type: 'apply-file-tags',
      relativePath: normalizedPath,
      tags,
      nowMs: Date.now(),
    })
    emitStoreUpdate()
  })()
    .catch(() => {
      // Ignore per-file query failures to avoid blocking preview rendering.
    })
    .finally(() => {
      fileInflightLoads.delete(loadKey)
    })

  fileInflightLoads.set(loadKey, loadTask)
  await loadTask
}

export async function preloadGlobalAnnotationTagOptions({
  force = false,
}: PreloadGlobalAnnotationTagOptionsParams = {}): Promise<void> {
  if (!force && globalTagOptionsSnapshot.status === 'ready' && globalTagOptionsSnapshot.error === null) return
  if (!force && globalTagOptionsSnapshot.inflight) {
    await globalTagOptionsSnapshot.inflight
    return
  }

  assignGlobalTagOptionsState(
    globalTagOptionsSnapshot,
    reduceGlobalAnnotationTagOptions(globalTagOptionsSnapshot, { type: 'mark-loading' }),
  )
  emitStoreUpdate()

  const loadTask = (async () => {
    try {
      const optionRecords = await loadGlobalAnnotationTagOptionRecords({
        remoteReadonlyActive: isRemoteReadonlyProviderActive(),
        activeRemoteWorkspace: getActiveRemoteWorkspace(),
        callAnnotationHttp,
      })
      assignGlobalTagOptionsState(
        globalTagOptionsSnapshot,
        reduceGlobalAnnotationTagOptions(globalTagOptionsSnapshot, {
          type: 'apply-option-records',
          optionRecords,
          nowMs: Date.now(),
        }),
      )
    } catch (error) {
      assignGlobalTagOptionsState(
        globalTagOptionsSnapshot,
        reduceGlobalAnnotationTagOptions(globalTagOptionsSnapshot, {
          type: 'apply-error',
          error,
          nowMs: Date.now(),
        }),
      )
    }
  })()
    .finally(() => {
      globalTagOptionsSnapshot.inflight = null
      emitStoreUpdate()
    })

  globalTagOptionsSnapshot.inflight = loadTask
  await loadTask
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

export function getAnnotationFilterUiGateState(rootId: string | null | undefined): AnnotationFilterUiGateState {
  if (!rootId) {
    return {
      hasSidecarDir: false,
      hasSidecarFile: false,
      hasAnyFilterableAnnotation: false,
    }
  }

  const snapshot = rootSnapshots.get(rootId)
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
  const snapshot = rootSnapshots.get(rootId)
  return snapshot?.status === 'ready'
}

export function getAnnotationFilterUiGateReason(
  rootId: string | null | undefined
): AnnotationFilterUiGateReason | null {
  return resolveAnnotationFilterUiGate(rootId ? getAnnotationFilterUiGateState(rootId) : null).reason
}

export function getRootAnnotationFilterTagOptions(rootId: string | null | undefined): AnnotationFilterTagOption[] {
  if (!rootId) return []
  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return []
  return snapshot.tagOptions.map((item) => ({
    ...item,
    sources: [...item.sources],
  }))
}

export function getGlobalAnnotationTagOptions(): AnnotationFilterTagOption[] {
  return cloneGlobalAnnotationTagOptions(globalTagOptionsSnapshot.options)
}

export function getGlobalAnnotationTagOptionsState(): GlobalAnnotationTagOptionsState {
  return {
    status: globalTagOptionsSnapshot.status,
    error: globalTagOptionsSnapshot.error,
  }
}

export function getFileAnnotationTagKeys(
  rootId: string | null | undefined,
  relativePath: string | null | undefined
): string[] {
  if (!rootId || !relativePath) return []

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath) return []

  const snapshot = rootSnapshots.get(rootId)
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

  const snapshot = rootSnapshots.get(rootId)
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

  const snapshot = rootSnapshots.get(rootId)
  if (!snapshot) return null

  const updatedAt = snapshot.byPathUpdatedAt[normalizedPath]
  if (!Number.isFinite(updatedAt)) return null
  return updatedAt
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

export function getAnnotationFilterTagIdentity(tagKey: string): { key: string; value: string } | null {
  return parseAnnotationFilterTagKey(tagKey)
}
