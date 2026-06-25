import { lazy, Suspense, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { EXPLORER_STATUS_BAR_HEIGHT_PX } from '@/features/explorer/constants/statusBar'
import type { WorkspacePluginPanelState } from '@/features/workspace/hooks/useWorkspacePluginPanelState'
import type { WorkspacePresentationProfile } from '@/features/workspace/types/presentation'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { RuntimeToolDescriptor } from '@/lib/runtimeApi'
import type { FileItem, ResultProjection } from '@/types'

const FilePreviewPanel = lazy(async () => {
  const mod = await import('@/features/preview/components/FilePreviewPanel')
  return { default: mod.FilePreviewPanel }
})

const FileLightboxModal = lazy(async () => {
  const mod = await import('@/features/preview/components/FileLightboxModal')
  return { default: mod.FileLightboxModal }
})

interface ExplorerWorkspacePreviewControls {
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  videoSeekStepSec: number
  videoPlaybackRate: number
  faceBboxVisible: boolean
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onToggleFaceBboxVisible: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoSeekStepChange: (sec: number) => void
  onVideoPlaybackRateChange: (rate: number) => void
  onVideoEnded: () => void
  onVideoPlaybackError: () => void
}

interface ExplorerWorkspacePreviewPluginProps {
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  pluginTools: RuntimeToolDescriptor[]
  pluginPanelState: WorkspacePluginPanelState
  previewHeaderTitleMode?: WorkspacePresentationProfile['previewHeaderTitleMode']
  showPreviewUnavailableReasons?: WorkspacePresentationProfile['showPreviewUnavailableReasons']
  onPreviewMutationCommitted: (params?: PreviewMutationCommitParams) => void | Promise<void>
  onOpenPeopleForPerson: (personId: string | null) => void
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
  onDismissProjectionTool: (toolName: string) => void
}

interface ExplorerWorkspacePreviewPaneProps
  extends ExplorerWorkspacePreviewControls,
    ExplorerWorkspacePreviewPluginProps {
  showPreviewPane: boolean
  contentRef: MutableRefObject<HTMLDivElement | null>
  paneWidthRatio: number
  onPreviewPaneResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
  selectedFile: FileItem | null
  previewFile: FileItem | null
  onClosePane: () => void
  onOpenFullscreenFromPane: () => void
}

interface ExplorerWorkspacePreviewModalProps
  extends ExplorerWorkspacePreviewControls,
    ExplorerWorkspacePreviewPluginProps {
  showPreviewPane: boolean
  previewFile: FileItem | null
  previewAutoPlayOnOpen: boolean
  onClosePreview: () => void
}

export function ExplorerWorkspacePreviewPane({
  showPreviewPane,
  contentRef,
  paneWidthRatio,
  onPreviewPaneResizeStart,
  selectedFile,
  previewFile,
  rootHandle,
  rootId,
  pluginTools,
  pluginPanelState,
  previewHeaderTitleMode,
  showPreviewUnavailableReasons,
  onClosePane,
  onOpenFullscreenFromPane,
  autoPlayEnabled,
  autoPlayIntervalSec,
  videoSeekStepSec,
  videoPlaybackRate,
  faceBboxVisible,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onToggleFaceBboxVisible,
  onAutoPlayIntervalChange,
  onVideoSeekStepChange,
  onVideoPlaybackRateChange,
  onVideoEnded,
  onVideoPlaybackError,
  onPreviewMutationCommitted,
  onOpenPeopleForPerson,
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
}: ExplorerWorkspacePreviewPaneProps) {
  if (!showPreviewPane) return null

  return (
    <div
      ref={contentRef}
      className="flex-shrink-0 h-full relative overflow-hidden"
      style={{ width: `${paneWidthRatio * 100}%` }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 bg-transparent transition-colors z-10"
        onMouseDown={onPreviewPaneResizeStart}
      />
      <Suspense
        fallback={(
          <div className="h-full w-full flex items-center justify-center">
            <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
          </div>
        )}
      >
        <FilePreviewPanel
          file={selectedFile}
          rootHandle={rootHandle}
          rootId={rootId}
          previewActionTools={pluginTools}
          onClose={onClosePane}
          onOpenFullscreen={onOpenFullscreenFromPane}
          titleMode={previewHeaderTitleMode}
          showUnavailableReasons={showPreviewUnavailableReasons}
          autoPlayEnabled={autoPlayEnabled}
          autoPlayIntervalSec={autoPlayIntervalSec}
          videoSeekStepSec={videoSeekStepSec}
          videoPlaybackRate={videoPlaybackRate}
          faceBboxVisible={faceBboxVisible}
          onToggleAutoPlay={onToggleAutoPlay}
          playbackOrder={playbackOrder}
          onTogglePlaybackOrder={onTogglePlaybackOrder}
          onToggleFaceBboxVisible={onToggleFaceBboxVisible}
          onAutoPlayIntervalChange={onAutoPlayIntervalChange}
          onVideoSeekStepChange={onVideoSeekStepChange}
          onVideoPlaybackRateChange={onVideoPlaybackRateChange}
          onVideoEnded={onVideoEnded}
          onVideoPlaybackError={onVideoPlaybackError}
          toolResultQueueState={pluginPanelState.previewPluginResultQueueState}
          setToolResultQueueState={pluginPanelState.setPreviewPluginResultQueueState}
          toolWorkbenchState={pluginPanelState.previewPluginWorkbenchState}
          setToolWorkbenchState={pluginPanelState.setPreviewPluginWorkbenchState}
          enableContinuousAutoRunOwner={showPreviewPane}
          toolPanelCollapsed={pluginPanelState.previewToolPanelCollapsed}
          onToggleToolPanelCollapsed={pluginPanelState.togglePreviewToolPanelCollapsed}
          toolPanelWidthPx={pluginPanelState.previewToolPanelWidthPx}
          onToolPanelWidthChange={pluginPanelState.updatePreviewToolPanelWidth}
          onMutationCommitted={onPreviewMutationCommitted}
          onOpenPersonDetail={onOpenPeopleForPerson}
          enableAnnotationTagShortcutOwner={!previewFile}
          activeProjection={activeProjection}
          onActivateProjection={onActivateProjection}
          onDismissProjectionTool={onDismissProjectionTool}
        />
      </Suspense>
    </div>
  )
}

export function ExplorerWorkspacePreviewModal({
  showPreviewPane,
  previewFile,
  previewAutoPlayOnOpen,
  rootHandle,
  rootId,
  pluginTools,
  pluginPanelState,
  previewHeaderTitleMode,
  showPreviewUnavailableReasons,
  onClosePreview,
  autoPlayEnabled,
  autoPlayIntervalSec,
  videoSeekStepSec,
  videoPlaybackRate,
  faceBboxVisible,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onToggleFaceBboxVisible,
  onAutoPlayIntervalChange,
  onVideoSeekStepChange,
  onVideoPlaybackRateChange,
  onVideoEnded,
  onVideoPlaybackError,
  onPreviewMutationCommitted,
  onOpenPeopleForPerson,
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
}: ExplorerWorkspacePreviewModalProps) {
  if (!previewFile) return null

  return (
    <Suspense
      fallback={(
        <div
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center bg-background"
          style={{ bottom: EXPLORER_STATUS_BAR_HEIGHT_PX }}
        >
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      )}
    >
      <FileLightboxModal
        file={previewFile}
        rootHandle={rootHandle}
        rootId={rootId}
        previewActionTools={pluginTools}
        onClose={onClosePreview}
        titleMode={previewHeaderTitleMode}
        showUnavailableReasons={showPreviewUnavailableReasons}
        autoPlayOnOpen={previewAutoPlayOnOpen}
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        videoSeekStepSec={videoSeekStepSec}
        videoPlaybackRate={videoPlaybackRate}
        faceBboxVisible={faceBboxVisible}
        onToggleAutoPlay={onToggleAutoPlay}
        playbackOrder={playbackOrder}
        onTogglePlaybackOrder={onTogglePlaybackOrder}
        onToggleFaceBboxVisible={onToggleFaceBboxVisible}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onVideoSeekStepChange={onVideoSeekStepChange}
        onVideoPlaybackRateChange={onVideoPlaybackRateChange}
        onVideoEnded={onVideoEnded}
        onVideoPlaybackError={onVideoPlaybackError}
        toolResultQueueState={pluginPanelState.previewPluginResultQueueState}
        setToolResultQueueState={pluginPanelState.setPreviewPluginResultQueueState}
        toolWorkbenchState={pluginPanelState.previewPluginWorkbenchState}
        setToolWorkbenchState={pluginPanelState.setPreviewPluginWorkbenchState}
        enableContinuousAutoRunOwner={!showPreviewPane}
        toolPanelCollapsed={pluginPanelState.previewToolPanelCollapsed}
        onToggleToolPanelCollapsed={pluginPanelState.togglePreviewToolPanelCollapsed}
        toolPanelWidthPx={pluginPanelState.previewToolPanelWidthPx}
        onToolPanelWidthChange={pluginPanelState.updatePreviewToolPanelWidth}
        onMutationCommitted={onPreviewMutationCommitted}
        onOpenPersonDetail={onOpenPeopleForPerson}
        enableAnnotationTagShortcutOwner
        activeProjection={activeProjection}
        onActivateProjection={onActivateProjection}
        onDismissProjectionTool={onDismissProjectionTool}
      />
    </Suspense>
  )
}
