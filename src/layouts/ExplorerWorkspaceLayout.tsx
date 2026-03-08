import { useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { ExplorerToolbar } from '@/features/explorer/components/ExplorerToolbar'
import { FileBrowserGrid } from '@/features/explorer/components/FileBrowserGrid'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { ExplorerStatusBar } from '@/features/explorer/components/ExplorerStatusBar'
import { WorkspacePluginHost } from '@/features/explorer/components/WorkspacePluginHost'
import { MediaPreviewPanel } from '@/features/preview/components/MediaPreviewPanel'
import { MediaLightboxModal } from '@/features/preview/components/MediaLightboxModal'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import type { FileItem, FilterState, ThumbnailSizePreset } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'

interface ExplorerWorkspaceLayoutProps {
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  rootName: string
  currentPath: string
  onNavigateToPath: (path: string) => void
  onNavigateUp: () => void
  isFlattenView: boolean
  onToggleFlattenView: () => void
  totalCount: number
  imageCount: number
  videoCount: number
  thumbnailSizePreset: ThumbnailSizePreset
  onThumbnailSizePresetChange: (preset: ThumbnailSizePreset) => void
  error: string | null
  isLoading: boolean
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle
  fileGridRef: MutableRefObject<FileBrowserGridHandle | null>
  onFileClick: (file: FileItem) => void
  onFileDoubleClick: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
  onGridSelectionChange: (selectedPaths: string[]) => void
  gridSelectedPaths: string[]
  onWorkspaceMutationCommitted: () => void | Promise<void>
  showPreviewPane: boolean
  hasOpenPreview: boolean
  contentRef: MutableRefObject<HTMLDivElement | null>
  paneWidthRatio: number
  onPreviewPaneResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
  selectedFile: FileItem | null
  gridSelectedCount: number
  selectedGridMetaFile: FileItem | null
  pluginTools: GatewayToolDescriptor[]
  onClosePane: () => void
  onOpenFullscreenFromPane: () => void
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoEnded: () => void
  onVideoPlaybackError: () => void
  previewFile: FileItem | null
  previewAutoPlayOnOpen: boolean
  onClosePreview: () => void
}

export function ExplorerWorkspaceLayout({
  filter,
  onFilterChange,
  rootName,
  currentPath,
  onNavigateToPath,
  onNavigateUp,
  isFlattenView,
  onToggleFlattenView,
  totalCount,
  imageCount,
  videoCount,
  thumbnailSizePreset,
  onThumbnailSizePresetChange,
  error,
  isLoading,
  files,
  rootHandle,
  fileGridRef,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
  onGridSelectionChange,
  gridSelectedPaths,
  onWorkspaceMutationCommitted,
  showPreviewPane,
  hasOpenPreview,
  contentRef,
  paneWidthRatio,
  onPreviewPaneResizeStart,
  selectedFile,
  gridSelectedCount,
  selectedGridMetaFile,
  pluginTools,
  onClosePane,
  onOpenFullscreenFromPane,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onAutoPlayIntervalChange,
  onVideoEnded,
  onVideoPlaybackError,
  previewFile,
  previewAutoPlayOnOpen,
  onClosePreview,
}: ExplorerWorkspaceLayoutProps) {
  const [previewPluginResultQueueState, setPreviewPluginResultQueueState] = useState<PluginResultQueueState>({
    byContextKey: {},
    contextOrder: [],
  })
  const [previewPluginWorkbenchState, setPreviewPluginWorkbenchState] = useState<PluginWorkbenchState>({
    activeToolName: null,
    optionValuesByTool: {},
  })
  const [workspacePluginResultQueueState, setWorkspacePluginResultQueueState] = useState<PluginResultQueueState>({
    byContextKey: {},
    contextOrder: [],
  })
  const [workspacePluginWorkbenchState, setWorkspacePluginWorkbenchState] = useState<PluginWorkbenchState>({
    activeToolName: null,
    optionValuesByTool: {},
  })

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <ExplorerToolbar
        filter={filter}
        onFilterChange={onFilterChange}
        rootName={rootName}
        currentPath={currentPath}
        onNavigateToPath={onNavigateToPath}
        onNavigateUp={onNavigateUp}
        isFlattenView={isFlattenView}
        onToggleFlattenView={onToggleFlattenView}
        totalCount={totalCount}
        imageCount={imageCount}
        videoCount={videoCount}
        thumbnailSizePreset={thumbnailSizePreset}
        onThumbnailSizePresetChange={onThumbnailSizePresetChange}
      />

      {error && (
        <div className="mx-4 mt-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 flex overflow-hidden">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <FileBrowserGrid
                ref={fileGridRef}
                files={files}
                rootHandle={rootHandle}
                thumbnailSizePreset={thumbnailSizePreset}
                onFileClick={onFileClick}
                onFileDoubleClick={onFileDoubleClick}
                onDirectoryClick={onDirectoryClick}
                selectionScopeKey={currentPath}
                canClearSelectionWithEscape={!hasOpenPreview}
                onSelectionChange={onGridSelectionChange}
              />
              <WorkspacePluginHost
                tools={pluginTools}
                rootHandle={rootHandle}
                currentPath={currentPath}
                visibleFiles={files}
                selectedPaths={gridSelectedPaths}
                resultQueueState={workspacePluginResultQueueState}
                setResultQueueState={setWorkspacePluginResultQueueState}
                workbenchState={workspacePluginWorkbenchState}
                setWorkbenchState={setWorkspacePluginWorkbenchState}
                onMutationCommitted={onWorkspaceMutationCommitted}
              />
            </>
          )}
        </div>

        {showPreviewPane && (
          <div
            ref={contentRef}
            className="flex-shrink-0 h-full relative overflow-hidden"
            style={{ width: `${paneWidthRatio * 100}%` }}
          >
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 bg-transparent transition-colors z-10"
              onMouseDown={onPreviewPaneResizeStart}
            />
            <MediaPreviewPanel
              file={selectedFile}
              rootHandle={rootHandle}
              previewActionTools={pluginTools}
              onClose={onClosePane}
              onOpenFullscreen={onOpenFullscreenFromPane}
              autoPlayEnabled={autoPlayEnabled}
              autoPlayIntervalSec={autoPlayIntervalSec}
              onToggleAutoPlay={onToggleAutoPlay}
              playbackOrder={playbackOrder}
              onTogglePlaybackOrder={onTogglePlaybackOrder}
              onAutoPlayIntervalChange={onAutoPlayIntervalChange}
              onVideoEnded={onVideoEnded}
              onVideoPlaybackError={onVideoPlaybackError}
              toolResultQueueState={previewPluginResultQueueState}
              setToolResultQueueState={setPreviewPluginResultQueueState}
              toolWorkbenchState={previewPluginWorkbenchState}
              setToolWorkbenchState={setPreviewPluginWorkbenchState}
              enableContinuousAutoRunOwner={showPreviewPane}
            />
          </div>
        )}
      </div>

      <ExplorerStatusBar
        visibleFiles={files}
        selectedCount={gridSelectedCount}
        selectedMetaFile={selectedGridMetaFile}
      />

      {previewFile && (
        <MediaLightboxModal
          file={previewFile}
          rootHandle={rootHandle}
          previewActionTools={pluginTools}
          onClose={onClosePreview}
          autoPlayOnOpen={previewAutoPlayOnOpen}
          autoPlayEnabled={autoPlayEnabled}
          autoPlayIntervalSec={autoPlayIntervalSec}
          onToggleAutoPlay={onToggleAutoPlay}
          playbackOrder={playbackOrder}
          onTogglePlaybackOrder={onTogglePlaybackOrder}
          onAutoPlayIntervalChange={onAutoPlayIntervalChange}
          onVideoEnded={onVideoEnded}
          onVideoPlaybackError={onVideoPlaybackError}
          toolResultQueueState={previewPluginResultQueueState}
          setToolResultQueueState={setPreviewPluginResultQueueState}
          toolWorkbenchState={previewPluginWorkbenchState}
          setToolWorkbenchState={setPreviewPluginWorkbenchState}
          enableContinuousAutoRunOwner={!showPreviewPane}
        />
      )}
    </div>
  )
}
