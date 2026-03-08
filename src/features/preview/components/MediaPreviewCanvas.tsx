import { lazy, Suspense, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { getMediaType } from '@/lib/thumbnail'
import type { FileItem } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import { PreviewFeedbackOverlay } from './PreviewFeedbackOverlay'
import { PreviewMediaViewport } from './PreviewMediaViewport'

interface MediaPreviewCanvasProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  previewActionTools: GatewayToolDescriptor[]
  previewUrl: string | null
  isLoading: boolean
  error: string | null
  onOpenFullscreen?: () => void
  autoPlayVideo?: boolean
  isFullscreen?: boolean
  onVideoEnded?: () => void
  onVideoPlaybackError?: () => void
  toolResultQueueState: PluginResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  toolWorkbenchState: PluginWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
}

type MediaPreviewViewState = 'loading' | 'error' | 'ready' | 'empty'

const PreviewPluginHost = lazy(async () => {
  const mod = await import('./PreviewPluginHost')
  return { default: mod.PreviewPluginHost }
})

export function MediaPreviewCanvas({
  file,
  rootHandle,
  previewActionTools,
  previewUrl,
  isLoading,
  error,
  onOpenFullscreen,
  autoPlayVideo = false,
  isFullscreen = false,
  onVideoEnded,
  onVideoPlaybackError,
  toolResultQueueState,
  setToolResultQueueState,
  toolWorkbenchState,
  setToolWorkbenchState,
  enableContinuousAutoRunOwner,
}: MediaPreviewCanvasProps) {
  const [playbackError, setPlaybackError] = useState(false)

  const isImage = getMediaType(file.name) === 'image'
  const isVideo = getMediaType(file.name) === 'video'
  const emptyTextClass = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const errorTextClass = isFullscreen ? 'text-red-300' : 'text-destructive'
  const surfaceVariant = isFullscreen ? 'preview-lightbox' : 'preview-panel'
  const showPreviewPluginHost = previewActionTools.length > 0
  const previewViewState: MediaPreviewViewState = isLoading
    ? 'loading'
    : error
      ? 'error'
      : previewUrl && (isImage || isVideo)
        ? 'ready'
        : 'empty'

  useEffect(() => {
    setPlaybackError(false)
  }, [file.path])

  return (
    <div className="flex-1 min-h-0 flex" data-preview-state={previewViewState}>
      {showPreviewPluginHost && (
        <Suspense fallback={null}>
          <PreviewPluginHost
            file={file}
            rootHandle={rootHandle}
            previewActionTools={previewActionTools}
            previewViewState={previewViewState}
            surfaceVariant={surfaceVariant}
            toolResultQueueState={toolResultQueueState}
            setToolResultQueueState={setToolResultQueueState}
            toolWorkbenchState={toolWorkbenchState}
            setToolWorkbenchState={setToolWorkbenchState}
            enableContinuousAutoRunOwner={enableContinuousAutoRunOwner}
          />
        </Suspense>
      )}

      <PreviewMediaViewport
        file={file}
        previewUrl={previewUrl}
        isLoading={isLoading}
        error={error}
        isImage={isImage}
        isVideo={isVideo}
        emptyTextClass={emptyTextClass}
        errorTextClass={errorTextClass}
        onOpenFullscreen={isFullscreen ? undefined : onOpenFullscreen}
        autoPlayVideo={autoPlayVideo}
        onVideoEnded={onVideoEnded}
        onVideoRenderError={() => {
          setPlaybackError(true)
          onVideoPlaybackError?.()
        }}
      >
        <PreviewFeedbackOverlay showPlaybackError={playbackError && isVideo} />
      </PreviewMediaViewport>
    </div>
  )
}
