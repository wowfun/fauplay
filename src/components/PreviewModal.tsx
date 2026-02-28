import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { FileItem } from '@/types'

interface PreviewModalProps {
  file: FileItem
  fileUrl: string
  onClose: () => void
  autoPlayOnOpen?: boolean
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}

export function PreviewModal({
  file,
  fileUrl,
  onClose,
  autoPlayOnOpen = false,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: PreviewModalProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackError, setPlaybackError] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === ' ') {
        if (/\.(mp4|webm|mov|avi|mkv|ogg)$/i.test(file.name)) {
          e.preventDefault()
          setIsPlaying(p => !p)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, file.name])

  useEffect(() => {
    const isVideoFile = /\.(mp4|webm|mov|avi|mkv|ogg)$/i.test(file.name)
    setIsPlaying(autoPlayOnOpen && isVideoFile)
    setPlaybackError(false)
  }, [file, autoPlayOnOpen])

  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(file.name)
  const isVideo = /\.(mp4|webm|mov|avi|mkv|ogg)$/i.test(file.name)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
      >
        <X className="w-6 h-6 text-white" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onPrev()
        }}
        disabled={!canPrev}
        className="absolute left-0 top-0 bottom-0 z-10 w-16 disabled:pointer-events-none disabled:opacity-0 hover:bg-white/10 transition-colors"
        title="上一个文件"
      >
        <span className="sr-only">上一个文件</span>
        {canPrev && <ChevronLeft className="mx-auto h-8 w-8 text-white" />}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onNext()
        }}
        disabled={!canNext}
        className="absolute right-0 top-0 bottom-0 z-10 w-16 disabled:pointer-events-none disabled:opacity-0 hover:bg-white/10 transition-colors"
        title="下一个文件"
      >
        <span className="sr-only">下一个文件</span>
        {canNext && <ChevronRight className="mx-auto h-8 w-8 text-white" />}
      </button>

      <div
        className="max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {isImage && (
          <img
            src={fileUrl}
            alt={file.name}
            className="max-w-full max-h-[90vh] object-contain"
          />
        )}

        {isVideo && (
          <div className="max-w-full">
            <video
              src={fileUrl}
              controls
              autoPlay={isPlaying}
              className="max-w-full max-h-[90vh]"
              onError={() => setPlaybackError(true)}
            >
              您的浏览器不支持视频播放
            </video>
            {playbackError && (
              <p className="text-xs text-white/80 mt-2 text-center">
                当前浏览器可能不支持该视频编码（AVI 更常见），建议转码为 MP4(H.264/AAC)。
              </p>
            )}
          </div>
        )}

        <div className="text-center text-white mt-4">
          <p className="text-lg font-medium">{file.name}</p>
        </div>
      </div>
    </div>
  )
}
