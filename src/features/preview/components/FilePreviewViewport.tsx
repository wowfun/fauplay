import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import { File, Image as ImageIcon, Loader2, Video as VideoIcon } from 'lucide-react'
import type { FileItem, FilePreviewKind, TextPreviewPayload } from '@/types'
import { PreviewFaceOverlay } from '@/features/faces/components/PreviewFaceOverlay'
import type { PreviewFaceOverlayItem } from '@/features/faces/types'

const PREVIEW_MEDIA_CONTENT_CLASS = 'block w-auto max-w-full max-h-full h-[85vh] object-contain'

interface FilePreviewViewportProps {
  file: FileItem
  previewKind: FilePreviewKind
  previewUrl: string | null
  videoSurface?: 'panel' | 'lightbox'
  textPreview: TextPreviewPayload
  fileMimeType: string | null
  fileSizeBytes: number | null
  fileLastModifiedMs: number | null
  isLoading: boolean
  error: string | null
  enableImageSwipe?: boolean
  emptyTextClass: string
  errorTextClass: string
  onOpenFullscreen?: () => void
  onNavigatePrev?: () => void
  onNavigateNext?: () => void
  autoPlayVideo: boolean
  videoPlaybackRate: number
  onVideoEnded?: () => void
  onVideoRenderError?: () => void
  showFaceOverlays?: boolean
  faceOverlays?: PreviewFaceOverlayItem[]
  faceOverlayLoading?: boolean
  faceOverlayError?: string | null
  onFaceOverlayClick?: (item: PreviewFaceOverlayItem) => void
  children?: ReactNode
}

