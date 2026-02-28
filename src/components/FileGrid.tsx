import { memo } from 'react'
import { VirtualGrid } from './VirtualGrid'
import type { FileItem } from '@/types'

interface FileGridProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
}

function FileGridImpl({
  files,
  rootHandle,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
}: FileGridProps) {
  return (
    <VirtualGrid
      files={files}
      rootHandle={rootHandle}
      onFileClick={onFileClick}
      onFileDoubleClick={onFileDoubleClick}
      onDirectoryClick={onDirectoryClick}
    />
  )
}

export const FileGrid = memo(FileGridImpl)
