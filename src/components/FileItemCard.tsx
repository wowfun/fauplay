import { FolderOpen, File, Image, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileItem } from '@/types'

interface FileItemCardProps {
  file: FileItem
  onClick: () => void
}

export function FileItemCard({ file, onClick }: FileItemCardProps) {
  const isDir = file.kind === 'directory'
  const isImage = !isDir && /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(file.name)
  const isVideo = !isDir && /\.(mp4|webm|mov|avi|mkv|ogg)$/i.test(file.name)

  const getIcon = () => {
    if (isDir) return <FolderOpen className="w-12 h-12 text-yellow-500" />
    if (isImage) return <Image className="w-12 h-12 text-green-500" />
    if (isVideo) return <Video className="w-12 h-12 text-blue-500" />
    return <File className="w-12 h-12 text-gray-500" />
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex flex-col items-center p-3 rounded-lg cursor-pointer transition-colors",
        "hover:bg-accent/50"
      )}
    >
      <div className="w-20 h-20 flex items-center justify-center mb-2">
        {getIcon()}
      </div>
      <span className="text-sm text-center line-clamp-2 w-full" title={file.name}>
        {file.name}
      </span>
      {!isDir && (
        <span className="text-xs text-muted-foreground">
          {formatSize(file.size)}
        </span>
      )}
    </div>
  )
}
