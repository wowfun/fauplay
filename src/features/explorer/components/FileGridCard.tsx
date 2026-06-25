import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { FolderOpen, File, Image, Video, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getDirectoryItemCount } from '@/lib/fileSystem'
import { buildFileThumbnailUrlForItem } from '@/lib/fileAccess'
import {
  buildRuntimeFileContentUrlForItem,
  buildRuntimeGlobalTrashFileContentUrlForItem,
} from '@/lib/runtimeApi'
import { GRID_SELECTABLE_ITEM_ATTR } from '@/hooks/useGridSelection'
import {
  getExactCachedThumbnailFromPipeline,
  getLatestCachedThumbnailFromPipeline,
  requestThumbnailFromPipeline,
} from '@/lib/thumbnailPipeline'
import type { ThumbnailTaskPriority } from '@/lib/thumbnailPipeline'
import type { FileItem, ThumbnailSizePreset } from '@/types'
import {
  formatFileGridCardFileSize,
  resolveFileGridCardDirectoryBadge,
  resolveFileGridCardThumbnailLoadPlan,
  resolveFileGridCardThumbnailPlan,
} from '@/features/explorer/lib/fileGridCardModel'

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
  const thumbnailPlan = resolveFileGridCardThumbnailPlan({
    file,
    rootHandleAvailable: Boolean(rootHandle),
    thumbnailSizePreset,
  })
  const {
    isDirectory: isDir,
    previewKind,
    mediaType,
    fileLastModifiedMs,
    requestIdentity,
  } = thumbnailPlan
  const thumbnailBoxSize = THUMBNAIL_BOX_SIZE_BY_PRESET[thumbnailSizePreset]
  const iconSize = ICON_SIZE_BY_PRESET[thumbnailSizePreset]
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [thumbnailUrlIdentity, setThumbnailUrlIdentity] = useState<string | null>(null)
  const [thumbnailState, setThumbnailState] =
    useState<ThumbnailLoadState>('placeholder')
  const [directoryItemCount, setDirectoryItemCount] = useState<number | null>(null)
  const requestIdentityRef = useRef<string | null>(null)
  const directoryBadge = resolveFileGridCardDirectoryBadge({
    file,
    loadedDirectoryItemCount: directoryItemCount,
  })
  const runtimeLocalFileContentUrl = (
    thumbnailPlan.runtimeContentSource === 'local-root'
  )
    ? buildRuntimeFileContentUrlForItem(file)
    : null
  const runtimeGlobalTrashFileContentUrl = (
    thumbnailPlan.runtimeContentSource === 'global-trash'
  )
    ? buildRuntimeGlobalTrashFileContentUrlForItem(file)
    : null
  const runtimeFileContentUrl = runtimeLocalFileContentUrl ?? runtimeGlobalTrashFileContentUrl
  const runtimeThumbnailUrl = thumbnailPlan.runtimeImageThumbnail ? runtimeFileContentUrl : null
  const runtimeVideoThumbnailSourceUrl = thumbnailPlan.runtimeVideoThumbnail ? runtimeFileContentUrl : null
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
  const fileAccessThumbnailUrl = thumbnailPlan.fileAccessThumbnail
    ? buildFileThumbnailUrlForItem(file, {
      sizePreset: thumbnailSizePreset,
    })
    : null
  const displayedThumbnailUrl =
    runtimeThumbnailUrl ??
    fileAccessThumbnailUrl ??
    (requestIdentity && thumbnailUrlIdentity === requestIdentity ? thumbnailUrl : null) ??
    latestCachedThumbnailUrl

  useEffect(() => {
    const loadPlan = resolveFileGridCardThumbnailLoadPlan({
      rootHandleAvailable: Boolean(rootHandle),
      isDirectory: isDir,
      mediaType,
      hasDirectThumbnailSource: thumbnailPlan.runtimeImageThumbnail || thumbnailPlan.fileAccessThumbnail,
      directThumbnailUrl: runtimeThumbnailUrl ?? fileAccessThumbnailUrl,
      requestIdentity,
      previousRequestIdentity: requestIdentityRef.current,
      exactCachedThumbnailUrl,
    })

    if (loadPlan.kind === 'reset') {
      setThumbnailUrl(null)
      setThumbnailUrlIdentity(null)
      setThumbnailState(loadPlan.thumbnailState)
      return
    }

    if (loadPlan.kind === 'direct-thumbnail') {
      if (loadPlan.shouldClearGeneratedThumbnail) {
        setThumbnailUrl(null)
        setThumbnailUrlIdentity(null)
      }
      setThumbnailState(loadPlan.thumbnailState)
      return
    }

    if (loadPlan.kind === 'cached-thumbnail') {
      requestIdentityRef.current = loadPlan.thumbnailUrlIdentity
      setThumbnailUrl(loadPlan.thumbnailUrl)
      setThumbnailUrlIdentity(loadPlan.thumbnailUrlIdentity)
      setThumbnailState(loadPlan.thumbnailState)
      return
    }

    const pipelineMediaType = mediaType
    const pipelineRootHandle = rootHandle
    if (!pipelineMediaType || !pipelineRootHandle) {
      return
    }

    requestIdentityRef.current = loadPlan.requestIdentity
    let cancelled = false
    const controller = new AbortController()

    const loadThumbnail = async () => {
      if (loadPlan.shouldClearGeneratedThumbnail) {
        setThumbnailUrl(null)
        setThumbnailUrlIdentity(null)
      }
      setThumbnailState('loading')

      try {
        if (runtimeVideoThumbnailSourceUrl) {
          const url = await requestThumbnailFromPipeline({
            sourceUrl: runtimeVideoThumbnailSourceUrl,
            filePath: file.path,
            fileSize: file.size,
            fileLastModifiedMs,
            sizePreset: thumbnailSizePreset,
            mediaType: pipelineMediaType,
            priority: thumbnailPriority,
            signal: controller.signal,
            crossOrigin: true,
          })

          if (!cancelled) {
            setThumbnailUrl(url)
            setThumbnailUrlIdentity(loadPlan.requestIdentity)
            setThumbnailState('ready')
          }
          return
        }

        const fileObj = await getFileFromPath(pipelineRootHandle, file.path)
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
          mediaType: pipelineMediaType,
          priority: thumbnailPriority,
          signal: controller.signal,
        })

        if (!cancelled) {
          setThumbnailUrl(url)
          setThumbnailUrlIdentity(loadPlan.requestIdentity)
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
    runtimeFileContentUrl,
    runtimeThumbnailUrl,
    runtimeVideoThumbnailSourceUrl,
    fileAccessThumbnailUrl,
    thumbnailPlan.fileAccessThumbnail,
    thumbnailPlan.runtimeImageThumbnail,
  ])

  useEffect(() => {
    if (!directoryBadge.shouldLoadDirectoryItemCount || !rootHandle || !isDir) {
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
  }, [rootHandle, isDir, file.path, directoryBadge.shouldLoadDirectoryItemCount])

  const getIcon = () => {
    if (isDir) return <FolderOpen size={iconSize} className="text-yellow-500" />
    if (displayedThumbnailUrl) return null
    if (previewKind === 'image') return <Image size={iconSize} className="text-green-500" />
    if (previewKind === 'video') return <Video size={iconSize} className="text-blue-500" />
    return <File size={iconSize} className="text-gray-500" />
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
        {...{ [GRID_SELECTABLE_ITEM_ATTR]: file.path }}
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
              draggable={false}
              className="w-full h-full object-cover"
              onLoad={() => setThumbnailState('ready')}
              onError={() => setThumbnailState('failed')}
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
          {isDir && directoryBadge.label !== null && (
            <span className="absolute right-1 top-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] leading-none text-secondary-foreground">
              {directoryBadge.label}
            </span>
          )}
        </div>
        <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm text-center" title={file.name}>
          {file.name}
        </span>
        {file.displayPath && file.displayPath !== file.name && (
          <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-center text-muted-foreground" title={file.displayPath}>
            {file.displayPath}
          </span>
        )}
        {!isDir && (
          <span className="text-xs text-muted-foreground">
            {formatFileGridCardFileSize(file.size)}
          </span>
        )}
      </button>
    </div>
  )
}
