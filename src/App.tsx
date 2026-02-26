import { useState, useCallback, useMemo, useEffect } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { useFileSystem } from '@/hooks/useFileSystem'
import { FileGrid } from '@/components/FileGrid'
import { Toolbar } from '@/components/Toolbar'
import { PreviewModal } from '@/components/PreviewModal'
import type { FileItem, FilterState } from '@/types'

const defaultFilter: FilterState = {
  search: '',
  type: 'all',
  sortBy: 'name',
  sortOrder: 'asc',
}

function App() {
  const {
    rootHandle,
    files,
    currentPath,
    isLoading,
    error,
    selectDirectory,
    navigateToDirectory,
    navigateUp,
    filterFiles,
  } = useFileSystem()

  const [filter, setFilter] = useState<FilterState>(defaultFilter)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const filteredFiles = useMemo(() => {
    return filterFiles(files, filter)
  }, [files, filter, filterFiles])

  useEffect(() => {
    if (previewFile && rootHandle) {
      const loadUrl = async () => {
        try {
          const pathParts = previewFile.path.split('/')
          let current: FileSystemHandle = rootHandle

          for (let i = 0; i < pathParts.length - 1; i++) {
            current = await (current as FileSystemDirectoryHandle).getDirectory(pathParts[i])
          }

          const fileName = pathParts[pathParts.length - 1]
          const fileHandle = await (current as FileSystemDirectoryHandle).getFileHandle(fileName)
          const file = await fileHandle.getFile()
          const url = URL.createObjectURL(file)
          setPreviewUrl(url)
        } catch (err) {
          console.error('Failed to load file:', err)
          setPreviewUrl(null)
        }
      }
      loadUrl()

      return () => {
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl)
        }
      }
    } else {
      setPreviewUrl(null)
    }
  }, [previewFile, rootHandle])

  const handleDirectoryClick = useCallback((dirName: string) => {
    navigateToDirectory(dirName)
  }, [navigateToDirectory])

  const handlePreview = useCallback((file: FileItem) => {
    setPreviewFile(file)
  }, [])

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }, [previewUrl])

  if (!rootHandle) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
        <div className="text-center max-w-md">
          <h1 className="text-4xl font-bold mb-4">Fauplay</h1>
          <p className="text-muted-foreground mb-8">
            选择一个本地文件夹开始浏览图片和视频
          </p>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}

          <button
            onClick={selectDirectory}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <FolderOpen className="w-5 h-5" />
            )}
            选择文件夹
          </button>

          <p className="text-xs text-muted-foreground mt-8">
            支持 Chrome 94+、Edge 94+、Firefox 111+
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        currentPath={currentPath}
        onNavigateUp={navigateUp}
      />

      {error && (
        <div className="mx-4 mt-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <FileGrid
          files={filteredFiles}
          rootHandle={rootHandle}
          onFileClick={handlePreview}
          onDirectoryClick={handleDirectoryClick}
        />
      )}

      {previewFile && previewUrl && (
        <PreviewModal
          file={previewFile}
          fileUrl={previewUrl}
          onClose={handleClosePreview}
        />
      )}
    </div>
  )
}

export default App
