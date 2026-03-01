import { X } from 'lucide-react'
import { MediaPlaybackControls } from './MediaPlaybackControls'
import { Button } from '@/ui/Button'

interface PreviewControlGroupProps {
  isFullscreen: boolean
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  traversalOrder: 'sequential' | 'shuffle'
  onToggleTraversalOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onClose: () => void
}

export function PreviewControlGroup({
  isFullscreen,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  traversalOrder,
  onToggleTraversalOrder,
  onAutoPlayIntervalChange,
  onClose,
}: PreviewControlGroupProps) {
  return (
    <div
      className="mt-2 flex flex-nowrap items-center gap-2 overflow-x-auto [&>*]:shrink-0"
      data-preview-subzone="PreviewControlGroup"
    >
      <MediaPlaybackControls
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        onToggleAutoPlay={onToggleAutoPlay}
        traversalOrder={traversalOrder}
        onToggleTraversalOrder={onToggleTraversalOrder}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
      />
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
