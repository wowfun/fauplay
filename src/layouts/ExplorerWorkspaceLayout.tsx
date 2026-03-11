import { lazy, Suspense, useEffect, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { ExplorerToolbar } from '@/features/explorer/components/ExplorerToolbar'
import { FileBrowserGrid } from '@/features/explorer/components/FileBrowserGrid'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { ExplorerStatusBar } from '@/features/explorer/components/ExplorerStatusBar'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import type { AddressPathHistoryEntry, FavoriteFolderEntry, FileItem, FilterState, ThumbnailSizePreset } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'

const WorkspacePluginHost = lazy(async () => {
  const mod = await import('@/features/explorer/components/WorkspacePluginHost')
  return { default: mod.WorkspacePluginHost }
})

const MediaPreviewPanel = lazy(async () => {
  const mod = await import('@/features/preview/components/MediaPreviewPanel')
  return { default: mod.MediaPreviewPanel }
})

const MediaLightboxModal = lazy(async () => {
  const mod = await import('@/features/preview/components/MediaLightboxModal')
  return { default: mod.MediaLightboxModal }
})

const WORKSPACE_TOOL_PANEL_COLLAPSED_STORAGE_KEY = 'fauplay:workspace-tool-panel-collapsed'
const PREVIEW_TOOL_PANEL_COLLAPSED_STORAGE_KEY = 'fauplay:preview-tool-panel-collapsed'

function readPersistedBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue

  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return defaultValue
    if (raw === 'true') return true
    if (raw === 'false') return false

    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'boolean' ? parsed : defaultValue
  } catch {
    return defaultValue
  }
}

