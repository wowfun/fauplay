import { PreviewControlGroup } from './PreviewControlGroup'
import { PreviewTitleRow, type PreviewRenameResult } from './PreviewTitleRow'
import type { PlaybackOrder } from '@/features/preview/types/playback'

interface PreviewHeaderBarProps {
  fileName: string
  isFullscreen: boolean
  showPlaybackControls: boolean
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onClose: () => void
  canRenameFileName: boolean
  renameInFlight: boolean
  renameUnavailableReason?: string | null
  onSubmitFileNameRename: (nextBaseName: string) => Promise<PreviewRenameResult>
}

export function PreviewHeaderBar({
  fileName,
  isFullscreen,
  showPlaybackControls,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onAutoPlayIntervalChange,
  onClose,
  canRenameFileName,
  renameInFlight,
  renameUnavailableReason,
  onSubmitFileNameRename,
}: PreviewHeaderBarProps) {
  return (
    <div
      className={`p-3 border-b flex-shrink-0 ${isFullscreen ? 'border-white/10' : 'border-border'}`}
      data-preview-subzone="PreviewHeaderBar"
    >
      <PreviewTitleRow
        fileName={fileName}
        canRename={canRenameFileName}
        renameInFlight={renameInFlight}
        renameUnavailableReason={renameUnavailableReason}
        onSubmitRename={onSubmitFileNameRename}
      />
      <PreviewControlGroup
        isFullscreen={isFullscreen}
        showPlaybackControls={showPlaybackControls}
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        onToggleAutoPlay={onToggleAutoPlay}
        playbackOrder={playbackOrder}
        onTogglePlaybackOrder={onTogglePlaybackOrder}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onClose={onClose}
      />
    </div>
  )
}
