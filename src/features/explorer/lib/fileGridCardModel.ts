import { getFilePreviewKind } from '../../../lib/filePreview.ts'
import type { FileItem, FilePreviewKind, ThumbnailSizePreset } from '../../../types/index.ts'

export type FileGridCardMediaType = 'image' | 'video'
export type FileGridCardRuntimeContentSource = 'local-root' | 'global-trash'
export type FileGridCardIconKind = 'folder' | 'image' | 'video' | 'file'
export type FileGridCardThumbnailState = 'placeholder' | 'loading' | 'ready' | 'failed'

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

interface ResolveFileGridCardThumbnailSourceUrlsParams {
  thumbnailPlan: Pick<
    FileGridCardThumbnailPlan,
    'runtimeContentSource' | 'runtimeImageThumbnail' | 'runtimeVideoThumbnail' | 'fileAccessThumbnail'
  >
  runtimeLocalFileContentUrl: string | null
  runtimeGlobalTrashFileContentUrl: string | null
  fileAccessThumbnailUrl: string | null
}

interface ResolveFileGridCardDisplayedThumbnailUrlParams {
  runtimeThumbnailUrl: string | null
  fileAccessThumbnailUrl: string | null
  generatedThumbnailUrl: string | null
  generatedThumbnailIdentity: string | null
  requestIdentity: string | null
  latestCachedThumbnailUrl: string | null
}

interface ResolveFileGridCardIconKindParams {
  isDirectory: boolean
  displayedThumbnailUrl: string | null
  previewKind: FilePreviewKind
}

interface ResolveFileGridCardThumbnailFrameViewParams {
  isDirectory: boolean
  displayedThumbnailUrl: string | null
  thumbnailState: FileGridCardThumbnailState
  previewKind: FilePreviewKind
  directoryBadgeLabel: string | null
}

