import { useEffect, useState } from 'react'
import { FolderOpen, File, Image, Video, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getMediaType, generateThumbnail } from '@/lib/thumbnail'
import { getDirectoryItemCount } from '@/lib/fileSystem'
import type { FileItem, ThumbnailSizePreset } from '@/types'

interface FileGridCardProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  itemIndex: number
  thumbnailSizePreset: ThumbnailSizePreset
  isSelected?: boolean
  onClick: () => void
  onDoubleClick?: () => void
}

const THUMBNAIL_BOX_SIZE_BY_PRESET: Record<ThumbnailSizePreset, number> = {
  auto: 80,
  '256': 192,
  '512': 448,
}

const ICON_SIZE_BY_PRESET: Record<ThumbnailSizePreset, number> = {
  auto: 48,
  '256': 72,
  '512': 96,
}

async function getFileFromPath(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string
): Promise<File | null> {
  try {
    const pathParts = filePath.split('/')
    let current: FileSystemHandle = rootHandle

    for (let i = 0; i < pathParts.length - 1; i++) {
      current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(pathParts[i])
    }

    const fileName = pathParts[pathParts.length - 1]
    const fileHandle = await (current as FileSystemDirectoryHandle).getFileHandle(fileName)
    return await fileHandle.getFile()
  } catch {
    return null
  }
}

export function FileGridCard({
  file,
  rootHandle,
  itemIndex,
  thumbnailSizePreset,
  isSelected = false,
  onClick,
  onDoubleClick,
}: FileGridCardProps) {
  const isDir = file.kind === 'directory'
  const thumbnailBoxSize = THUMBNAIL_BOX_SIZE_BY_PRESET[thumbnailSizePreset]
  const iconSize = ICON_SIZE_BY_PRESET[thumbnailSizePreset]
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [directoryItemCount, setDirectoryItemCount] = useState<number | null>(null)

  useEffect(() => {
    if (!rootHandle || isDir) {
      setThumbnailUrl(null)
      return
    }

    const mediaType = getMediaType(file.name)
    if (!mediaType) {
      setThumbnailUrl(null)
      return
    }

    let cancelled = false

    const loadThumbnail = async () => {
      setIsLoading(true)

      try {
        const fileObj = await getFileFromPath(rootHandle, file.path)
        if (!fileObj || cancelled) return

        const url = await generateThumbnail(fileObj, mediaType, {
          filePath: file.path,
          sizePreset: thumbnailSizePreset,
        })

        if (!cancelled) {
          setThumbnailUrl(url)
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadThumbnail()

    return () => {
      cancelled = true
    }
  }, [rootHandle, file.path, file.name, isDir, thumbnailSizePreset])

  useEffect(() => {
    if (!rootHandle || !isDir) {
      setDirectoryItemCount(null)
      return
    }

    let cancelled = false

    const loadDirectoryItemCount = async () => {
      try {
        const count = await getDirectoryItemCount(rootHandle, file.path)
        if (!cancelled) {
          setDirectoryItemCount(count)
        }
      } catch {
        if (!cancelled) {
          setDirectoryItemCount(null)
        }
      }
    }

    loadDirectoryItemCount()

    return () => {
      cancelled = true
    }
  }, [rootHandle, isDir, file.path])

  const getIcon = () => {
    if (isDir) return <FolderOpen size={iconSize} className="text-yellow-500" />
    if (thumbnailUrl) return null
    if (getMediaType(file.name) === 'image') return <Image size={iconSize} className="text-green-500" />
    if (getMediaType(file.name) === 'video') return <Video size={iconSize} className="text-blue-500" />
    return <File size={iconSize} className="text-gray-500" />
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <button
      type="button"
      data-grid-index={itemIndex}
      data-grid-selected={isSelected ? 'true' : 'false'}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "w-full min-w-0 h-full flex flex-col items-center p-3 rounded-lg cursor-pointer transition-colors",
        "hover:bg-accent/50",
        "focus:outline-none focus:bg-accent/70 focus:ring-1 focus:ring-primary/40",
        "data-[grid-selected=true]:bg-accent/70 data-[grid-selected=true]:ring-1 data-[grid-selected=true]:ring-primary/40"
      )}
    >
      <div
        className="relative flex items-center justify-center mb-2 bg-muted rounded-lg overflow-hidden"
        style={{ width: thumbnailBoxSize, height: thumbnailBoxSize }}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={file.name}
            className="w-full h-full object-cover"
          />
        ) : isLoading ? (
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        ) : (
          getIcon()
        )}
        {isDir && directoryItemCount !== null && (
          <span className="absolute right-1 top-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] leading-none text-secondary-foreground">
            {directoryItemCount > 99 ? '99+' : directoryItemCount}
          </span>
        )}
      </div>
      <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm text-center" title={file.name}>
        {file.name}
      </span>
      {!isDir && (
        <span className="text-xs text-muted-foreground">
          {formatSize(file.size)}
        </span>
      )}
    </button>
  )
}
