import { useEffect, useState } from 'react'
import { FolderOpen, File, Image, Video, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getMediaType, generateThumbnail } from '@/lib/thumbnail'
import { getDirectoryItemCount } from '@/lib/fileSystem'
import type { FileItem } from '@/types'

interface FileItemCardProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  itemIndex: number
  onClick: () => void
  onDoubleClick?: () => void
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

export function FileItemCard({ file, rootHandle, itemIndex, onClick, onDoubleClick }: FileItemCardProps) {
  const isDir = file.kind === 'directory'
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

        const url = await generateThumbnail(fileObj, mediaType, file.path)

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
  }, [rootHandle, file.path, file.name, isDir])

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
    if (isDir) return <FolderOpen className="w-12 h-12 text-yellow-500" />
    if (thumbnailUrl) return null
    if (getMediaType(file.name) === 'image') return <Image className="w-12 h-12 text-green-500" />
    if (getMediaType(file.name) === 'video') return <Video className="w-12 h-12 text-blue-500" />
    return <File className="w-12 h-12 text-gray-500" />
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
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "w-full min-w-0 flex flex-col items-center p-3 rounded-lg cursor-pointer transition-colors",
        "hover:bg-accent/50",
        "focus-visible:outline-none focus-visible:bg-accent/70 focus-visible:ring-1 focus-visible:ring-primary/40"
      )}
    >
      <div className="relative w-20 h-20 flex items-center justify-center mb-2 bg-muted rounded-lg overflow-hidden">
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
