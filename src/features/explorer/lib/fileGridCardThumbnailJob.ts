import { getFileFromPath } from '@/lib/fileSystem'
import {
  requestThumbnailFromPipeline,
  type ThumbnailTaskPriority,
} from '@/lib/thumbnailPipeline'
import type { FileGridCardMediaType } from '@/features/explorer/lib/fileGridCardModel'
import type { ThumbnailSizePreset } from '@/types'

interface RequestFileGridCardThumbnailJobParams {
  filePath: string
  fileSize?: number
  fileLastModifiedMs?: number
  mediaType: FileGridCardMediaType
  rootHandle: FileSystemDirectoryHandle
  runtimeVideoThumbnailSourceUrl: string | null
  thumbnailSizePreset: ThumbnailSizePreset
  thumbnailPriority: ThumbnailTaskPriority
  signal: AbortSignal
}

export async function requestFileGridCardThumbnailJob({
  filePath,
  fileSize,
  fileLastModifiedMs,
  mediaType,
  rootHandle,
  runtimeVideoThumbnailSourceUrl,
  thumbnailSizePreset,
  thumbnailPriority,
  signal,
}: RequestFileGridCardThumbnailJobParams): Promise<string> {
  if (runtimeVideoThumbnailSourceUrl) {
    return requestThumbnailFromPipeline({
      sourceUrl: runtimeVideoThumbnailSourceUrl,
      filePath,
      fileSize,
      fileLastModifiedMs,
      sizePreset: thumbnailSizePreset,
      mediaType,
      priority: thumbnailPriority,
      signal,
      crossOrigin: true,
    })
  }

  const file = await getFileFromPath(rootHandle, filePath)
  return requestThumbnailFromPipeline({
    file,
    filePath,
    sizePreset: thumbnailSizePreset,
    mediaType,
    priority: thumbnailPriority,
    signal,
  })
}
