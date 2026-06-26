import type { MouseEvent as ReactMouseEvent } from 'react'
import { FolderOpen, File as FileIcon, Image, Video, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GRID_SELECTABLE_ITEM_ATTR } from '@/hooks/useGridSelection'
import type { ThumbnailTaskPriority } from '@/lib/thumbnailPipeline'
import type { FileItem, ThumbnailSizePreset } from '@/types'
import { useFileGridCardDirectoryBadge } from '@/features/explorer/hooks/useFileGridCardDirectoryBadge'
import { useFileGridCardThumbnail } from '@/features/explorer/hooks/useFileGridCardThumbnail'
import { resolveFileGridCardTextView } from '@/features/explorer/lib/fileGridCardModel'
import type {
  FileGridCardIconKind,
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
  const thumbnailBoxSize = THUMBNAIL_BOX_SIZE_BY_PRESET[thumbnailSizePreset]
  const iconSize = ICON_SIZE_BY_PRESET[thumbnailSizePreset]
  const directoryBadge = useFileGridCardDirectoryBadge({
    file,
    rootHandle,
  })
  const textView = resolveFileGridCardTextView(file)
  const {
    thumbnailFrameView,
    handleThumbnailImageLoad,
    handleThumbnailImageError,
  } = useFileGridCardThumbnail({
    file,
    rootHandle,
    thumbnailSizePreset,
    thumbnailPriority,
    directoryBadgeLabel: directoryBadge.label,
  })

  const renderIcon = (kind: FileGridCardIconKind | null) => {
    if (kind === 'folder') return <FolderOpen size={iconSize} className="text-yellow-500" />
    if (kind === 'image') return <Image size={iconSize} className="text-green-500" />
    if (kind === 'video') return <Video size={iconSize} className="text-blue-500" />
    if (kind === 'file') return <FileIcon size={iconSize} className="text-gray-500" />
    return null
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
          {thumbnailFrameView.content.kind === 'thumbnail' ? (
            <img
              src={thumbnailFrameView.content.url}
              alt={file.name}
              draggable={false}
              className="w-full h-full object-cover"
              onLoad={handleThumbnailImageLoad}
              onError={handleThumbnailImageError}
            />
          ) : thumbnailFrameView.content.kind === 'loading' ? (
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          ) : (
            renderIcon(thumbnailFrameView.content.iconKind)
          )}
          {thumbnailFrameView.showFailedBadge && (
            <span className="absolute bottom-1 rounded bg-destructive/90 px-1.5 py-0.5 text-[10px] leading-none text-destructive-foreground">
              失败
            </span>
          )}
          {thumbnailFrameView.directoryBadgeLabel !== null && (
            <span className="absolute right-1 top-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] leading-none text-secondary-foreground">
              {thumbnailFrameView.directoryBadgeLabel}
            </span>
          )}
        </div>
        <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm text-center" title={textView.nameTitle}>
          {textView.nameLabel}
        </span>
        {textView.displayPathLabel !== null && (
          <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-center text-muted-foreground" title={textView.displayPathTitle ?? undefined}>
            {textView.displayPathLabel}
          </span>
        )}
        {textView.fileSizeLabel !== null && (
          <span className="text-xs text-muted-foreground">
            {textView.fileSizeLabel}
          </span>
        )}
      </button>
    </div>
  )
}
