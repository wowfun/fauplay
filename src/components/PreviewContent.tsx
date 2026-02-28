import { useEffect, useState } from 'react'
import {
  File,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  FolderOpen,
  Play,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { getMediaType } from '@/lib/thumbnail'
import { ensureRootPath, openWithSystemDefaultApp, revealInSystemExplorer } from '@/lib/reveal'
import type { FileItem } from '@/types'

interface PreviewContentProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  previewUrl: string | null
  isLoading: boolean
  error: string | null
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onOpenFullscreen?: () => void
  autoPlayVideo?: boolean
  isFullscreen?: boolean
}

export function PreviewContent({
  file,
  rootHandle,
  previewUrl,
  isLoading,
  error,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onOpenFullscreen,
  autoPlayVideo = false,
  isFullscreen = false,
}: PreviewContentProps) {
  const [playbackError, setPlaybackError] = useState(false)
  const [isRevealing, setIsRevealing] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  const isImage = getMediaType(file.name) === 'image'
  const isVideo = getMediaType(file.name) === 'video'
  const panelBorderClass = isFullscreen ? 'border-white/10' : 'border-border'
  const mediaMaxHeightClass = isFullscreen ? 'max-h-[90vh]' : 'max-h-[85vh]'
  const railButtonClass = isFullscreen
    ? 'p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-50 text-white'
    : 'p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50'
  const navButtonClass = isFullscreen
    ? 'absolute -left-12 top-0 bottom-0 z-10 w-12 opacity-0 hover:opacity-100 focus-visible:opacity-100 hover:bg-white/10 transition-opacity disabled:pointer-events-none disabled:opacity-0'
    : 'absolute -left-12 top-0 bottom-0 z-10 w-12 opacity-0 hover:opacity-100 focus-visible:opacity-100 hover:bg-black/10 transition-opacity disabled:pointer-events-none disabled:opacity-0'
  const navButtonRightClass = isFullscreen
    ? 'absolute -right-12 top-0 bottom-0 z-10 w-12 opacity-0 hover:opacity-100 focus-visible:opacity-100 hover:bg-white/10 transition-opacity disabled:pointer-events-none disabled:opacity-0'
    : 'absolute -right-12 top-0 bottom-0 z-10 w-12 opacity-0 hover:opacity-100 focus-visible:opacity-100 hover:bg-black/10 transition-opacity disabled:pointer-events-none disabled:opacity-0'
  const iconClass = isFullscreen ? 'mx-auto h-6 w-6 text-white' : 'mx-auto h-6 w-6 text-white drop-shadow'
  const emptyTextClass = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const errorTextClass = isFullscreen ? 'text-red-300' : 'text-destructive'

  useEffect(() => {
    setPlaybackError(false)
    setOpenError(null)
    setRevealError(null)
  }, [file.path])

  const handleRevealInExplorer = async () => {
    if (file.kind !== 'file' || !rootHandle) return
    const rootLabel = rootHandle.name || 'current-folder'
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
    if (file.kind !== 'file' || !rootHandle) return
    const rootLabel = rootHandle.name || 'current-folder'
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
    <div className="flex-1 min-h-0 flex">
      <div className={`w-12 shrink-0 flex flex-col items-center gap-2 py-3 px-2 border-r ${panelBorderClass}`}>
        <button
          type="button"
          onClick={() => void handleRevealInExplorer()}
          disabled={isRevealing || !rootHandle}
          className={railButtonClass}
          title="在文件资源管理器中显示"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        {isVideo && (
          <button
            type="button"
            onClick={() => void handleOpenWithSystemPlayer()}
            disabled={isOpening || !rootHandle}
            className={railButtonClass}
            title="用系统默认播放器打开"
          >
            <Play className="w-4 h-4" />
          </button>
        )}
        <div className={`mt-auto space-y-1 text-[10px] text-center ${errorTextClass}`}>
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
            <div className={`text-sm text-center ${errorTextClass}`}>
              <p>加载失败</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          </div>
        ) : previewUrl && isImage ? (
          <div className="w-full h-full p-4 min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
            <div className="relative inline-flex max-w-full max-h-full items-center justify-center">
              <button
                type="button"
                onClick={onPrev}
                disabled={!canPrev}
                className={navButtonClass}
                title="上一个文件"
              >
                <span className="sr-only">上一个文件</span>
                {canPrev && <ChevronLeft className={iconClass} />}
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!canNext}
                className={navButtonRightClass}
                title="下一个文件"
              >
                <span className="sr-only">下一个文件</span>
                {canNext && <ChevronRight className={iconClass} />}
              </button>
              <img
                src={previewUrl}
                alt={file.name}
                className={`block w-auto h-auto max-w-full ${mediaMaxHeightClass} object-contain`}
                onDoubleClick={onOpenFullscreen}
              />
            </div>
          </div>
        ) : previewUrl && isVideo ? (
          <div className="w-full h-full p-4 min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
            <div className="relative inline-flex max-w-full max-h-full items-center justify-center">
              <button
                type="button"
                onClick={onPrev}
                disabled={!canPrev}
                className={navButtonClass}
                title="上一个文件"
              >
                <span className="sr-only">上一个文件</span>
                {canPrev && <ChevronLeft className={iconClass} />}
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!canNext}
                className={navButtonRightClass}
                title="下一个文件"
              >
                <span className="sr-only">下一个文件</span>
                {canNext && <ChevronRight className={iconClass} />}
              </button>
              <video
                src={previewUrl}
                controls
                autoPlay={autoPlayVideo}
                className={`block w-auto h-auto max-w-full ${mediaMaxHeightClass} object-contain`}
                onError={() => setPlaybackError(true)}
              >
                您的浏览器不支持视频播放
              </video>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center p-4">
            <div className={`flex flex-col items-center ${emptyTextClass}`}>
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
  )
}
