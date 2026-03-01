import type { FileItem } from '@/types'
import { MediaPreviewPanel } from './MediaPreviewPanel'

interface MediaLightboxModalProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
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

export function MediaLightboxModal({
  file,
  rootHandle,
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
}: MediaLightboxModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <MediaPreviewPanel
        file={file}
        rootHandle={rootHandle}
        canRevealInExplorer={canRevealInExplorer}
        canOpenWithSystemPlayer={canOpenWithSystemPlayer}
        onClose={onClose}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={onPrev}
        onNext={onNext}
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        onToggleAutoPlay={onToggleAutoPlay}
        traversalOrder={traversalOrder}
        onToggleTraversalOrder={onToggleTraversalOrder}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onVideoEnded={onVideoEnded}
        onVideoPlaybackError={onVideoPlaybackError}
        presentation="fullscreen"
        forceAutoPlayOnOpen={autoPlayOnOpen}
      />
    </div>
  )
}
