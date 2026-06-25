import type { FileItem } from '../../../types/index.ts'

export type PreviewAnnotationTagMutationOperation = 'bind' | 'unbind'

export interface PreviewAnnotationTagMutationTag {
  key: string
  value: string
}

export interface ResolvePreviewAnnotationTagMutationPlanParams {
  file: FileItem | null
  rootId: string | null | undefined
  rootHandleAvailable: boolean
  canManageAnnotationTags: boolean
  unavailableReason: string | null | undefined
  operation: PreviewAnnotationTagMutationOperation
  tag: PreviewAnnotationTagMutationTag
}

export type PreviewAnnotationTagToolOperation = 'bindAnnotationTag' | 'unbindAnnotationTag'

export interface PreviewAnnotationTagMutationToolArgs extends Record<string, unknown> {
  operation: PreviewAnnotationTagToolOperation
  relativePath: string
  key: string
  value: string
}

export type PreviewAnnotationTagMutationPlan =
  | {
    ok: false
    error: string
  }
  | {
    ok: true
    operation: PreviewAnnotationTagMutationOperation
    rootId: string
    relativePath: string
    tag: PreviewAnnotationTagMutationTag
    toolArgs: PreviewAnnotationTagMutationToolArgs
  }

export function resolvePreviewAnnotationTagMutationPlan({
  file,
  rootId,
  rootHandleAvailable,
  canManageAnnotationTags,
  unavailableReason,
  operation,
  tag,
}: ResolvePreviewAnnotationTagMutationPlanParams): PreviewAnnotationTagMutationPlan {
  if (!file || file.kind !== 'file') {
    return {
      ok: false,
      error: '当前项不可管理标签',
    }
  }

  if (!rootHandleAvailable || !rootId) {
    return {
      ok: false,
      error: unavailableReason || '工具上下文不完整',
    }
  }

  if (!canManageAnnotationTags) {
    return {
      ok: false,
      error: unavailableReason || '标签管理能力不可用',
    }
  }

  return {
    ok: true,
    operation,
    rootId,
    relativePath: file.path,
    tag,
    toolArgs: {
      operation: operation === 'bind' ? 'bindAnnotationTag' : 'unbindAnnotationTag',
      relativePath: file.path,
      key: tag.key,
      value: tag.value,
    },
  }
}
