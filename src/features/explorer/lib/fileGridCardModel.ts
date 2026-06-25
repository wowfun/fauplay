import { getFilePreviewKind } from '../../../lib/filePreview.ts'
import type { FileItem, FilePreviewKind, ThumbnailSizePreset } from '../../../types/index.ts'

export type FileGridCardMediaType = 'image' | 'video'
export type FileGridCardRuntimeContentSource = 'local-root' | 'global-trash'

interface ResolveFileGridCardDirectoryBadgeParams {
  file: FileItem
  loadedDirectoryItemCount: number | null
}

interface ResolveFileGridCardThumbnailPlanParams {
  file: FileItem
  rootHandleAvailable: boolean
  thumbnailSizePreset: ThumbnailSizePreset
}

interface ResolveFileGridCardThumbnailLoadPlanParams {
  rootHandleAvailable: boolean
  isDirectory: boolean
  mediaType: FileGridCardMediaType | null
  hasDirectThumbnailSource: boolean
  directThumbnailUrl: string | null
  requestIdentity: string | null
  previousRequestIdentity: string | null
  exactCachedThumbnailUrl: string | null
}

export interface FileGridCardDirectoryBadge {
  displayCount: number | null
  label: string | null
  shouldLoadDirectoryItemCount: boolean
}

export interface FileGridCardThumbnailPlan {
  isDirectory: boolean
  previewKind: FilePreviewKind
  mediaType: FileGridCardMediaType | null
  fileLastModifiedMs: number | undefined
  requestIdentity: string | null
  runtimeContentSource: FileGridCardRuntimeContentSource | null
  runtimeImageThumbnail: boolean
  runtimeVideoThumbnail: boolean
  fileAccessThumbnail: boolean
  pipelineThumbnail: boolean
}

export type FileGridCardThumbnailLoadPlan =
  | {
    kind: 'reset'
    thumbnailState: 'placeholder'
    shouldClearGeneratedThumbnail: true
  }
  | {
    kind: 'direct-thumbnail'
    thumbnailState: 'loading' | 'failed'
    shouldClearGeneratedThumbnail: boolean
  }
  | {
    kind: 'cached-thumbnail'
    thumbnailUrl: string
    thumbnailUrlIdentity: string
    thumbnailState: 'ready'
  }
  | {
    kind: 'pipeline-thumbnail'
    requestIdentity: string
    shouldClearGeneratedThumbnail: boolean
  }

export function formatFileGridCardFileSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function resolveFileGridCardDirectoryBadge({
  file,
  loadedDirectoryItemCount,
}: ResolveFileGridCardDirectoryBadgeParams): FileGridCardDirectoryBadge {
  if (file.kind !== 'directory') {
    return {
      displayCount: null,
      label: null,
      shouldLoadDirectoryItemCount: false,
    }
  }

  const listingDirectoryEntryCount = typeof file.entryCount === 'number' && Number.isFinite(file.entryCount)
    ? Math.max(0, Math.trunc(file.entryCount))
    : null
  const displayCount = listingDirectoryEntryCount ?? loadedDirectoryItemCount

  return {
    displayCount,
    label: displayCount === null ? null : formatFileGridDirectoryBadgeCount(displayCount),
    shouldLoadDirectoryItemCount: listingDirectoryEntryCount === null,
  }
}

