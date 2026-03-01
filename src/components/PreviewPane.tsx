import { useEffect, useState, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { createObjectUrlForFile } from '@/lib/fileSystem'
import type { FileItem } from '@/types'
import { PreviewContent } from '@/components/PreviewContent'

interface PreviewPaneProps {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  canRevealInExplorer: boolean
  canOpenWithSystemPlayer: boolean
  onClose: () => void
  onOpenFullscreen: () => void
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  traversalOrder: 'sequential' | 'shuffle'
  onToggleTraversalOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoEnded: () => void
  onVideoPlaybackError: () => void
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

export function PreviewPane({
  file,
  rootHandle,
  canRevealInExplorer,
  canOpenWithSystemPlayer,
  onClose,
  onOpenFullscreen,
  canPrev,
  canNext,
  onPrev,
  onNext,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  traversalOrder,
  onToggleTraversalOrder,
  onAutoPlayIntervalChange,
  onVideoEnded,
  onVideoPlaybackError,
}: PreviewPaneProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  return (
    <div
      className="flex flex-col h-full bg-card border-l border-border"
    >
      <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
        <span className="text-sm font-medium truncate pr-2">{file.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleTraversalOrder}
            className={`h-8 rounded-md px-2 text-xs transition-colors ${
              traversalOrder === 'shuffle'
                ? 'bg-primary/15 text-primary hover:bg-primary/20'
                : 'bg-accent text-accent-foreground hover:bg-accent/80'
            }`}
            aria-label={traversalOrder === 'shuffle' ? '切换为顺序遍历' : '切换为随机遍历'}
            title={traversalOrder === 'shuffle' ? '切换为顺序遍历' : '切换为随机遍历'}
          >
            {traversalOrder === 'shuffle' ? '随机' : '顺序'}
          </button>
          <select
            value={autoPlayIntervalSec}
            onChange={(event) => onAutoPlayIntervalChange(Number(event.target.value))}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            aria-label="自动播放速度（秒）"
            title="自动播放速度（秒）"
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {value}s
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onToggleAutoPlay}
            className={`h-8 rounded-md px-2 text-xs transition-colors ${
              autoPlayEnabled
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-accent text-accent-foreground hover:bg-accent/80'
            }`}
            aria-label={autoPlayEnabled ? '暂停自动播放' : '开始自动播放'}
            title={autoPlayEnabled ? '暂停自动播放' : '开始自动播放'}
          >
            {autoPlayEnabled ? '暂停' : '自动播放'}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <PreviewContent
        file={file}
        rootHandle={rootHandle}
        canRevealInExplorer={canRevealInExplorer}
        canOpenWithSystemPlayer={canOpenWithSystemPlayer}
        previewUrl={previewUrl}
        isLoading={isLoading}
        error={error}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={onPrev}
        onNext={onNext}
        onOpenFullscreen={onOpenFullscreen}
        autoPlayVideo={autoPlayEnabled}
        onVideoEnded={onVideoEnded}
        onVideoPlaybackError={onVideoPlaybackError}
      />
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
