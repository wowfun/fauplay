import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { ExplorerToolbar } from '@/features/explorer/components/ExplorerToolbar'
import { FileBrowserGrid } from '@/features/explorer/components/FileBrowserGrid'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { ExplorerStatusBar } from '@/features/explorer/components/ExplorerStatusBar'
import { MediaPreviewPanel } from '@/features/preview/components/MediaPreviewPanel'
import { MediaLightboxModal } from '@/features/preview/components/MediaLightboxModal'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { FileItem, FilterState, ThumbnailSizePreset } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'

interface ExplorerWorkspaceLayoutProps {
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  currentPath: string
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
  showPreviewPane: boolean
  contentRef: MutableRefObject<HTMLDivElement | null>
  paneWidthRatio: number
  onPreviewPaneResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
  selectedFile: FileItem | null
  previewActionTools: GatewayToolDescriptor[]
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
  currentPath,
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
  showPreviewPane,
  contentRef,
  paneWidthRatio,
  onPreviewPaneResizeStart,
  selectedFile,
  previewActionTools,
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
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <ExplorerToolbar
        filter={filter}
        onFilterChange={onFilterChange}
        currentPath={currentPath}
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
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <FileBrowserGrid
            ref={fileGridRef}
            files={files}
            rootHandle={rootHandle}
            thumbnailSizePreset={thumbnailSizePreset}
            onFileClick={onFileClick}
            onFileDoubleClick={onFileDoubleClick}
            onDirectoryClick={onDirectoryClick}
          />
        )}

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
              previewActionTools={previewActionTools}
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
            />
          </div>
        )}
      </div>

      <ExplorerStatusBar
        visibleFiles={files}
        selectedFile={selectedFile}
      />

      {previewFile && (
        <MediaLightboxModal
          file={previewFile}
          rootHandle={rootHandle}
          previewActionTools={previewActionTools}
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
        />
      )}
    </div>
  )
}
