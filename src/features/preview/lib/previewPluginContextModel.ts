import { orderToolsWithSoftDeleteLast } from '../../plugin-runtime/utils/toolOrdering.ts'
import type { RuntimeToolDescriptor } from '../../../lib/runtimeApi/toolDescriptors.ts'
import type { FileItem } from '../../../types/index.ts'

export interface ResolvePreviewPluginContextModelParams {
  file: FileItem
  rootId: string | null | undefined
  currentBoundRootPath: string | null
  previewActionTools: RuntimeToolDescriptor[]
}

export interface PreviewPluginContextModel {
  normalizedFilePath: string
  isCrossRootProjection: boolean
  isTrashContext: boolean
  contextualTools: RuntimeToolDescriptor[]
  previewBaseArguments: Record<string, unknown> | null
  hasRelativeToolContext: boolean
}

export interface ResolvePreviewPluginToolRunnableParams {
  file: FileItem
  previewBaseArguments: Record<string, unknown> | null
  tool: RuntimeToolDescriptor
}

export interface ResolvePreviewPluginToolArgumentsParams {
  file: FileItem
  previewBaseArguments: Record<string, unknown> | null
  tool: RuntimeToolDescriptor
  extraArgs?: Record<string, unknown>
}

export function resolvePreviewPluginContextModel({
  file,
  currentBoundRootPath,
  previewActionTools,
}: ResolvePreviewPluginContextModelParams): PreviewPluginContextModel {
  const normalizedFilePath = normalizeRelativePath(file.path)
  const isCrossRootProjection = Boolean(file.sourceRootPath && file.sourceRootPath !== currentBoundRootPath)
  const isTrashContext = (
    file.sourceType === 'root_trash'
    || file.sourceType === 'global_recycle'
    || normalizedFilePath === '@trash'
    || normalizedFilePath === '.trash'
    || normalizedFilePath.startsWith('.trash/')
  )
  const contextualTools = resolvePreviewContextualTools({
    previewActionTools,
    isTrashContext,
    isCrossRootProjection,
  })
  const previewBaseArguments = resolvePreviewBaseArguments(file)

  return {
    normalizedFilePath,
    isCrossRootProjection,
    isTrashContext,
    contextualTools,
    previewBaseArguments,
    hasRelativeToolContext: Boolean(previewBaseArguments && typeof previewBaseArguments.relativePath === 'string'),
  }
}

export function resolvePreviewPluginToolRunnable({
  file,
  previewBaseArguments,
  tool,
}: ResolvePreviewPluginToolRunnableParams): boolean {
  if (file.kind !== 'file') return false
  if (file.sourceType === 'root_trash' || file.sourceType === 'global_recycle') {
    return tool.name === 'fs.restore'
  }
  if (!hasRelativeToolContext(previewBaseArguments)) {
    return tool.name === 'fs.softDelete' && hasAbsolutePath(file)
  }
  return true
}

export function resolvePreviewPluginToolArguments({
  file,
  previewBaseArguments,
  tool,
  extraArgs,
}: ResolvePreviewPluginToolArgumentsParams): Record<string, unknown> | null {
  if (tool.name === 'fs.softDelete') {
    if (hasAbsolutePath(file)) {
      return {
        absolutePaths: [file.absolutePath.trim()],
        ...(extraArgs ?? {}),
      }
    }
    if (previewBaseArguments) {
      return {
        ...previewBaseArguments,
        ...(extraArgs ?? {}),
      }
    }
    return null
  }

  if (tool.name === 'fs.restore') {
    if (previewBaseArguments) {
      return {
        ...previewBaseArguments,
        ...(extraArgs ?? {}),
      }
    }
    return null
  }

  if (!previewBaseArguments) {
    return null
  }

  return {
    ...previewBaseArguments,
    ...(extraArgs ?? {}),
  }
}

function resolvePreviewContextualTools({
  previewActionTools,
  isTrashContext,
  isCrossRootProjection,
}: {
  previewActionTools: RuntimeToolDescriptor[]
  isTrashContext: boolean
  isCrossRootProjection: boolean
}): RuntimeToolDescriptor[] {
  const filteredTools = isTrashContext
    ? previewActionTools.filter((tool) => tool.name === 'fs.restore')
    : (isCrossRootProjection
      ? previewActionTools.filter((tool) => (
        tool.name === 'fs.softDelete' || tool.name === 'data.findDuplicateFiles'
      ))
      : previewActionTools.filter((tool) => tool.name !== 'fs.restore'))

  return orderToolsWithSoftDeleteLast(filteredTools)
}

function resolvePreviewBaseArguments(file: FileItem): Record<string, unknown> | null {
  if (file.kind !== 'file') return null
  if (file.sourceType === 'root_trash' || file.sourceType === 'global_recycle') {
    const items = [{
      sourceType: file.sourceType,
      ...(typeof file.recycleId === 'string' && file.recycleId.trim() ? { recycleId: file.recycleId.trim() } : {}),
      ...(typeof file.absolutePath === 'string' && file.absolutePath.trim() ? { absolutePath: file.absolutePath.trim() } : {}),
    }]
    return { items }
  }

  const relativePath = typeof file.sourceRelativePath === 'string' && file.sourceRelativePath.trim()
    ? file.sourceRelativePath.trim()
    : (!isAbsolutePathLike(file.path) ? file.path : '')
  if (!relativePath) {
    if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
      return {}
    }
    return null
  }

  return {
    relativePath,
    ...(typeof file.sourceRootPath === 'string' && file.sourceRootPath.trim() ? { rootPath: file.sourceRootPath.trim() } : {}),
  }
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
}

function hasRelativeToolContext(previewBaseArguments: Record<string, unknown> | null): boolean {
  return Boolean(previewBaseArguments && typeof previewBaseArguments.relativePath === 'string')
}

function hasAbsolutePath(file: FileItem): file is FileItem & { absolutePath: string } {
  return typeof file.absolutePath === 'string' && file.absolutePath.trim().length > 0
}
