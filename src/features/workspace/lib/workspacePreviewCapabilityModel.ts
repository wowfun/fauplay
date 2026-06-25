import { getFilePreviewKind } from '../../../lib/filePreview.ts'
import type { RuntimeToolDescriptor } from '../../../lib/runtimeApi/toolDescriptors.ts'
import type { FileItem } from '../../../types/index.ts'

export type WorkspacePreviewNavigationSurface = 'pane' | 'lightbox'

export interface ResolveWorkspacePreviewCapabilityModelParams {
  previewFile: FileItem | null
  selectedFile: FileItem | null
  showPreviewPane: boolean
  pluginTools: RuntimeToolDescriptor[]
}

export interface WorkspacePreviewCapabilityModel {
  activePreviewFile: FileItem | null
  previewNavigationSurface: WorkspacePreviewNavigationSurface
  hasActiveVideoPreview: boolean
  canRunTagShortcuts: boolean
  canSoftDelete: boolean
}

export function resolveWorkspacePreviewCapabilityModel({
  previewFile,
  selectedFile,
  showPreviewPane,
  pluginTools,
}: ResolveWorkspacePreviewCapabilityModelParams): WorkspacePreviewCapabilityModel {
  const activePreviewFile = previewFile ?? (showPreviewPane ? selectedFile : null)
  const canUseFileCapability = activePreviewFile?.kind === 'file'
    && !activePreviewFile.path.startsWith('/')
    && activePreviewFile.sourceType !== 'root_trash'
    && activePreviewFile.sourceType !== 'global_recycle'

  return {
    activePreviewFile,
    previewNavigationSurface: previewFile ? 'lightbox' : 'pane',
    hasActiveVideoPreview: activePreviewFile?.kind === 'file' && getFilePreviewKind(activePreviewFile.name) === 'video',
    canRunTagShortcuts: canUseFileCapability && hasFileScopedTool(pluginTools, 'local.data'),
    canSoftDelete: canUseFileCapability && hasFileScopedTool(pluginTools, 'fs.softDelete'),
  }
}

function hasFileScopedTool(pluginTools: RuntimeToolDescriptor[], name: string): boolean {
  return pluginTools.some((tool) => tool.name === name && tool.scopes.includes('file'))
}