export function resolveFileGridCardThumbnailPlan({
  file,
  rootHandleAvailable,
  thumbnailSizePreset,
}: ResolveFileGridCardThumbnailPlanParams): FileGridCardThumbnailPlan {
  const isDirectory = file.kind === 'directory'
  const previewKind = isDirectory ? 'unsupported' : getFilePreviewKind(file.name)
  const mediaType = previewKind === 'image' || previewKind === 'video' ? previewKind : null
  const fileLastModifiedMs = typeof file.lastModifiedMs === 'number'
    ? file.lastModifiedMs
    : file.lastModified?.getTime()
  const hasRemoteLocator = typeof file.remoteRootId === 'string' && file.remoteRootId.trim().length > 0
  const runtimeContentSource = resolveRuntimeContentSource({
    isDirectory,
    mediaType,
    hasRemoteLocator,
    rootHandleAvailable,
    sourceType: file.sourceType,
  })
  const runtimeImageThumbnail = mediaType === 'image' && runtimeContentSource !== null
  const runtimeVideoThumbnail = mediaType === 'video' && runtimeContentSource !== null
  const fileAccessThumbnail = Boolean(
    !isDirectory
    && mediaType === 'image'
    && (
      hasRemoteLocator ||
      (
        file.absolutePath
        && !runtimeImageThumbnail
        && (
          !rootHandleAvailable ||
          file.path === file.absolutePath ||
          file.sourceType === 'global_recycle'
        )
      )
    )
  )
  const requestIdentity = !isDirectory && mediaType
    ? [
      file.path,
      file.size ?? 'unknown-size',
      fileLastModifiedMs ?? 'unknown-modified',
      mediaType,
      thumbnailSizePreset,
    ].join('::')
    : null

  return {
    isDirectory,
    previewKind,
    mediaType,
    fileLastModifiedMs,
    requestIdentity,
    runtimeContentSource,
    runtimeImageThumbnail,
    runtimeVideoThumbnail,
    fileAccessThumbnail,
    pipelineThumbnail: Boolean(
      rootHandleAvailable &&
      !isDirectory &&
      mediaType &&
      !runtimeImageThumbnail &&
      !fileAccessThumbnail
    ),
  }
}

export function resolveFileGridCardThumbnailLoadPlan({
  rootHandleAvailable,
  isDirectory,
  mediaType,
  hasDirectThumbnailSource,
  directThumbnailUrl,
  requestIdentity,
  previousRequestIdentity,
  exactCachedThumbnailUrl,
}: ResolveFileGridCardThumbnailLoadPlanParams): FileGridCardThumbnailLoadPlan {
  if (!rootHandleAvailable || isDirectory) {
    if (hasDirectThumbnailSource) {
      return {
        kind: 'direct-thumbnail',
        thumbnailState: directThumbnailUrl ? 'loading' : 'failed',
        shouldClearGeneratedThumbnail: false,
      }
    }
    return resetThumbnailLoadPlan()
  }

  if (!mediaType) {
    return resetThumbnailLoadPlan()
  }

  if (hasDirectThumbnailSource) {
    return {
      kind: 'direct-thumbnail',
      thumbnailState: directThumbnailUrl ? 'loading' : 'failed',
      shouldClearGeneratedThumbnail: true,
    }
  }

  if (!requestIdentity) {
    return resetThumbnailLoadPlan()
  }

  if (exactCachedThumbnailUrl) {
    return {
      kind: 'cached-thumbnail',
      thumbnailUrl: exactCachedThumbnailUrl,
      thumbnailUrlIdentity: requestIdentity,
      thumbnailState: 'ready',
    }
  }

  return {
    kind: 'pipeline-thumbnail',
    requestIdentity,
    shouldClearGeneratedThumbnail: previousRequestIdentity !== requestIdentity,
  }
}

function formatFileGridDirectoryBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

function resetThumbnailLoadPlan(): FileGridCardThumbnailLoadPlan {
  return {
    kind: 'reset',
    thumbnailState: 'placeholder',
    shouldClearGeneratedThumbnail: true,
  }
}

function resolveRuntimeContentSource({
  isDirectory,
  mediaType,
  hasRemoteLocator,
  rootHandleAvailable,
  sourceType,
}: {
  isDirectory: boolean
  mediaType: FileGridCardMediaType | null
  hasRemoteLocator: boolean
  rootHandleAvailable: boolean
  sourceType?: string
}): FileGridCardRuntimeContentSource | null {
  if (isDirectory || !mediaType || hasRemoteLocator) return null
  if (rootHandleAvailable) return 'local-root'
  if (sourceType === 'global_recycle') return 'global-trash'
  return null
}
