import { memo, forwardRef } from 'react'
import { VirtualGrid } from './VirtualGrid'
import type { VirtualGridHandle } from './VirtualGrid'
import type { FileItem } from '@/types'

interface FileGridProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
}

export type FileGridHandle = VirtualGridHandle

const FileGridImpl = forwardRef<FileGridHandle, FileGridProps>(function FileGridImpl({
  files,
  rootHandle,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
}, ref) {
  return (
    <VirtualGrid
      ref={ref}
      files={files}
      rootHandle={rootHandle}
      onFileClick={onFileClick}
      onFileDoubleClick={onFileDoubleClick}
      onDirectoryClick={onDirectoryClick}
    />
  )
})

FileGridImpl.displayName = 'FileGrid'

export const FileGrid = memo(FileGridImpl)
