import { memo, forwardRef } from 'react'
import { FileGridViewport } from './FileGridViewport'
import type { FileGridViewportHandle } from './FileGridViewport'
import type { FileItem, ThumbnailSizePreset } from '@/types'

interface FileBrowserGridProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  thumbnailSizePreset: ThumbnailSizePreset
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
  selectionScopeKey: string
  canClearSelectionWithEscape: boolean
  onSelectionChange: (selectedPaths: string[]) => void
}

export type FileBrowserGridHandle = FileGridViewportHandle

const FileBrowserGridImpl = forwardRef<FileBrowserGridHandle, FileBrowserGridProps>(function FileBrowserGridImpl({
  files,
  rootHandle,
  thumbnailSizePreset,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
  selectionScopeKey,
  canClearSelectionWithEscape,
  onSelectionChange,
}, ref) {
  return (
    <FileGridViewport
      ref={ref}
      files={files}
      rootHandle={rootHandle}
      thumbnailSizePreset={thumbnailSizePreset}
      onFileClick={onFileClick}
      onFileDoubleClick={onFileDoubleClick}
      onDirectoryClick={onDirectoryClick}
      selectionScopeKey={selectionScopeKey}
      canClearSelectionWithEscape={canClearSelectionWithEscape}
      onSelectionChange={onSelectionChange}
    />
  )
})

FileBrowserGridImpl.displayName = 'FileBrowserGrid'

export const FileBrowserGrid = memo(FileBrowserGridImpl)
