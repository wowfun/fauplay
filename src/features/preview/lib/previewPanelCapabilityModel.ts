import type { RuntimeToolDescriptor } from '../../../lib/runtimeApi/toolDescriptors.ts'
import type { FileItem } from '../../../types/index.ts'

export interface ResolvePreviewPanelCapabilityModelParams {
  file: FileItem | null
  rootId: string | null | undefined
  rootHandleAvailable: boolean
  boundRootPath: string | null
  canAccessThroughCurrentRoot: boolean
  shouldUseFileAccess: boolean
  previewActionTools: RuntimeToolDescriptor[]
}

export interface PreviewPanelCapabilityModel {
  canUseAnnotationContext: boolean
  hasBatchRenameTool: boolean
  canUseRuntimeRootMove: boolean
  hasVisionFaceTool: boolean
  hasLocalDataTool: boolean
  renameUnavailableReason: string | null
  canRenameFileName: boolean
  annotationTagManageUnavailableReason: string | null
  canManageAnnotationTags: boolean
}

export function resolvePreviewPanelCapabilityModel({
  file,
  rootId,
  rootHandleAvailable,
  boundRootPath,
  canAccessThroughCurrentRoot,
  shouldUseFileAccess,
  previewActionTools,
}: ResolvePreviewPanelCapabilityModelParams): PreviewPanelCapabilityModel {
  const hasBatchRenameTool = previewActionTools.some((tool) => tool.name === 'fs.batchRename')
  const canUseAnnotationContext = Boolean(
    file
    && file.kind === 'file'
    && rootId
    && canAccessThroughCurrentRoot
    && !isTrashSource(file)
  )
  const canUseRuntimeRootMove = Boolean(
    file
    && file.kind === 'file'
    && rootId
    && boundRootPath
    && canAccessThroughCurrentRoot
    && !shouldUseFileAccess
    && !isTrashSource(file)
  )
  const hasVisionFaceTool = canUseAnnotationContext && hasFileScopedTool(previewActionTools, 'vision.face')
  const hasLocalDataTool = canUseAnnotationContext && hasFileScopedTool(previewActionTools, 'local.data')
  const renameUnavailableReason = resolveRenameUnavailableReason({
    file,
    rootId,
    rootHandleAvailable,
    canUseRuntimeRootMove,
    canAccessThroughCurrentRoot,
    hasBatchRenameTool,
  })
  const annotationTagManageUnavailableReason = resolveAnnotationTagManageUnavailableReason({
    file,
    rootId,
    rootHandleAvailable,
    canUseAnnotationContext,
    hasLocalDataTool,
  })

  return {
    canUseAnnotationContext,
    hasBatchRenameTool,
    canUseRuntimeRootMove,
    hasVisionFaceTool,
    hasLocalDataTool,
    renameUnavailableReason,
    canRenameFileName: renameUnavailableReason === null,
    annotationTagManageUnavailableReason,
    canManageAnnotationTags: annotationTagManageUnavailableReason === null,
  }
}

function resolveRenameUnavailableReason({
  file,
  rootId,
  rootHandleAvailable,
  canUseRuntimeRootMove,
  canAccessThroughCurrentRoot,
  hasBatchRenameTool,
}: {
  file: FileItem | null
  rootId: string | null | undefined
  rootHandleAvailable: boolean
  canUseRuntimeRootMove: boolean
  canAccessThroughCurrentRoot: boolean
  hasBatchRenameTool: boolean
}): string | null {
  if (!file || file.kind !== 'file') {
    return '当前项不可重命名'
  }
  if (!rootId || (!rootHandleAvailable && !canUseRuntimeRootMove)) {
    return '工具上下文不完整'
  }
  if (!canAccessThroughCurrentRoot || isTrashSource(file)) {
    return '当前结果项不支持重命名'
  }
  if (!canUseRuntimeRootMove && !hasBatchRenameTool) {
    return '重命名能力不可用（Runtime 未连接且未注册 fs.batchRename）'
  }
  return null
}

function resolveAnnotationTagManageUnavailableReason({
  file,
  rootId,
  rootHandleAvailable,
  canUseAnnotationContext,
  hasLocalDataTool,
}: {
  file: FileItem | null
  rootId: string | null | undefined
  rootHandleAvailable: boolean
  canUseAnnotationContext: boolean
  hasLocalDataTool: boolean
}): string | null {
  if (!file || file.kind !== 'file') {
    return '当前项不可管理标签'
  }
  if (!rootHandleAvailable || !rootId) {
    return '工具上下文不完整'
  }
  if (!canUseAnnotationContext) {
    return '当前结果项不支持标签管理'
  }
  if (!hasLocalDataTool) {
    return '标签管理能力不可用（Runtime 未连接或未注册 local.data）'
  }
  return null
}

function hasFileScopedTool(previewActionTools: RuntimeToolDescriptor[], name: string): boolean {
  return previewActionTools.some((tool) => tool.name === name && tool.scopes.includes('file'))
}

function isTrashSource(file: FileItem): boolean {
  return file.sourceType === 'root_trash' || file.sourceType === 'global_recycle'
}
