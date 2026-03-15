import { lazy, Suspense, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { getFilePreviewKind } from '@/lib/filePreview'
import type { FileItem, TextPreviewPayload } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import { PreviewFeedbackOverlay } from './PreviewFeedbackOverlay'
import { FilePreviewViewport } from './FilePreviewViewport'

interface FilePreviewCanvasProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  previewActionTools: GatewayToolDescriptor[]
  previewUrl: string | null
  textPreview: TextPreviewPayload
  fileMimeType: string | null
  fileSizeBytes: number | null
  fileLastModifiedMs: number | null
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
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  toolPanelWidthPx: number
  onToolPanelWidthChange: (nextWidthPx: number) => void
  onMutationCommitted?: (params?: PreviewMutationCommitParams) => void | Promise<void>
}

type FilePreviewViewState = 'loading' | 'error' | 'ready' | 'empty'

const PreviewPluginHost = lazy(async () => {
  const mod = await import('./PreviewPluginHost')
  return { default: mod.PreviewPluginHost }
})

export function FilePreviewCanvas({
  file,
  rootHandle,
  rootId,
  previewActionTools,
  previewUrl,
  textPreview,
  fileMimeType,
  fileSizeBytes,
  fileLastModifiedMs,
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
  toolPanelCollapsed,
  onToggleToolPanelCollapsed,
  toolPanelWidthPx,
  onToolPanelWidthChange,
  onMutationCommitted,
}: FilePreviewCanvasProps) {
  const [playbackError, setPlaybackError] = useState(false)

  const previewKind = getFilePreviewKind(file.name)
  const isImage = previewKind === 'image'
  const isVideo = previewKind === 'video'
  const emptyTextClass = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const errorTextClass = isFullscreen ? 'text-red-300' : 'text-destructive'
  const surfaceVariant = isFullscreen ? 'preview-lightbox' : 'preview-panel'
  const showPreviewPluginHost = previewActionTools.length > 0
  const previewViewState: FilePreviewViewState = isLoading
    ? 'loading'
    : error
      ? 'error'
      : isImage || isVideo
        ? (previewUrl ? 'ready' : 'empty')
        : previewKind === 'text'
          ? (textPreview.status === 'idle' || textPreview.status === 'loading' ? 'loading' : 'ready')
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
            rootId={rootId}
            previewActionTools={previewActionTools}
            previewViewState={previewViewState}
            surfaceVariant={surfaceVariant}
            toolResultQueueState={toolResultQueueState}
            setToolResultQueueState={setToolResultQueueState}
            toolWorkbenchState={toolWorkbenchState}
            setToolWorkbenchState={setToolWorkbenchState}
            enableContinuousAutoRunOwner={enableContinuousAutoRunOwner}
            toolPanelCollapsed={toolPanelCollapsed}
            onToggleToolPanelCollapsed={onToggleToolPanelCollapsed}
            toolPanelWidthPx={toolPanelWidthPx}
            onToolPanelWidthChange={onToolPanelWidthChange}
            onMutationCommitted={onMutationCommitted}
          />
        </Suspense>
      )}

      <FilePreviewViewport
        file={file}
        previewKind={previewKind}
        previewUrl={previewUrl}
        videoSurface={isFullscreen ? 'lightbox' : 'panel'}
        textPreview={textPreview}
        fileMimeType={fileMimeType}
        fileSizeBytes={fileSizeBytes}
        fileLastModifiedMs={fileLastModifiedMs}
        isLoading={isLoading}
        error={error}
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
      </FilePreviewViewport>
    </div>
  )
}
