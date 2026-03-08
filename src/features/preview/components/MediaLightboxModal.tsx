import type { Dispatch, SetStateAction } from 'react'
import type { FileItem } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { PreviewToolResultQueueState } from '@/features/preview/types/toolResult'
import type { PreviewToolWorkbenchState } from '@/features/preview/types/toolWorkbench'
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
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoEnded: () => void
  onVideoPlaybackError: () => void
  toolResultQueueState: PreviewToolResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PreviewToolResultQueueState>>
  toolWorkbenchState: PreviewToolWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PreviewToolWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
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
  playbackOrder,
  onTogglePlaybackOrder,
  onAutoPlayIntervalChange,
  onVideoEnded,
  onVideoPlaybackError,
  toolResultQueueState,
  setToolResultQueueState,
  toolWorkbenchState,
  setToolWorkbenchState,
  enableContinuousAutoRunOwner,
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
        playbackOrder={playbackOrder}
        onTogglePlaybackOrder={onTogglePlaybackOrder}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onVideoEnded={onVideoEnded}
        onVideoPlaybackError={onVideoPlaybackError}
        presentation="lightbox"
        forceAutoPlayOnOpen={autoPlayOnOpen}
        toolResultQueueState={toolResultQueueState}
        setToolResultQueueState={setToolResultQueueState}
        toolWorkbenchState={toolWorkbenchState}
        setToolWorkbenchState={setToolWorkbenchState}
        enableContinuousAutoRunOwner={enableContinuousAutoRunOwner}
      />
    </div>
  )
}
