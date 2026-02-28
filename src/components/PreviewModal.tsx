import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { FileItem } from '@/types'
import { PreviewContent } from '@/components/PreviewContent'

interface PreviewModalProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
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
  rootHandle,
  fileUrl,
  onClose,
  autoPlayOnOpen = false,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: PreviewModalProps) {
  const [isPlaying, setIsPlaying] = useState(false)

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
  }, [file, autoPlayOnOpen])

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
        <span className="text-sm font-medium truncate">{file.name}</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-accent rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <PreviewContent
          file={file}
          rootHandle={rootHandle}
          previewUrl={fileUrl}
          isLoading={false}
          error={null}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={onPrev}
          onNext={onNext}
          autoPlayVideo={isPlaying}
          isFullscreen
        />
      </div>
    </div>
  )
}
