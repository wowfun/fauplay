import { memo, forwardRef } from 'react'
import { FileGridViewport } from './FileGridViewport'
import type { FileGridViewportHandle } from './FileGridViewport'
import type { FileItem } from '@/types'

interface FileBrowserGridProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
}

export type FileBrowserGridHandle = FileGridViewportHandle

const FileBrowserGridImpl = forwardRef<FileBrowserGridHandle, FileBrowserGridProps>(function FileBrowserGridImpl({
  files,
  rootHandle,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
}, ref) {
  return (
    <FileGridViewport
      ref={ref}
      files={files}
      rootHandle={rootHandle}
      onFileClick={onFileClick}
      onFileDoubleClick={onFileDoubleClick}
      onDirectoryClick={onDirectoryClick}
    />
  )
})

FileBrowserGridImpl.displayName = 'FileBrowserGrid'

export const FileBrowserGrid = memo(FileBrowserGridImpl)
