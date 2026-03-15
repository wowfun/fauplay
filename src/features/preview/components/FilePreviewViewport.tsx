import { useEffect, useRef, type ReactNode } from 'react'
import { File, Image as ImageIcon, Loader2, Video as VideoIcon } from 'lucide-react'
import type { FileItem, FilePreviewKind, TextPreviewPayload } from '@/types'

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
  emptyTextClass: string
  errorTextClass: string
  onOpenFullscreen?: () => void
  autoPlayVideo: boolean
  videoPlaybackRate: number
  onVideoEnded?: () => void
  onVideoRenderError?: () => void
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
  emptyTextClass,
  errorTextClass,
  onOpenFullscreen,
  autoPlayVideo,
  videoPlaybackRate,
  onVideoEnded,
  onVideoRenderError,
  children,
}: FilePreviewViewportProps) {
  const isImage = previewKind === 'image'
  const isVideo = previewKind === 'video'
  const isText = previewKind === 'text'
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!isVideo) return
    const videoElement = videoRef.current
    if (!videoElement) return
    videoElement.defaultPlaybackRate = videoPlaybackRate
    videoElement.playbackRate = videoPlaybackRate
  }, [isVideo, videoPlaybackRate, previewUrl])

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
        <div className="w-full h-full p-4 min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
          <div className="inline-flex max-w-full max-h-full items-center justify-center">
            <img
              src={previewUrl}
              alt={file.name}
              className={PREVIEW_MEDIA_CONTENT_CLASS}
              onDoubleClick={onOpenFullscreen}
            />
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
