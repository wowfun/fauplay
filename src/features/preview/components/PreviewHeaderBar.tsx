import { PreviewControlGroup } from './PreviewControlGroup'
import { PreviewTitleRow } from './PreviewTitleRow'

interface PreviewHeaderBarProps {
  fileName: string
  isFullscreen: boolean
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  traversalOrder: 'sequential' | 'shuffle'
  onToggleTraversalOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onClose: () => void
}

export function PreviewHeaderBar({
  fileName,
  isFullscreen,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  traversalOrder,
  onToggleTraversalOrder,
  onAutoPlayIntervalChange,
  onClose,
}: PreviewHeaderBarProps) {
  return (
    <div
      className={`p-3 border-b flex-shrink-0 ${isFullscreen ? 'border-white/10' : 'border-border'}`}
      data-preview-subzone="PreviewHeaderBar"
    >
      <PreviewTitleRow fileName={fileName} />
      <PreviewControlGroup
        isFullscreen={isFullscreen}
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        onToggleAutoPlay={onToggleAutoPlay}
        traversalOrder={traversalOrder}
        onToggleTraversalOrder={onToggleTraversalOrder}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onClose={onClose}
      />
    </div>
  )
}
