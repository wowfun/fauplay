import type { FileItem } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import { MediaPreviewPanel } from './MediaPreviewPanel'

interface MediaLightboxModalProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  previewActionTools: GatewayToolDescriptor[]
  onClose: () => void
  autoPlayOnOpen?: boolean
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
  previewActionTools,
  onClose,
  autoPlayOnOpen = false,
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
        previewActionTools={previewActionTools}
        onClose={onClose}
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
