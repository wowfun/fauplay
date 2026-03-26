import { lazy, Suspense, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { getFilePreviewKind } from '@/lib/filePreview'
import type { FileItem, ResultProjection, TextPreviewPayload } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import type { PreviewFaceOverlayItem } from '@/features/faces/types'
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
  videoPlaybackRate: number
  isFullscreen?: boolean
  onVideoEnded?: () => void
  onVideoPlaybackError?: () => void
  toolResultQueueState: PluginResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  toolWorkbenchState: PluginWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
  enableAnnotationTagShortcutOwner?: boolean
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  toolPanelWidthPx: number
  onToolPanelWidthChange: (nextWidthPx: number) => void
  onMutationCommitted?: (params?: PreviewMutationCommitParams) => void | Promise<void>
  showFaceOverlays: boolean
  faceOverlays: PreviewFaceOverlayItem[]
  faceOverlayLoading: boolean
  faceOverlayError: string | null
  onFaceOverlayClick?: (item: PreviewFaceOverlayItem) => void
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
  onDismissProjectionTool: (toolName: string) => void
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
  videoPlaybackRate,
  isFullscreen = false,
  onVideoEnded,
  onVideoPlaybackError,
  toolResultQueueState,
  setToolResultQueueState,
  toolWorkbenchState,
  setToolWorkbenchState,
  enableContinuousAutoRunOwner,
  enableAnnotationTagShortcutOwner = false,
  toolPanelCollapsed,
  onToggleToolPanelCollapsed,
  toolPanelWidthPx,
  onToolPanelWidthChange,
  onMutationCommitted,
  showFaceOverlays,
  faceOverlays,
  faceOverlayLoading,
  faceOverlayError,
  onFaceOverlayClick,
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
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
            enableAnnotationTagShortcutOwner={enableAnnotationTagShortcutOwner}
            toolPanelCollapsed={toolPanelCollapsed}
            onToggleToolPanelCollapsed={onToggleToolPanelCollapsed}
            toolPanelWidthPx={toolPanelWidthPx}
            onToolPanelWidthChange={onToolPanelWidthChange}
            onMutationCommitted={onMutationCommitted}
            activeProjection={activeProjection}
            onActivateProjection={onActivateProjection}
            onDismissProjectionTool={onDismissProjectionTool}
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
        videoPlaybackRate={videoPlaybackRate}
        onVideoEnded={onVideoEnded}
        onVideoRenderError={() => {
          setPlaybackError(true)
          onVideoPlaybackError?.()
        }}
        showFaceOverlays={showFaceOverlays}
        faceOverlays={faceOverlays}
        faceOverlayLoading={faceOverlayLoading}
        faceOverlayError={faceOverlayError}
        onFaceOverlayClick={onFaceOverlayClick}
      >
        <PreviewFeedbackOverlay showPlaybackError={playbackError && isVideo} />
      </FilePreviewViewport>
    </div>
  )
}
