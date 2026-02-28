import { useEffect, useState, useRef, useCallback } from 'react'
import { X, File, Image as ImageIcon, Video as VideoIcon, Loader2, FolderOpen, Play } from 'lucide-react'
import { getMediaType } from '@/lib/thumbnail'
import { createObjectUrlForFile } from '@/lib/fileSystem'
import { ensureRootPath, openWithSystemDefaultApp, revealInSystemExplorer } from '@/lib/reveal'
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
  const [playbackError, setPlaybackError] = useState(false)
  const [isRevealing, setIsRevealing] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
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
      setPlaybackError(false)

      try {
        const fileObj = await getFileFromPath(rootHandle, file.path)
        if (!fileObj || cancelled) return

        const nextUrl = createObjectUrlForFile(fileObj, file.name)
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

  const handleOpenWithSystemPlayer = async () => {
    if (file.kind !== 'file') return
    const rootLabel = rootHandle?.name || 'current-folder'
    const rootPath = ensureRootPath(rootLabel)
    if (!rootPath) return

    try {
      setOpenError(null)
      setIsOpening(true)
      await openWithSystemDefaultApp(file.path, rootPath)
    } catch (err) {
      setOpenError((err as Error).message || '打开系统播放器失败')
    } finally {
      setIsOpening(false)
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

      <div className="flex-1 min-h-0 flex">
        <div className="w-12 shrink-0 flex flex-col items-center gap-2 py-3 px-2 border-r border-border">
          <button
            type="button"
            onClick={() => void handleRevealInExplorer()}
            disabled={isRevealing}
            className="p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
            title="在文件资源管理器中显示"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          {isVideo && (
            <button
              type="button"
              onClick={() => void handleOpenWithSystemPlayer()}
              disabled={isOpening}
              className="p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
              title="用系统默认播放器打开"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          <div className="mt-auto space-y-1 text-[10px] text-destructive text-center">
            {openError && <p>{openError}</p>}
            {revealError && <p>{revealError}</p>}
          </div>
        </div>

        <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center p-4">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="w-full h-full flex items-center justify-center p-4">
              <div className="text-destructive text-sm text-center">
                <p>加载失败</p>
                <p className="text-xs mt-1">{error}</p>
              </div>
            </div>
          ) : previewUrl && isImage ? (
            <div className="w-full h-full p-4 min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
              <img
                src={previewUrl}
                alt={file.name}
                className="block w-auto h-auto max-w-full max-h-[85vh] object-contain"
              />
            </div>
          ) : previewUrl && isVideo ? (
            <div className="w-full h-full p-4 min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
              <video
                src={previewUrl}
                controls
                className="block w-auto h-auto max-w-full max-h-[85vh] object-contain"
                onError={() => setPlaybackError(true)}
              >
                您的浏览器不支持视频播放
              </video>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center p-4">
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
            </div>
          )}

          {playbackError && isVideo && (
            <div className="absolute bottom-2 left-2 right-2 rounded-md bg-black/55 px-3 py-2">
              <p className="text-xs text-white text-center">
                当前浏览器可能不支持该视频的编码格式（尤其常见于 AVI）。建议转码为 MP4(H.264/AAC) 后再播放。
              </p>
            </div>
          )}
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