export interface FileGridCardTextView {
  nameLabel: string
  nameTitle: string
  displayPathLabel: string | null
  displayPathTitle: string | null
  fileSizeLabel: string | null
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

export interface FileGridCardThumbnailSourceUrls {
  runtimeFileContentUrl: string | null
  runtimeThumbnailUrl: string | null
  runtimeVideoThumbnailSourceUrl: string | null
  fileAccessThumbnailUrl: string | null
  directThumbnailUrl: string | null
  hasDirectThumbnailSource: boolean
}

export interface FileGridCardThumbnailFrameView {
  content:
    | { kind: 'thumbnail'; url: string }
    | { kind: 'loading' }
    | { kind: 'icon'; iconKind: FileGridCardIconKind }
  showFailedBadge: boolean
  directoryBadgeLabel: string | null
}

export type FileGridCardThumbnailLoadPlan =
  | {
    kind: 'reset'
    thumbnailState: FileGridCardThumbnailState
    shouldClearGeneratedThumbnail: true
  }
  | {
    kind: 'direct-thumbnail'
    thumbnailState: FileGridCardThumbnailState
    shouldClearGeneratedThumbnail: boolean
  }
  | {
    kind: 'cached-thumbnail'
    thumbnailUrl: string
    thumbnailUrlIdentity: string
    thumbnailState: FileGridCardThumbnailState
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

export function resolveFileGridCardTextView(file: FileItem): FileGridCardTextView {
  const displayPathLabel = file.displayPath && file.displayPath !== file.name
    ? file.displayPath
    : null

  return {
    nameLabel: file.name,
    nameTitle: file.name,
    displayPathLabel,
    displayPathTitle: displayPathLabel,
    fileSizeLabel: file.kind === 'directory' ? null : formatFileGridCardFileSize(file.size),
  }
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

export function resolveFileGridCardThumbnailSourceUrls({
  thumbnailPlan,
  runtimeLocalFileContentUrl,
  runtimeGlobalTrashFileContentUrl,
  fileAccessThumbnailUrl,
}: ResolveFileGridCardThumbnailSourceUrlsParams): FileGridCardThumbnailSourceUrls {
  const runtimeFileContentUrl = resolveRuntimeFileContentUrl({
    runtimeContentSource: thumbnailPlan.runtimeContentSource,
    runtimeLocalFileContentUrl,
    runtimeGlobalTrashFileContentUrl,
  })
  const resolvedFileAccessThumbnailUrl = thumbnailPlan.fileAccessThumbnail
    ? fileAccessThumbnailUrl
    : null
  const runtimeThumbnailUrl = thumbnailPlan.runtimeImageThumbnail
    ? runtimeFileContentUrl
    : null
  const runtimeVideoThumbnailSourceUrl = thumbnailPlan.runtimeVideoThumbnail
    ? runtimeFileContentUrl
    : null
  const directThumbnailUrl = runtimeThumbnailUrl ?? resolvedFileAccessThumbnailUrl

  return {
    runtimeFileContentUrl,
    runtimeThumbnailUrl,
    runtimeVideoThumbnailSourceUrl,
    fileAccessThumbnailUrl: resolvedFileAccessThumbnailUrl,
    directThumbnailUrl,
    hasDirectThumbnailSource: Boolean(
      thumbnailPlan.runtimeImageThumbnail || thumbnailPlan.fileAccessThumbnail
    ),
  }
}

export function resolveFileGridCardDisplayedThumbnailUrl({
  runtimeThumbnailUrl,
  fileAccessThumbnailUrl,
  generatedThumbnailUrl,
  generatedThumbnailIdentity,
  requestIdentity,
  latestCachedThumbnailUrl,
}: ResolveFileGridCardDisplayedThumbnailUrlParams): string | null {
  if (runtimeThumbnailUrl) return runtimeThumbnailUrl
  if (fileAccessThumbnailUrl) return fileAccessThumbnailUrl
  if (
    requestIdentity &&
    generatedThumbnailIdentity === requestIdentity &&
    generatedThumbnailUrl
  ) {
    return generatedThumbnailUrl
  }
  return latestCachedThumbnailUrl
}

export function resolveFileGridCardIconKind({
  isDirectory,
  displayedThumbnailUrl,
  previewKind,
}: ResolveFileGridCardIconKindParams): FileGridCardIconKind | null {
  if (isDirectory) return 'folder'
  if (displayedThumbnailUrl) return null
  if (previewKind === 'image') return 'image'
  if (previewKind === 'video') return 'video'
  return 'file'
}

export function resolveFileGridCardThumbnailFrameView({
  isDirectory,
  displayedThumbnailUrl,
  thumbnailState,
  previewKind,
  directoryBadgeLabel,
}: ResolveFileGridCardThumbnailFrameViewParams): FileGridCardThumbnailFrameView {
  const resolvedDirectoryBadgeLabel = isDirectory ? directoryBadgeLabel : null

  if (displayedThumbnailUrl) {
    return {
      content: { kind: 'thumbnail', url: displayedThumbnailUrl },
      showFailedBadge: false,
      directoryBadgeLabel: resolvedDirectoryBadgeLabel,
    }
  }

  if (thumbnailState === 'loading') {
    return {
      content: { kind: 'loading' },
      showFailedBadge: false,
      directoryBadgeLabel: resolvedDirectoryBadgeLabel,
    }
  }

  return {
    content: {
      kind: 'icon',
      iconKind: resolveFileGridCardIconKind({
        isDirectory,
        displayedThumbnailUrl,
        previewKind,
      }) ?? 'file',
    },
    showFailedBadge: thumbnailState === 'failed' && !isDirectory,
    directoryBadgeLabel: resolvedDirectoryBadgeLabel,
  }
}

function resolveRuntimeFileContentUrl({
  runtimeContentSource,
  runtimeLocalFileContentUrl,
  runtimeGlobalTrashFileContentUrl,
}: {
  runtimeContentSource: FileGridCardRuntimeContentSource | null
  runtimeLocalFileContentUrl: string | null
  runtimeGlobalTrashFileContentUrl: string | null
}): string | null {
  if (runtimeContentSource === 'local-root') return runtimeLocalFileContentUrl
  if (runtimeContentSource === 'global-trash') return runtimeGlobalTrashFileContentUrl
  return null
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