function writePersistedBoolean(key: string, value: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

interface ExplorerWorkspaceLayoutProps {
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  rootName: string
  currentPath: string
  rootId?: string | null
  onNavigateToPath: (path: string) => Promise<boolean>
  onNavigateHistoryEntry: (entry: AddressPathHistoryEntry) => Promise<boolean>
  onListChildDirectories: (path: string) => Promise<string[]>
  recentPathHistory: AddressPathHistoryEntry[]
  favoriteFolders: FavoriteFolderEntry[]
  isCurrentPathFavorited: boolean
  onOpenFavoriteFolder: (entry: FavoriteFolderEntry) => Promise<boolean>
  onRemoveFavoriteFolder: (entry: FavoriteFolderEntry) => void
  onToggleCurrentPathFavorite: () => void
  onNavigateUp: () => void
  isFlattenView: boolean
  onToggleFlattenView: () => void
  totalCount: number
  imageCount: number
  videoCount: number
  thumbnailSizePreset: ThumbnailSizePreset
  onThumbnailSizePresetChange: (preset: ThumbnailSizePreset) => void
  canOpenTrash: boolean
  onOpenTrash: () => void
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
  onPreviewMutationCommitted: () => void | Promise<void>
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
  rootId,
  onNavigateToPath,
  onNavigateHistoryEntry,
  onListChildDirectories,
  recentPathHistory,
  favoriteFolders,
  isCurrentPathFavorited,
  onOpenFavoriteFolder,
  onRemoveFavoriteFolder,
  onToggleCurrentPathFavorite,
  onNavigateUp,
  isFlattenView,
  onToggleFlattenView,
  totalCount,
  imageCount,
  videoCount,
  thumbnailSizePreset,
  onThumbnailSizePresetChange,
  canOpenTrash,
  onOpenTrash,
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
  onPreviewMutationCommitted,
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
  const [workspaceToolPanelCollapsed, setWorkspaceToolPanelCollapsed] = useState<boolean>(() => (
    readPersistedBoolean(WORKSPACE_TOOL_PANEL_COLLAPSED_STORAGE_KEY, false)
  ))
  const [previewToolPanelCollapsed, setPreviewToolPanelCollapsed] = useState<boolean>(() => (
    readPersistedBoolean(PREVIEW_TOOL_PANEL_COLLAPSED_STORAGE_KEY, false)
  ))

  useEffect(() => {
    writePersistedBoolean(WORKSPACE_TOOL_PANEL_COLLAPSED_STORAGE_KEY, workspaceToolPanelCollapsed)
  }, [workspaceToolPanelCollapsed])

  useEffect(() => {
    writePersistedBoolean(PREVIEW_TOOL_PANEL_COLLAPSED_STORAGE_KEY, previewToolPanelCollapsed)
  }, [previewToolPanelCollapsed])

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <ExplorerToolbar
        filter={filter}
        onFilterChange={onFilterChange}
        rootName={rootName}
        currentPath={currentPath}
        onNavigateToPath={onNavigateToPath}
        onNavigateHistoryEntry={onNavigateHistoryEntry}
        onListChildDirectories={onListChildDirectories}
        recentPathHistory={recentPathHistory}
        favoriteFolders={favoriteFolders}
        isCurrentPathFavorited={isCurrentPathFavorited}
        onOpenFavoriteFolder={onOpenFavoriteFolder}
        onRemoveFavoriteFolder={onRemoveFavoriteFolder}
        onToggleCurrentPathFavorite={onToggleCurrentPathFavorite}
        onNavigateUp={onNavigateUp}
        isFlattenView={isFlattenView}
        onToggleFlattenView={onToggleFlattenView}
        totalCount={totalCount}
        imageCount={imageCount}
        videoCount={videoCount}
        thumbnailSizePreset={thumbnailSizePreset}
        onThumbnailSizePresetChange={onThumbnailSizePresetChange}
        canOpenTrash={canOpenTrash}
        onOpenTrash={onOpenTrash}
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
              {pluginTools.length > 0 && (
                <Suspense fallback={null}>
                <WorkspacePluginHost
                  tools={pluginTools}
                  rootHandle={rootHandle}
                  rootId={rootId}
                  currentPath={currentPath}
                    visibleFiles={files}
                    selectedPaths={gridSelectedPaths}
                    resultQueueState={workspacePluginResultQueueState}
                    setResultQueueState={setWorkspacePluginResultQueueState}
                    workbenchState={workspacePluginWorkbenchState}
                    setWorkbenchState={setWorkspacePluginWorkbenchState}
                    onMutationCommitted={onWorkspaceMutationCommitted}
                    toolPanelCollapsed={workspaceToolPanelCollapsed}
                    onToggleToolPanelCollapsed={() => {
                      setWorkspaceToolPanelCollapsed((prev) => !prev)
                    }}
                  />
                </Suspense>
              )}
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
            <Suspense
              fallback={(
                <div className="h-full w-full flex items-center justify-center">
                  <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
                </div>
              )}
            >
              <MediaPreviewPanel
                file={selectedFile}
                rootHandle={rootHandle}
                rootId={rootId}
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
                toolPanelCollapsed={previewToolPanelCollapsed}
                onToggleToolPanelCollapsed={() => {
                  setPreviewToolPanelCollapsed((prev) => !prev)
                }}
                onMutationCommitted={onPreviewMutationCommitted}
              />
            </Suspense>
          </div>
        )}
      </div>

      <ExplorerStatusBar
        visibleFiles={files}
        selectedCount={gridSelectedCount}
        selectedMetaFile={selectedGridMetaFile}
      />

      {previewFile && (
        <Suspense
          fallback={(
            <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}
        >
          <MediaLightboxModal
            file={previewFile}
            rootHandle={rootHandle}
            rootId={rootId}
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
            toolPanelCollapsed={previewToolPanelCollapsed}
            onToggleToolPanelCollapsed={() => {
              setPreviewToolPanelCollapsed((prev) => !prev)
            }}
            onMutationCommitted={onPreviewMutationCommitted}
          />
        </Suspense>
      )}
    </div>
  )
}
