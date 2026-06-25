import type { FileItem, FilePreviewKind } from '../../../types/index.ts'
import type { PreviewFileAccessPlan } from './previewFileAccess.ts'
import type { RuntimeFileLocator } from '../../../lib/runtimeApi/types.ts'

export type PreviewFileLoadPlan =
  | { kind: 'empty' }
  | { kind: 'file-access-text' }
  | { kind: 'file-access-content' }
  | { kind: 'file-access-unsupported' }
  | { kind: 'runtime-global-trash-text'; recycleId: string }
  | { kind: 'runtime-global-trash-content'; contentUrl: string }
  | {
    kind: 'runtime-text-preview'
    rootPath: string
    rootRelativePath: string
    canFallbackToFileSystem: true
  }
  | { kind: 'runtime-file-content'; rootPath: string; rootRelativePath: string }
  | { kind: 'file-system'; rootRelativePath: string }
  | { kind: 'unavailable'; error: string }

export interface ResolvePreviewFileLoadPlanParams {
  file: FileItem | null
  previewKind: FilePreviewKind
  accessPlan: PreviewFileAccessPlan
  runtimeFileLocator: RuntimeFileLocator | null
  runtimeGlobalTrashRecycleId: string | null
  runtimeGlobalTrashFileContentUrl: string | null
}

export function resolvePreviewFileLoadPlan({
  file,
  previewKind,
  accessPlan,
  runtimeFileLocator,
  runtimeGlobalTrashRecycleId,
  runtimeGlobalTrashFileContentUrl,
}: ResolvePreviewFileLoadPlanParams): PreviewFileLoadPlan {
  if (!file || file.kind !== 'file') return { kind: 'empty' }

  switch (accessPlan.accessKind) {
    case 'file-access':
      if (previewKind === 'text') return { kind: 'file-access-text' }
      if (previewKind === 'image' || previewKind === 'video') return { kind: 'file-access-content' }
      return { kind: 'file-access-unsupported' }
    case 'runtime-global-trash-text':
      return runtimeGlobalTrashRecycleId
        ? { kind: 'runtime-global-trash-text', recycleId: runtimeGlobalTrashRecycleId }
        : unavailablePreviewFileLoadPlan()
    case 'runtime-global-trash-content':
      return runtimeGlobalTrashFileContentUrl
        ? { kind: 'runtime-global-trash-content', contentUrl: runtimeGlobalTrashFileContentUrl }
        : unavailablePreviewFileLoadPlan()
    case 'runtime-text-preview':
      return runtimeFileLocator
        ? {
          kind: 'runtime-text-preview',
          rootPath: runtimeFileLocator.rootPath,
          rootRelativePath: runtimeFileLocator.rootRelativePath,
          canFallbackToFileSystem: true,
        }
        : unavailablePreviewFileLoadPlan()
    case 'runtime-file-content':
      return runtimeFileLocator
        ? {
          kind: 'runtime-file-content',
          rootPath: runtimeFileLocator.rootPath,
          rootRelativePath: runtimeFileLocator.rootRelativePath,
        }
        : unavailablePreviewFileLoadPlan()
    case 'file-system':
      return accessPlan.currentRootRelativePath
        ? { kind: 'file-system', rootRelativePath: accessPlan.currentRootRelativePath }
        : unavailablePreviewFileLoadPlan()
    case 'unavailable':
      return unavailablePreviewFileLoadPlan()
  }

  return unavailablePreviewFileLoadPlan()
}

function unavailablePreviewFileLoadPlan(): PreviewFileLoadPlan {
  return {
    kind: 'unavailable',
    error: '当前文件无法通过工作区目录句柄读取',
  }
}
