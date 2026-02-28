import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { useFileSystem } from '@/hooks/useFileSystem'
import { FileGrid } from '@/components/FileGrid'
import { Toolbar } from '@/components/Toolbar'
import { PreviewModal } from '@/components/PreviewModal'
import { PreviewPane } from '@/components/PreviewPane'
import { createObjectUrlForFile, isImageFile, isVideoFile } from '@/lib/fileSystem'
import type { FileItem, FilterState } from '@/types'
import { StatusBar } from '@/components/StatusBar'

const MIN_PANE_WIDTH_RATIO = 0.15
const MAX_PANE_WIDTH_RATIO = 0.75
const DEFAULT_PANE_WIDTH_RATIO = 0.4

const defaultFilter: FilterState = {
  search: '',
  type: 'all',
  hideEmptyFolders: true,
  sortBy: 'name',
  sortOrder: 'asc',
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
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
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [paneWidthRatio, setPaneWidthRatio] = useState(DEFAULT_PANE_WIDTH_RATIO)
  const [showPreviewPane, setShowPreviewPane] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  const filteredFiles = useMemo(() => {
    return filterFiles(files, filter)
  }, [files, filter, filterFiles])

  const totalCount = useMemo(() => files.length, [files])
  const imageCount = useMemo(
    () => files.filter((file) => file.kind === 'file' && isImageFile(file.name)).length,
    [files]
  )
  const videoCount = useMemo(
    () => files.filter((file) => file.kind === 'file' && isVideoFile(file.name)).length,
    [files]
  )

  useEffect(() => {
    if (previewFile && rootHandle) {
      const loadUrl = async () => {
        try {
          const pathParts = previewFile.path.split('/')
          let current: FileSystemHandle = rootHandle

          for (let i = 0; i < pathParts.length - 1; i++) {
            current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(pathParts[i])
          }

          const fileName = pathParts[pathParts.length - 1]
          const fileHandle = await (current as FileSystemDirectoryHandle).getFileHandle(fileName)
          const file = await fileHandle.getFile()
          const url = createObjectUrlForFile(file, fileName)
          previewUrlRef.current = url
          setPreviewUrl(url)
        } catch (err) {
          console.error('Failed to load file:', err)
          setPreviewUrl(null)
        }
      }
      loadUrl()

      return () => {
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current)
          previewUrlRef.current = null
        }
      }
    } else {
      setPreviewUrl(null)
    }
  }, [previewFile, rootHandle])

  const handleDirectoryClick = useCallback((dirName: string) => {
    navigateToDirectory(dirName)
  }, [navigateToDirectory])

  const handleFileClick = useCallback((file: FileItem) => {
    if (file.kind === 'directory') {
      navigateToDirectory(file.name)
    } else {
      setSelectedFile(file)
      setShowPreviewPane(true)
      if (previewFile) {
        setPreviewFile(file)
      }
    }
  }, [navigateToDirectory, previewFile])

  const handleFileDoubleClick = useCallback((file: FileItem) => {
    if (file.kind === 'file') {
      setPreviewFile(file)
    }
  }, [])

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }, [previewUrl])

  const handleClosePane = useCallback(() => {
    setShowPreviewPane(false)
  }, [])

  useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedFile(null)
      return
    }
    if (!selectedFile) return
    const stillExists = filteredFiles.some((item) => item.path === selectedFile.path)
    if (!stillExists) {
      setSelectedFile(filteredFiles[0])
      setShowPreviewPane(filteredFiles[0].kind === 'file')
    }
  }, [filteredFiles, selectedFile])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const isTyping = isTypingTarget(event.target)
      const key = event.key.toLowerCase()

      // Ctrl/Cmd + O: open folder picker
      if ((event.ctrlKey || event.metaKey) && key === 'o') {
        event.preventDefault()
        void selectDirectory()
        return
      }

      // Ignore most global shortcuts while user is typing
      if (isTyping) return

      // Backspace: navigate up one level
      if (event.key === 'Backspace' && currentPath) {
        event.preventDefault()
        void navigateUp()
        return
      }

      // Escape: close modal first, then side preview pane
      if (event.key === 'Escape') {
        if (previewFile) {
          event.preventDefault()
          handleClosePreview()
          return
        }
        if (showPreviewPane) {
          event.preventDefault()
          handleClosePane()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectDirectory,
    navigateUp,
    currentPath,
    previewFile,
    showPreviewPane,
    handleClosePreview,
    handleClosePane,
  ])

  if (!rootHandle) {
    return (
      <div className="h-screen bg-background flex flex-col items-center justify-center p-8 overflow-hidden">
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
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        currentPath={currentPath}
        onNavigateUp={navigateUp}
        totalCount={totalCount}
        imageCount={imageCount}
        videoCount={videoCount}
      />

      {error && (
        <div className="mx-4 mt-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <FileGrid
            files={filteredFiles}
            rootHandle={rootHandle}
            onFileClick={handleFileClick}
            onFileDoubleClick={handleFileDoubleClick}
            onDirectoryClick={handleDirectoryClick}
          />
        )}

        {showPreviewPane && (
          <div 
            ref={contentRef}
            className="flex-shrink-0 h-full relative overflow-hidden" 
            style={{ width: `${paneWidthRatio * 100}%` }}
          >
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 bg-transparent transition-colors z-10"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startRatio = paneWidthRatio

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  const containerWidth = contentRef.current?.parentElement?.offsetWidth || window.innerWidth
                  const delta = (startX - moveEvent.clientX) / containerWidth
                  const newRatio = startRatio + delta
                  setPaneWidthRatio(Math.min(MAX_PANE_WIDTH_RATIO, Math.max(MIN_PANE_WIDTH_RATIO, newRatio)))
                }

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }

                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
              }}
            />
            <PreviewPane
              file={selectedFile}
              rootHandle={rootHandle}
              onClose={handleClosePane}
            />
          </div>
        )}
      </div>

      <StatusBar
        visibleFiles={filteredFiles}
        selectedFile={selectedFile}
      />

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
