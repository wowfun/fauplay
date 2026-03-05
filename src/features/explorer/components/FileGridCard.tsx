import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { FolderOpen, File, Image, Video, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getMediaType } from '@/lib/thumbnail'
import { getDirectoryItemCount } from '@/lib/fileSystem'
import {
  getExactCachedThumbnailFromPipeline,
  getLatestCachedThumbnailFromPipeline,
  requestThumbnailFromPipeline,
} from '@/lib/thumbnailPipeline'
import type { ThumbnailTaskPriority } from '@/lib/thumbnailPipeline'
import type { FileItem, ThumbnailSizePreset } from '@/types'

interface FileGridCardProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  itemIndex: number
  thumbnailSizePreset: ThumbnailSizePreset
  thumbnailPriority: ThumbnailTaskPriority
  isSelected?: boolean
  isChecked?: boolean
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onDoubleClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onToggleChecked: (event: ReactMouseEvent<HTMLInputElement>) => void
}

type ThumbnailLoadState = 'placeholder' | 'loading' | 'ready' | 'failed'

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
  thumbnailPriority,
  isSelected = false,
  isChecked = false,
  onClick,
  onDoubleClick,
  onToggleChecked,
}: FileGridCardProps) {
  const isDir = file.kind === 'directory'
  const mediaType = getMediaType(file.name)
  const fileLastModifiedMs = file.lastModified?.getTime()
  const thumbnailBoxSize = THUMBNAIL_BOX_SIZE_BY_PRESET[thumbnailSizePreset]
  const iconSize = ICON_SIZE_BY_PRESET[thumbnailSizePreset]
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [thumbnailUrlIdentity, setThumbnailUrlIdentity] = useState<string | null>(null)
  const [thumbnailState, setThumbnailState] =
    useState<ThumbnailLoadState>('placeholder')
  const [directoryItemCount, setDirectoryItemCount] = useState<number | null>(null)
  const requestIdentityRef = useRef<string | null>(null)
  const requestIdentity = !isDir && mediaType
    ? [
      file.path,
      file.size ?? 'unknown-size',
      fileLastModifiedMs ?? 'unknown-modified',
      mediaType,
      thumbnailSizePreset,
    ].join('::')
    : null
  const exactCachedThumbnailUrl = !isDir && mediaType
    ? getExactCachedThumbnailFromPipeline({
      filePath: file.path,
      mediaType,
      sizePreset: thumbnailSizePreset,
      fileSize: file.size,
      fileLastModifiedMs,
    })
    : null
  const latestCachedThumbnailUrl = !isDir && mediaType
    ? getLatestCachedThumbnailFromPipeline({
      filePath: file.path,
      mediaType,
      sizePreset: thumbnailSizePreset,
      fileSize: file.size,
      fileLastModifiedMs,
    })
    : null
  const displayedThumbnailUrl =
    (requestIdentity && thumbnailUrlIdentity === requestIdentity ? thumbnailUrl : null) ??
    latestCachedThumbnailUrl

  useEffect(() => {
    if (!rootHandle || isDir) {
      setThumbnailUrl(null)
      setThumbnailUrlIdentity(null)
      setThumbnailState('placeholder')
      return
    }

    if (!mediaType) {
      setThumbnailUrl(null)
      setThumbnailUrlIdentity(null)
      setThumbnailState('placeholder')
      return
    }

    if (!requestIdentity) {
      setThumbnailUrl(null)
      setThumbnailUrlIdentity(null)
      setThumbnailState('placeholder')
      return
    }

    const identityChanged = requestIdentityRef.current !== requestIdentity
    requestIdentityRef.current = requestIdentity

    if (exactCachedThumbnailUrl) {
      setThumbnailUrl(exactCachedThumbnailUrl)
      setThumbnailUrlIdentity(requestIdentity)
      setThumbnailState('ready')
      return
    }

    let cancelled = false
    const controller = new AbortController()

    const loadThumbnail = async () => {
      if (identityChanged) {
        setThumbnailUrl(null)
        setThumbnailUrlIdentity(null)
      }
      setThumbnailState('loading')

      try {
        const fileObj = await getFileFromPath(rootHandle, file.path)
        if (!fileObj || cancelled) {
          if (!cancelled) {
            setThumbnailState('failed')
            console.warn('[thumbnail] source file not found for thumbnail job', {
              filePath: file.path,
              sizePreset: thumbnailSizePreset,
            })
          }
          return
        }

        const url = await requestThumbnailFromPipeline({
          file: fileObj,
          filePath: file.path,
          sizePreset: thumbnailSizePreset,
          mediaType,
          priority: thumbnailPriority,
          signal: controller.signal,
        })

        if (!cancelled) {
          setThumbnailUrl(url)
          setThumbnailUrlIdentity(requestIdentity)
          setThumbnailState('ready')
        }
      } catch (error) {
        if (!cancelled) {
          const isAbort =
            error instanceof DOMException && error.name === 'AbortError'
          if (!isAbort) {
            setThumbnailState('failed')
            console.warn('[thumbnail] thumbnail job failed', {
              filePath: file.path,
              sizePreset: thumbnailSizePreset,
              error,
            })
          }
        }
      }
    }

    loadThumbnail()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    rootHandle,
    file.path,
    file.name,
    file.size,
    fileLastModifiedMs,
    isDir,
    mediaType,
    thumbnailSizePreset,
    thumbnailPriority,
    requestIdentity,
    exactCachedThumbnailUrl,
  ])

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
    if (displayedThumbnailUrl) return null
    if (mediaType === 'image') return <Image size={iconSize} className="text-green-500" />
    if (mediaType === 'video') return <Video size={iconSize} className="text-blue-500" />
    return <File size={iconSize} className="text-gray-500" />
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="relative h-full w-full">
      <input
        type="checkbox"
        checked={isChecked}
        readOnly
        onClick={onToggleChecked}
        aria-label={`选择 ${file.name}`}
        className="absolute left-2 top-2 z-10 h-4 w-4 cursor-pointer accent-primary"
      />

      <button
        type="button"
        data-grid-index={itemIndex}
        data-grid-selected={isSelected ? 'true' : 'false'}
        data-grid-checked={isChecked ? 'true' : 'false'}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={cn(
          "w-full min-w-0 h-full flex flex-col items-center p-3 rounded-lg cursor-pointer transition-colors",
          "hover:bg-accent/50",
          "focus:outline-none focus:bg-accent/70 focus:ring-1 focus:ring-primary/40",
          "data-[grid-selected=true]:bg-accent/70 data-[grid-selected=true]:ring-1 data-[grid-selected=true]:ring-primary/40",
          "data-[grid-checked=true]:bg-accent/40 data-[grid-checked=true]:ring-1 data-[grid-checked=true]:ring-primary/20"
        )}
      >
        <div
          className="relative flex items-center justify-center mb-2 bg-muted rounded-lg overflow-hidden"
          style={{ width: thumbnailBoxSize, height: thumbnailBoxSize }}
        >
          {displayedThumbnailUrl ? (
            <img
              src={displayedThumbnailUrl}
              alt={file.name}
              className="w-full h-full object-cover"
            />
          ) : thumbnailState === 'loading' ? (
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          ) : (
            getIcon()
          )}
          {thumbnailState === 'failed' && !displayedThumbnailUrl && !isDir && (
            <span className="absolute bottom-1 rounded bg-destructive/90 px-1.5 py-0.5 text-[10px] leading-none text-destructive-foreground">
              失败
            </span>
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
    </div>
  )
}
