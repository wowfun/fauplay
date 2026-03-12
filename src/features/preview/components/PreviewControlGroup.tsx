import { X } from 'lucide-react'
import { MediaPlaybackControls } from './MediaPlaybackControls'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import { Button } from '@/ui/Button'

interface PreviewControlGroupProps {
  isFullscreen: boolean
  showPlaybackControls: boolean
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onClose: () => void
}

export function PreviewControlGroup({
  isFullscreen,
  showPlaybackControls,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onAutoPlayIntervalChange,
  onClose,
}: PreviewControlGroupProps) {
  return (
    <div
      className="mt-2 flex flex-nowrap items-center gap-2 overflow-x-auto [&>*]:shrink-0"
      data-preview-subzone="PreviewControlGroup"
    >
      {showPlaybackControls && (
        <MediaPlaybackControls
          autoPlayEnabled={autoPlayEnabled}
          autoPlayIntervalSec={autoPlayIntervalSec}
          onToggleAutoPlay={onToggleAutoPlay}
          playbackOrder={playbackOrder}
          onTogglePlaybackOrder={onTogglePlaybackOrder}
          onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        />
      )}
      <Button
        onClick={onClose}
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={isFullscreen ? '关闭全屏预览' : '关闭预览'}
        title={isFullscreen ? '关闭全屏预览' : '关闭预览'}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  )
}