function formatSize(bytes: number | null): string {
  if (typeof bytes !== 'number') return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatModifiedAt(timestamp: number | null): string {
  if (typeof timestamp !== 'number') return '未知'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function renderFileInfo(
  fileMimeType: string | null,
  fileSizeBytes: number | null,
  fileLastModifiedMs: number | null,
  className: string
) {
  return (
    <div className={`rounded border p-3 text-xs ${className}`}>
      <div className="space-y-1">
        <p>MIME：{fileMimeType || '未知'}</p>
        <p>大小：{formatSize(fileSizeBytes)}</p>
        <p>修改时间：{formatModifiedAt(fileLastModifiedMs)}</p>
      </div>
    </div>
  )
}

export function FilePreviewViewport({
  file,
  previewKind,
  previewUrl,
  videoSurface = 'panel',
  textPreview,
  fileMimeType,
  fileSizeBytes,
  fileLastModifiedMs,
  isLoading,
  error,
  enableImageSwipe = false,
  emptyTextClass,
  errorTextClass,
  onOpenFullscreen,
  onNavigatePrev,
  onNavigateNext,
  autoPlayVideo,
  videoPlaybackRate,
  onVideoEnded,
  onVideoRenderError,
  showFaceOverlays = false,
  faceOverlays = [],
  faceOverlayLoading = false,
  faceOverlayError = null,
  onFaceOverlayClick,
  children,
}: FilePreviewViewportProps) {
  const isImage = previewKind === 'image'
  const isVideo = previewKind === 'video'
  const isText = previewKind === 'text'
  const videoRef = useRef<HTMLVideoElement>(null)
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const touchSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number | null; height: number | null }>({
    width: null,
    height: null,
  })

  useEffect(() => {
    setImageNaturalSize({
      width: null,
      height: null,
    })
  }, [file.path, previewUrl])

  useEffect(() => {
    if (!isVideo) return
    const videoElement = videoRef.current
    if (!videoElement) return
    videoElement.defaultPlaybackRate = videoPlaybackRate
    videoElement.playbackRate = videoPlaybackRate
  }, [isVideo, videoPlaybackRate, previewUrl])

  const clearSwipeStart = () => {
    swipeStartRef.current = null
  }

  const clearTouchSwipeStart = () => {
    touchSwipeStartRef.current = null
  }

  const applySwipeNavigation = (deltaX: number, deltaY: number) => {
    if (Math.abs(deltaX) < 64) return
    if (Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return

    if (deltaX < 0) {
      onNavigateNext?.()
      return
    }

    onNavigatePrev?.()
  }

  const handleImagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enableImageSwipe || !onNavigatePrev || !onNavigateNext) return
    if (event.pointerType === 'mouse') return
    if (event.target instanceof HTMLElement && event.target.closest('[data-preview-face-overlay-interactive="true"]')) {
      return
    }

    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
  }

  const handleImagePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipeStart = swipeStartRef.current
    clearSwipeStart()
    if (!swipeStart || swipeStart.pointerId !== event.pointerId) return

    applySwipeNavigation(
      event.clientX - swipeStart.x,
      event.clientY - swipeStart.y,
    )
  }

  const handleImageTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (!enableImageSwipe || !onNavigatePrev || !onNavigateNext) return
    if (event.target instanceof HTMLElement && event.target.closest('[data-preview-face-overlay-interactive="true"]')) {
      return
    }

    const touch = event.touches[0]
    if (!touch) return

    touchSwipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }
  }

  const handleImageTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipeStart = touchSwipeStartRef.current
    clearTouchSwipeStart()
    if (!swipeStart) return

    const touch = event.changedTouches[0]
    if (!touch) return

    applySwipeNavigation(
      touch.clientX - swipeStart.x,
      touch.clientY - swipeStart.y,
    )
  }

  return (
    <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden" data-preview-subzone="FilePreviewViewport">
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
        <div
          className="w-full h-full p-4 min-h-0 min-w-0 flex items-center justify-center overflow-hidden"
          style={{ touchAction: enableImageSwipe ? 'pan-y' : undefined }}
          onPointerDown={handleImagePointerDown}
          onPointerUp={handleImagePointerEnd}
          onPointerCancel={clearSwipeStart}
          onTouchStart={handleImageTouchStart}
          onTouchEnd={handleImageTouchEnd}
          onTouchCancel={clearTouchSwipeStart}
        >
          <div className="relative inline-flex max-w-full max-h-full items-center justify-center">
            <img
              src={previewUrl}
              alt={file.name}
              className={PREVIEW_MEDIA_CONTENT_CLASS}
              draggable={false}
              onLoad={(event) => {
                const target = event.currentTarget
                setImageNaturalSize({
                  width: target.naturalWidth || null,
                  height: target.naturalHeight || null,
                })
              }}
              onDoubleClick={onOpenFullscreen}
            />
            {showFaceOverlays && (
              <PreviewFaceOverlay
                items={faceOverlays}
                imageNaturalWidth={imageNaturalSize.width}
                imageNaturalHeight={imageNaturalSize.height}
                isFullscreen={videoSurface === 'lightbox'}
                isLoading={faceOverlayLoading}
                error={faceOverlayError}
                onFaceClick={onFaceOverlayClick}
              />
            )}
          </div>
        </div>
      ) : previewUrl && isVideo ? (
        <div className="w-full h-full p-4 min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
          <div className="inline-flex max-w-full max-h-full items-center justify-center">
            <video
              ref={videoRef}
              src={previewUrl}
              controls
              autoPlay={autoPlayVideo}
              data-preview-video="true"
              data-preview-video-surface={videoSurface}
              className={PREVIEW_MEDIA_CONTENT_CLASS}
              onLoadedMetadata={() => {
                const videoElement = videoRef.current
                if (!videoElement) return
                videoElement.defaultPlaybackRate = videoPlaybackRate
                videoElement.playbackRate = videoPlaybackRate
              }}
              onEnded={onVideoEnded}
              onError={onVideoRenderError}
            >
              您的浏览器不支持视频播放
            </video>
          </div>
        </div>
      ) : isText ? (
        <div className="h-full min-h-0 p-4">
          {textPreview.status === 'ready' && textPreview.content !== null ? (
            <div className="flex h-full min-h-0 flex-col gap-3">
              {renderFileInfo(fileMimeType, fileSizeBytes, fileLastModifiedMs, 'border-border')}
              <pre className="min-h-0 flex-1 overflow-auto rounded border border-border bg-muted/30 p-3 text-xs leading-5 text-foreground">
                {textPreview.content}
              </pre>
            </div>
          ) : textPreview.status === 'too_large' ? (
            <div className="flex h-full items-center justify-center">
              <div className={`space-y-2 text-sm text-center ${emptyTextClass}`}>
                <p>文件过大，无法直接预览文本内容。</p>
                <p className="text-xs">
                  当前文件：{formatSize(textPreview.fileSizeBytes)}，上限：{formatSize(textPreview.sizeLimitBytes)}
                </p>
                {renderFileInfo(fileMimeType, fileSizeBytes, fileLastModifiedMs, 'border-border')}
              </div>
            </div>
          ) : textPreview.status === 'binary' ? (
            <div className="flex h-full items-center justify-center">
              <div className={`space-y-2 text-sm text-center ${emptyTextClass}`}>
                <p>检测到二进制内容，无法按文本预览。</p>
                {renderFileInfo(fileMimeType, fileSizeBytes, fileLastModifiedMs, 'border-border')}
              </div>
            </div>
          ) : textPreview.status === 'error' ? (
            <div className="flex h-full items-center justify-center">
              <div className={`space-y-2 text-sm text-center ${errorTextClass}`}>
                <p>文本预览失败</p>
                <p className="text-xs">{textPreview.error || '未知错误'}</p>
                {renderFileInfo(fileMimeType, fileSizeBytes, fileLastModifiedMs, 'border-border')}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
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
            <div className="mt-3 w-full max-w-sm">
              {renderFileInfo(fileMimeType, fileSizeBytes, fileLastModifiedMs, 'border-border')}
            </div>
          </div>
        </div>
      )}
      {children}
    </div>
  )
}
