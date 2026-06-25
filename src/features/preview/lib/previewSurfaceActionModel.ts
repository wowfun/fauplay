import { getFilePreviewKind } from '../../../lib/filePreview.ts'
import type { FileItem } from '../../../types/index.ts'
import { normalizePreviewPath } from './previewTraversalModel.ts'

export type PreviewSurfaceSelectionIntent =
  | { kind: 'none' }
  | { kind: 'clear-preferred-path'; preferredPreviewPath: null }
  | { kind: 'store-preferred-path'; preferredPreviewPath: string }
  | {
    kind: 'apply-surface-selection'
    preferredPreviewPath: string | null
    selectedFile: FileItem
    previewFile: FileItem | null
    showPreviewPane: boolean
  }

export interface ResolvePreviewPaneOpenIntentParams {
  file: FileItem
  currentPreviewFile: FileItem | null
}

export interface ResolvePreviewPathAlignmentIntentParams {
  path: string | null
  files: FileItem[]
  currentPreviewFile: FileItem | null
  showPreviewPane: boolean
}

export type PreviewModalOpenIntent =
  | { kind: 'none' }
  | { kind: 'open-modal'; previewFile: FileItem; previewAutoPlayOnOpen: boolean }

export function resolvePreviewPaneOpenIntent({
  file,
  currentPreviewFile,
}: ResolvePreviewPaneOpenIntentParams): PreviewSurfaceSelectionIntent {
  if (file.kind !== 'file') return { kind: 'none' }
  return {
    kind: 'apply-surface-selection',
    preferredPreviewPath: null,
    selectedFile: file,
    previewFile: currentPreviewFile ? file : null,
    showPreviewPane: true,
  }
}

export function resolvePreviewPathAlignmentIntent({
  path,
  files,
  currentPreviewFile,
  showPreviewPane,
}: ResolvePreviewPathAlignmentIntentParams): PreviewSurfaceSelectionIntent {
  const normalizedPath = normalizePreviewPath(path)
  if (!normalizedPath) {
    return { kind: 'clear-preferred-path', preferredPreviewPath: null }
  }

  const preferredFile = files.find((item): item is FileItem => (
    item.kind === 'file' && item.path === normalizedPath
  )) ?? null
  if (!preferredFile) {
    return { kind: 'store-preferred-path', preferredPreviewPath: normalizedPath }
  }

  return {
    kind: 'apply-surface-selection',
    preferredPreviewPath: null,
    selectedFile: preferredFile,
    previewFile: currentPreviewFile ? preferredFile : null,
    showPreviewPane: currentPreviewFile ? true : showPreviewPane,
  }
}

export function resolvePreviewModalOpenIntent({
  file,
}: {
  file: FileItem
}): PreviewModalOpenIntent {
  if (file.kind !== 'file') return { kind: 'none' }
  return createPreviewModalOpenIntent(file)
}

export function resolvePreviewFullscreenFromPaneIntent({
  selectedFile,
}: {
  selectedFile: FileItem | null
}): PreviewModalOpenIntent {
  if (selectedFile?.kind !== 'file') return { kind: 'none' }
  return createPreviewModalOpenIntent(selectedFile)
}

function createPreviewModalOpenIntent(file: FileItem): PreviewModalOpenIntent {
  return {
    kind: 'open-modal',
    previewFile: file,
    previewAutoPlayOnOpen: getFilePreviewKind(file.name) === 'video',
  }
}
