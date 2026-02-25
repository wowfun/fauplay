import { FileItemCard } from './FileItemCard'
import type { FileItem } from '@/types'

interface FileGridProps {
  files: FileItem[]
  onFileClick: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
}

export function FileGrid({ files, onFileClick, onDirectoryClick }: FileGridProps) {
  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>没有文件</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {files.map((file) => (
          <FileItemCard
            key={file.path}
            file={file}
            onClick={() => {
              if (file.kind === 'directory') {
                onDirectoryClick(file.name)
              } else {
                onFileClick(file)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}
