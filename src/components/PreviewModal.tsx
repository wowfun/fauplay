import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { FileItem } from '@/types'

interface PreviewModalProps {
  file: FileItem
  fileUrl: string
  onClose: () => void
}

export function PreviewModal({ file, fileUrl, onClose }: PreviewModalProps) {
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
    setIsPlaying(false)
    setPlaybackError(false)
  }, [file])

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
