import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { FileItem } from '@/types'
import { PreviewContent } from '@/components/PreviewContent'
import { keyboardShortcuts } from '@/config/shortcuts'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import { isVideoFile } from '@/lib/fileSystem'

interface PreviewModalProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  fileUrl: string
  canRevealInExplorer: boolean
  canOpenWithSystemPlayer: boolean
  onClose: () => void
  autoPlayOnOpen?: boolean
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

export function PreviewModal({
  file,
  rootHandle,
  fileUrl,
  canRevealInExplorer,
  canOpenWithSystemPlayer,
  onClose,
  autoPlayOnOpen = false,
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
}: PreviewModalProps) {
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesAnyShortcut(e, keyboardShortcuts.previewModal.close)) {
        onClose()
        return
      }

      if (isTypingTarget(e.target)) return

      if (matchesAnyShortcut(e, keyboardShortcuts.previewModal.toggleVideoPlayback) && isVideoFile(file.name)) {
        e.preventDefault()
        setIsPlaying((p) => !p)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, file.name])

  useEffect(() => {
    const isCurrentFileVideo = isVideoFile(file.name)
    setIsPlaying((autoPlayOnOpen || autoPlayEnabled) && isCurrentFileVideo)
  }, [file, autoPlayOnOpen, autoPlayEnabled])

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
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
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <PreviewContent
          file={file}
          rootHandle={rootHandle}
          canRevealInExplorer={canRevealInExplorer}
          canOpenWithSystemPlayer={canOpenWithSystemPlayer}
          previewUrl={fileUrl}
          isLoading={false}
          error={null}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={onPrev}
          onNext={onNext}
          autoPlayVideo={isPlaying}
          isFullscreen
          onVideoEnded={onVideoEnded}
          onVideoPlaybackError={onVideoPlaybackError}
        />
      </div>
    </div>
  )
}
