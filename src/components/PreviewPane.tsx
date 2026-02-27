import { useEffect, useState, useRef, useCallback } from 'react'
import { X, File, Image as ImageIcon, Video as VideoIcon, Loader2 } from 'lucide-react'
import { getMediaType } from '@/lib/thumbnail'
import { ensureRootPath, revealInSystemExplorer } from '@/lib/reveal'
import type { FileItem } from '@/types'

interface PreviewPaneProps {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  onClose: () => void
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

export function PreviewPane({ file, rootHandle, onClose }: PreviewPaneProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRevealing, setIsRevealing] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)
  const currentUrlRef = useRef<string | null>(null)

  const replacePreviewUrl = useCallback((nextUrl: string | null) => {
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current)
    }
    currentUrlRef.current = nextUrl
    setPreviewUrl(nextUrl)
  }, [])

  useEffect(() => {
    if (!file || !rootHandle) {
      replacePreviewUrl(null)
      return
    }

    let cancelled = false

    const loadFile = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const fileObj = await getFileFromPath(rootHandle, file.path)
        if (!fileObj || cancelled) return

        const nextUrl = URL.createObjectURL(fileObj)
        if (cancelled) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        replacePreviewUrl(nextUrl)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadFile()

    return () => {
      cancelled = true
    }
  }, [file, rootHandle, replacePreviewUrl])

  useEffect(() => {
    return () => {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current)
      }
    }
  }, [])

  if (!file) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-muted-foreground p-4"
      >
        <p className="text-sm">选择文件以预览</p>
      </div>
    )
  }

  const isImage = getMediaType(file.name) === 'image'
  const isVideo = getMediaType(file.name) === 'video'

  const formatSize = (bytes?: number) => {
    if (!bytes) return '未知'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (date?: Date) => {
    if (!date) return '未知'
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleRevealInExplorer = async () => {
    if (file.kind !== 'file') return
    const rootLabel = rootHandle?.name || 'current-folder'
    const rootPath = ensureRootPath(rootLabel)
    if (!rootPath) return

    try {
      setRevealError(null)
      setIsRevealing(true)
      await revealInSystemExplorer(file.path, rootPath)
    } catch (err) {
      setRevealError((err as Error).message || '打开资源管理器失败')
    } finally {
      setIsRevealing(false)
    }
  }

  return (
    <div
      className="flex flex-col h-full bg-card border-l border-border"
    >
      <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
        <span className="text-sm font-medium truncate">{file.name}</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-accent rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden min-h-0">
        {isLoading ? (
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        ) : error ? (
          <div className="text-destructive text-sm text-center">
            <p>加载失败</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        ) : previewUrl && isImage ? (
          <img
            src={previewUrl}
            alt={file.name}
            className="max-w-full"
            style={{ maxHeight: 'calc(100vh - 250px)', height: 'auto' }}
          />
        ) : previewUrl && isVideo ? (
          <video
            src={previewUrl}
            controls
            className="max-w-full"
            style={{ maxHeight: 'calc(100vh - 250px)' }}
          >
            您的浏览器不支持视频播放
          </video>
        ) : (
          <div className="flex flex-col items-center text-muted-foreground">
            {isImage ? (
              <ImageIcon className="w-16 h-16 mb-2" />
            ) : isVideo ? (
              <VideoIcon className="w-16 h-16 mb-2" />
            ) : (
              <File className="w-16 h-16 mb-2" />
            )}
            <p className="text-sm">无法预览此文件</p>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-border space-y-2">
        <button
          type="button"
          onClick={() => void handleRevealInExplorer()}
          disabled={isRevealing}
          className="w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50"
        >
          {isRevealing ? '正在打开资源管理器...' : '在文件资源管理器中显示'}
        </button>
        {revealError && (
          <p className="text-xs text-destructive">{revealError}</p>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">大小</span>
          <span>{formatSize(file.size)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">修改时间</span>
          <span>{formatDate(file.lastModified)}</span>
        </div>
      </div>
    </div>
  )
}

interface ResizerProps {
  onResize: (delta: number) => void
}

export function PaneResizer({ onResize }: ResizerProps) {
  const isDragging = useRef(false)
  const startX = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    startX.current = e.clientX

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - startX.current
      startX.current = e.clientX
      onResize(delta)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [onResize])

  return (
    <div
      className="w-1 hover:w-1 bg-transparent hover:bg-primary/50 cursor-col-resize transition-colors absolute left-0 top-0 bottom-0 z-10"
      onMouseDown={handleMouseDown}
    />
  )
}
