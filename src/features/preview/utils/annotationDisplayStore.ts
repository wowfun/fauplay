import { getActiveRemoteWorkspace, isRemoteReadonlyProviderActive } from '@/lib/accessState'
import {
  loadAnnotationFileTags,
  loadAnnotationTagViews,
  loadGlobalAnnotationTagOptionRecords,
} from '@/features/preview/lib/annotationTagQueryLoader'
import {
  reduceGlobalAnnotationTagOptions,
} from '@/features/preview/lib/annotationGlobalTagOptionsModel'
import {
  getAnnotationFilterTagIdentity as parseAnnotationFilterTagKey,
  normalizeAnnotationRelativePath as normalizeRelativePath,
} from '@/features/preview/lib/annotationTagModel'
import {
  assignGlobalTagOptionsState,
  applyRootSnapshotAction,
  deleteFileInflightLoad,
  emitStoreUpdate,
  ensureRootSnapshot,
  getFileInflightLoad,
  getGlobalAnnotationTagOptionsSnapshot,
  setFileInflightLoad,
} from '@/features/preview/utils/annotationDisplayStoreState'
import {
  callAnnotationHttp,
  resolveAnnotationTarget,
} from '@/features/preview/utils/annotationDisplayStoreTransport'

export type { AnnotationLogicalTag } from '@/features/preview/lib/annotationTagModel'
export { toAnnotationFilterTagKey } from '@/features/preview/lib/annotationTagModel'
export {
  getAnnotationDisplayStoreVersion,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStoreState'
export type { GlobalAnnotationTagOptionsState } from '@/features/preview/utils/annotationDisplayStoreQueries'
export {
  getAnnotationFilterUiGateReason,
  getAnnotationFilterUiGateState,
  getFileAnnotationTagKeys,
  getFileAnnotationUpdatedAt,
  getFileLogicalTags,
  getGlobalAnnotationTagOptions,
  getGlobalAnnotationTagOptionsState,
  getRootAnnotationFilterTagOptions,
  isAnnotationFilterUiGateResolved,
  isAnnotationFilterUiVisible,
} from '@/features/preview/utils/annotationDisplayStoreQueries'
export {
  patchAnnotationSetValue,
  patchAnnotationTagBinding,
  patchAnnotationTagUnbinding,
} from '@/features/preview/utils/annotationDisplayStorePatches'

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

function createFileLoadKey(rootId: string, relativePath: string): string {
  return `${rootId}:${relativePath}`
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
    const inflight = getFileInflightLoad(loadKey)
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
      deleteFileInflightLoad(loadKey)
    })

  setFileInflightLoad(loadKey, loadTask)
  await loadTask
}

export async function preloadGlobalAnnotationTagOptions({
  force = false,
}: PreloadGlobalAnnotationTagOptionsParams = {}): Promise<void> {
  const globalTagOptionsSnapshot = getGlobalAnnotationTagOptionsSnapshot()
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

export function getAnnotationFilterTagIdentity(tagKey: string): { key: string; value: string } | null {
  return parseAnnotationFilterTagKey(tagKey)
}
