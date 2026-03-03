import type { ReactNode } from 'react'
import { File, Image as ImageIcon, Loader2, Video as VideoIcon } from 'lucide-react'
import type { FileItem } from '@/types'

const PREVIEW_MEDIA_CONTENT_CLASS = 'block w-auto max-w-full max-h-full h-[85vh] object-contain'

interface PreviewMediaViewportProps {
  file: FileItem
  previewUrl: string | null
  isLoading: boolean
  error: string | null
  isImage: boolean
  isVideo: boolean
  emptyTextClass: string
  errorTextClass: string
  onOpenFullscreen?: () => void
  autoPlayVideo: boolean
  onVideoEnded?: () => void
  onVideoRenderError?: () => void
  children?: ReactNode
}

export function PreviewMediaViewport({
  file,
  previewUrl,
  isLoading,
  error,
  isImage,
  isVideo,
  emptyTextClass,
  errorTextClass,
  onOpenFullscreen,
  autoPlayVideo,
  onVideoEnded,
  onVideoRenderError,
  children,
}: PreviewMediaViewportProps) {
  return (
    <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden" data-preview-subzone="PreviewMediaViewport">
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
              src={previewUrl}
              controls
              autoPlay={autoPlayVideo}
              className={PREVIEW_MEDIA_CONTENT_CLASS}
              onEnded={onVideoEnded}
              onError={onVideoRenderError}
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
      {children}
    </div>
  )
}
