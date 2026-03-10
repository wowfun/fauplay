import type { Dispatch, SetStateAction } from 'react'
import type { FileItem } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import { MediaPreviewPanel } from './MediaPreviewPanel'

interface MediaLightboxModalProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
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
  toolResultQueueState: PluginResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  toolWorkbenchState: PluginWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  onMutationCommitted?: () => void | Promise<void>
}

export function MediaLightboxModal({
  file,
  rootHandle,
  rootId,
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
  toolPanelCollapsed,
  onToggleToolPanelCollapsed,
  onMutationCommitted,
}: MediaLightboxModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <MediaPreviewPanel
        file={file}
        rootHandle={rootHandle}
        rootId={rootId}
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
        toolPanelCollapsed={toolPanelCollapsed}
        onToggleToolPanelCollapsed={onToggleToolPanelCollapsed}
        onMutationCommitted={onMutationCommitted}
      />
    </div>
  )
}
