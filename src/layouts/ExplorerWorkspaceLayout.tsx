import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { ExplorerToolbar } from '@/features/explorer/components/ExplorerToolbar'
import { FileBrowserGrid } from '@/features/explorer/components/FileBrowserGrid'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { ExplorerStatusBar } from '@/features/explorer/components/ExplorerStatusBar'
import { MediaPreviewPanel } from '@/features/preview/components/MediaPreviewPanel'
import { MediaLightboxModal } from '@/features/preview/components/MediaLightboxModal'
import type { FileItem, FilterState } from '@/types'

type TraversalOrder = 'sequential' | 'shuffle'

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
  supportsRevealAction: boolean
  supportsOpenDefaultAction: boolean
  onClosePane: () => void
  onOpenFullscreenFromPane: () => void
  canPrevFromPane: boolean
  canNextFromPane: boolean
  onNavigatePrevFromPane: () => void
  onNavigateNextFromPane: () => void
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  traversalOrder: TraversalOrder
  onToggleTraversalOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoEnded: () => void
  onVideoPlaybackError: () => void
  previewFile: FileItem | null
  previewAutoPlayOnOpen: boolean
  onClosePreview: () => void
  canPrevFromModal: boolean
  canNextFromModal: boolean
  onNavigatePrevFromModal: () => void
  onNavigateNextFromModal: () => void
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
  supportsRevealAction,
  supportsOpenDefaultAction,
  onClosePane,
  onOpenFullscreenFromPane,
  canPrevFromPane,
  canNextFromPane,
  onNavigatePrevFromPane,
  onNavigateNextFromPane,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  traversalOrder,
  onToggleTraversalOrder,
  onAutoPlayIntervalChange,
  onVideoEnded,
  onVideoPlaybackError,
  previewFile,
  previewAutoPlayOnOpen,
  onClosePreview,
  canPrevFromModal,
  canNextFromModal,
  onNavigatePrevFromModal,
  onNavigateNextFromModal,
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
              canRevealInExplorer={supportsRevealAction}
              canOpenWithSystemPlayer={supportsOpenDefaultAction}
              onClose={onClosePane}
              onOpenFullscreen={onOpenFullscreenFromPane}
              canPrev={canPrevFromPane}
              canNext={canNextFromPane}
              onPrev={onNavigatePrevFromPane}
              onNext={onNavigateNextFromPane}
              autoPlayEnabled={autoPlayEnabled}
              autoPlayIntervalSec={autoPlayIntervalSec}
              onToggleAutoPlay={onToggleAutoPlay}
              traversalOrder={traversalOrder}
              onToggleTraversalOrder={onToggleTraversalOrder}
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
          canRevealInExplorer={supportsRevealAction}
          canOpenWithSystemPlayer={supportsOpenDefaultAction}
          onClose={onClosePreview}
          autoPlayOnOpen={previewAutoPlayOnOpen}
          canPrev={canPrevFromModal}
          canNext={canNextFromModal}
          onPrev={onNavigatePrevFromModal}
          onNext={onNavigateNextFromModal}
          autoPlayEnabled={autoPlayEnabled}
          autoPlayIntervalSec={autoPlayIntervalSec}
          onToggleAutoPlay={onToggleAutoPlay}
          traversalOrder={traversalOrder}
          onToggleTraversalOrder={onToggleTraversalOrder}
          onAutoPlayIntervalChange={onAutoPlayIntervalChange}
          onVideoEnded={onVideoEnded}
          onVideoPlaybackError={onVideoPlaybackError}
        />
      )}
    </div>
  )
}
