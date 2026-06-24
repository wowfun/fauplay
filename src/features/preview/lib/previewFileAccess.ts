import { isAbsolutePathLike } from '../../../lib/runtimeApi/fileLocator.ts'
import type { RuntimeFileLocator } from '../../../lib/runtimeApi/types.ts'
import type { FileItem, FilePreviewKind } from '../../../types'

export type PreviewFileAccessKind =
  | 'file-access'
  | 'runtime-global-trash-text'
  | 'runtime-global-trash-content'
  | 'runtime-text-preview'
  | 'runtime-file-content'
  | 'file-system'
  | 'unavailable'

export interface PreviewFileAccessPlan {
  accessKind: PreviewFileAccessKind
  currentRootRelativePath: string
  hasRemoteFileLocator: boolean
  hasRuntimeFileLocator: boolean
  canAccessThroughCurrentRoot: boolean
  shouldUseFileAccess: boolean
  shouldUseRuntimeGlobalTrashTextPreview: boolean
  shouldUseRuntimeGlobalTrashFileContent: boolean
  shouldUseRuntimeTextPreview: boolean
  shouldUseRuntimeFileContent: boolean
  shouldUseFileSystemAccess: boolean
}

export interface ResolvePreviewFileAccessPlanParams {
  file: FileItem | null
  previewKind: FilePreviewKind
  rootHandleAvailable: boolean
  boundRootPath: string | null
  runtimeFileLocator: RuntimeFileLocator | null
  runtimeGlobalTrashRecycleId: string | null
  runtimeGlobalTrashFileContentUrl: string | null
}

export function resolvePreviewFileAccessPlan({
  file,
  previewKind,
  rootHandleAvailable,
  boundRootPath,
  runtimeFileLocator,
  runtimeGlobalTrashRecycleId,
  runtimeGlobalTrashFileContentUrl,
}: ResolvePreviewFileAccessPlanParams): PreviewFileAccessPlan {
  if (!file || file.kind !== 'file') {
    return emptyPreviewFileAccessPlan()
  }

  const currentRootRelativePath = runtimeFileLocator && runtimeFileLocator.rootPath === boundRootPath
    ? runtimeFileLocator.rootRelativePath
    : file.path
  const hasRemoteFileLocator = typeof file.remoteRootId === 'string' && file.remoteRootId.trim().length > 0
  const shouldUseRuntimeGlobalTrashFileContent = Boolean(
    runtimeGlobalTrashFileContentUrl
    && (previewKind === 'image' || previewKind === 'video')
  )
  const shouldUseRuntimeGlobalTrashTextPreview = Boolean(
    runtimeGlobalTrashRecycleId
    && previewKind === 'text'
  )
  const hasRuntimeFileLocator = Boolean(
    runtimeFileLocator
    && runtimeFileLocator.rootPath === boundRootPath
  )
  const canAccessThroughCurrentRoot = canReadThroughCurrentRoot({
    file,
    boundRootPath,
    hasRemoteFileLocator,
    hasRuntimeFileLocator,
    rootHandleAvailable,
  })
  const shouldUseFileAccess = Boolean(
    hasRemoteFileLocator
    || (
      file.absolutePath
      && !canAccessThroughCurrentRoot
      && !shouldUseRuntimeGlobalTrashFileContent
      && !shouldUseRuntimeGlobalTrashTextPreview
    )
  )
  const shouldUseRuntimeTextPreview = Boolean(
    previewKind === 'text'
    && boundRootPath
    && canAccessThroughCurrentRoot
    && !shouldUseFileAccess
  )
  const shouldUseRuntimeFileContent = Boolean(
    (previewKind === 'image' || previewKind === 'video')
    && boundRootPath
    && canAccessThroughCurrentRoot
    && !shouldUseFileAccess
  )
  const shouldUseFileSystemAccess = Boolean(
    rootHandleAvailable
    && canAccessThroughCurrentRoot
    && !shouldUseFileAccess
    && !shouldUseRuntimeGlobalTrashFileContent
    && !shouldUseRuntimeGlobalTrashTextPreview
  )

  return {
    accessKind: previewFileAccessKind({
      shouldUseFileAccess,
      shouldUseRuntimeGlobalTrashTextPreview,
      shouldUseRuntimeGlobalTrashFileContent,
      shouldUseRuntimeTextPreview,
      shouldUseRuntimeFileContent,
      shouldUseFileSystemAccess,
    }),
    currentRootRelativePath,
    hasRemoteFileLocator,
    hasRuntimeFileLocator,
    canAccessThroughCurrentRoot,
    shouldUseFileAccess,
    shouldUseRuntimeGlobalTrashTextPreview,
    shouldUseRuntimeGlobalTrashFileContent,
    shouldUseRuntimeTextPreview,
    shouldUseRuntimeFileContent,
    shouldUseFileSystemAccess,
  }
}

function canReadThroughCurrentRoot({
  file,
  boundRootPath,
  hasRemoteFileLocator,
  hasRuntimeFileLocator,
  rootHandleAvailable,
}: {
  file: FileItem
  boundRootPath: string | null
  hasRemoteFileLocator: boolean
  hasRuntimeFileLocator: boolean
  rootHandleAvailable: boolean
}): boolean {
  if (hasRemoteFileLocator) return true
  if (hasRuntimeFileLocator) return true
  if (!rootHandleAvailable) return false
  if (!file.path || isAbsolutePathLike(file.path)) return false
  if (file.sourceRootPath && file.sourceRootPath !== boundRootPath) {
    return false
  }
  return true
}

function previewFileAccessKind({
  shouldUseFileAccess,
  shouldUseRuntimeGlobalTrashTextPreview,
  shouldUseRuntimeGlobalTrashFileContent,
  shouldUseRuntimeTextPreview,
  shouldUseRuntimeFileContent,
  shouldUseFileSystemAccess,
}: Pick<
  PreviewFileAccessPlan,
  | 'shouldUseFileAccess'
  | 'shouldUseRuntimeGlobalTrashTextPreview'
  | 'shouldUseRuntimeGlobalTrashFileContent'
  | 'shouldUseRuntimeTextPreview'
  | 'shouldUseRuntimeFileContent'
  | 'shouldUseFileSystemAccess'
>): PreviewFileAccessKind {
  if (shouldUseFileAccess) return 'file-access'
  if (shouldUseRuntimeGlobalTrashTextPreview) return 'runtime-global-trash-text'
  if (shouldUseRuntimeGlobalTrashFileContent) return 'runtime-global-trash-content'
  if (shouldUseRuntimeTextPreview) return 'runtime-text-preview'
  if (shouldUseRuntimeFileContent) return 'runtime-file-content'
  if (shouldUseFileSystemAccess) return 'file-system'
  return 'unavailable'
}

function emptyPreviewFileAccessPlan(): PreviewFileAccessPlan {
  return {
    accessKind: 'unavailable',
    currentRootRelativePath: '',
    hasRemoteFileLocator: false,
    hasRuntimeFileLocator: false,
    canAccessThroughCurrentRoot: false,
    shouldUseFileAccess: false,
    shouldUseRuntimeGlobalTrashTextPreview: false,
    shouldUseRuntimeGlobalTrashFileContent: false,
    shouldUseRuntimeTextPreview: false,
    shouldUseRuntimeFileContent: false,
    shouldUseFileSystemAccess: false,
  }
}
