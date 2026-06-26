import { getFilePreviewKind } from '../../../lib/filePreview.ts'
import type { FileItem } from '../../../types/index.ts'

export interface PreviewMediaCollection {
  mediaFiles: FileItem[]
  mediaIndexByPath: Map<string, number>
  mediaFileByPath: Map<string, FileItem>
  mediaSetKey: string
}

export function buildPreviewMediaCollection(files: FileItem[]): PreviewMediaCollection {
  const mediaFiles = files.filter((file): file is FileItem => {
    if (file.kind !== 'file') return false
    const previewKind = getFilePreviewKind(file.name)
    return previewKind === 'image' || previewKind === 'video'
  })
  const mediaIndexByPath = new Map<string, number>()
  const mediaFileByPath = new Map<string, FileItem>()
  mediaFiles.forEach((file, index) => {
    mediaIndexByPath.set(file.path, index)
    mediaFileByPath.set(file.path, file)
  })

  return {
    mediaFiles,
    mediaIndexByPath,
    mediaFileByPath,
    mediaSetKey: mediaFiles.map((file) => file.path).sort().join('\u0000'),
  }
}

export function getPreviewMediaIndex(
  collection: PreviewMediaCollection,
  file: FileItem | null
): number {
  if (!file || file.kind !== 'file') return -1
  return collection.mediaIndexByPath.get(file.path) ?? -1
}

export function canNavigatePreviewMedia(
  collection: PreviewMediaCollection,
  file: FileItem | null
): boolean {
  return collection.mediaFiles.length > 1 && getPreviewMediaIndex(collection, file) >= 0
}
