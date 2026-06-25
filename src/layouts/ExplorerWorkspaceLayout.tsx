import { lazy, Suspense, useEffect, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { ExplorerToolbar } from '@/features/explorer/components/ExplorerToolbar'
import { EXPLORER_STATUS_BAR_HEIGHT_PX } from '@/features/explorer/constants/statusBar'
import type { ShortcutHelpEntry } from '@/features/explorer/hooks/useShortcutHelpEntries'
import { FileBrowserGrid } from '@/features/explorer/components/FileBrowserGrid'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { ExplorerStatusBar } from '@/features/explorer/components/ExplorerStatusBar'
import { WorkspaceResultPanel } from '@/features/workspace/components/WorkspaceResultPanel'
import type { DuplicateSelectionRule } from '@/features/workspace/lib/duplicateSelection'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import type { WorkspacePresentationProfile } from '@/features/workspace/types/presentation'
import type { FaceRecord } from '@/features/faces/types'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import { useWorkspacePluginPanelState } from '@/features/workspace/hooks/useWorkspacePluginPanelState'
import type {
  AddressPathHistoryEntry,
  AnnotationFilterTagOption,
  FavoriteFolderEntry,
  FileItem,
  FilterState,
  ListingPageState,
  ResultProjection,
  ResultPanelDisplayMode,
  ThumbnailSizePreset,
} from '@/types'
import type { RuntimeToolDescriptor } from '@/lib/runtimeApi'

const WorkspacePluginHost = lazy(async () => {
  const mod = await import('@/features/explorer/components/WorkspacePluginHost')
  return { default: mod.WorkspacePluginHost }
})

const FilePreviewPanel = lazy(async () => {
  const mod = await import('@/features/preview/components/FilePreviewPanel')
  return { default: mod.FilePreviewPanel }
})

const FileLightboxModal = lazy(async () => {
  const mod = await import('@/features/preview/components/FileLightboxModal')
  return { default: mod.FileLightboxModal }
})

const PeoplePanel = lazy(async () => {
  const mod = await import('@/features/faces/components/PeoplePanel')
  return { default: mod.PeoplePanel }
})

interface ExplorerWorkspaceLayoutProps {
  accessProvider: 'local-browser' | 'remote-readonly'
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  rootName: string
  currentPath: string
  rootId?: string | null
  onSwitchWorkspace?: () => void
  onForgetRemoteDevice?: () => void
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
  showAnnotationFilterControls: boolean
  annotationFilterTagOptions: AnnotationFilterTagOption[]
  onOpenAnnotationFilterPanel: () => void
  thumbnailSizePreset: ThumbnailSizePreset
  onThumbnailSizePresetChange: (preset: ThumbnailSizePreset) => void
  canOpenTrash: boolean
  onOpenTrash: () => void
  canOpenPeople: boolean
  onOpenPeople: () => void
  shortcutHelpEntries: ShortcutHelpEntry[]
  onOpenPeopleForPerson: (personId: string | null) => void
  showPeoplePanel: boolean
  peoplePanelPreferredPersonId: string | null
  onClosePeoplePanel: () => void
  onOpenFaceSource: (face: FaceRecord) => boolean | Promise<boolean>
  onProjectFaceSources: (faces: FaceRecord[]) => boolean | Promise<boolean>
  error: string | null
  isLoading: boolean
  directoryFiles: FileItem[]
  listingPage?: ListingPageState
  onLoadNextListingPage?: () => Promise<void>
  activeSurfaceFiles: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  directoryFileGridRef: MutableRefObject<FileBrowserGridHandle | null>
  projectionFileGridRef: MutableRefObject<FileBrowserGridHandle | null>
  onDirectoryFileClick: (file: FileItem) => void
  onDirectoryFileDoubleClick: (file: FileItem) => void
  onProjectionFileClick: (file: FileItem) => void
  onProjectionFileDoubleClick: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
  onDirectoryGridSelectionChange: (selectedPaths: string[]) => void
  directoryGridSelectedPaths: string[]
  projectionTabs: ResultProjection[]
  activeProjectionTabId: string | null
  onProjectionGridSelectionChange: (selectedPaths: string[]) => void
  projectionGridSelectedPaths: string[]
  activeDuplicateSelectionRule: DuplicateSelectionRule | null
  onApplyDuplicateSelectionRule: (rule: DuplicateSelectionRule) => void
  onClearDuplicateSelection: () => void
  onReapplyDuplicateGroup: (groupId: string) => void
  onClearDuplicateGroup: (groupId: string) => void
  isDirectorySurfaceActive: boolean
  isResultPanelOpen: boolean
  resultPanelDisplayMode: ResultPanelDisplayMode
  resultPanelHeightPx: number
  onOpenResultPanel: () => void
  onCloseResultPanel: () => void
  onToggleResultPanelMaximized: () => void
  onResultPanelResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
  onActivateProjectionTab: (tabId: string) => void
  onCloseProjectionTab: (tabId: string) => void
  onWorkspaceMutationCommitted: (params?: WorkspaceMutationCommitParams) => void | Promise<void>
  onPreviewMutationCommitted: (params?: PreviewMutationCommitParams) => void | Promise<void>
  showPreviewPane: boolean
  hasOpenPreview: boolean
  contentRef: MutableRefObject<HTMLDivElement | null>
  paneWidthRatio: number
  onPreviewPaneResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
  selectedFile: FileItem | null
  gridSelectedCount: number
  selectedGridMetaFile: FileItem | null
  pluginTools: RuntimeToolDescriptor[]
  previewHeaderTitleMode?: WorkspacePresentationProfile['previewHeaderTitleMode']
  showPreviewUnavailableReasons?: WorkspacePresentationProfile['showPreviewUnavailableReasons']
  onClosePane: () => void
  onOpenFullscreenFromPane: () => void
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
  previewFile: FileItem | null
  previewAutoPlayOnOpen: boolean
  onClosePreview: () => void
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
  onDismissProjectionTool: (toolName: string) => void
  deleteUndoNoticeMessage: string | null
  deleteUndoNoticeTone: 'default' | 'error'
  canUndoDelete: boolean
  isUndoingDelete: boolean
  onUndoDelete: () => void
}

export function ExplorerWorkspaceLayout({
  accessProvider,
  filter,
  onFilterChange,
  rootName,
  currentPath,
  rootId,
  onSwitchWorkspace,
  onForgetRemoteDevice,
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
  showAnnotationFilterControls,
  annotationFilterTagOptions,
  onOpenAnnotationFilterPanel,
  thumbnailSizePreset,
  onThumbnailSizePresetChange,
  canOpenTrash,
  onOpenTrash,
  canOpenPeople,
  onOpenPeople,
  shortcutHelpEntries,
  onOpenPeopleForPerson,
  showPeoplePanel,
  peoplePanelPreferredPersonId,
  onClosePeoplePanel,
  onOpenFaceSource,
  onProjectFaceSources,
  error,
  isLoading,
  directoryFiles,
  listingPage,
  onLoadNextListingPage,
  activeSurfaceFiles,
  rootHandle,
  directoryFileGridRef,
  projectionFileGridRef,
  onDirectoryFileClick,
  onDirectoryFileDoubleClick,
  onProjectionFileClick,
  onProjectionFileDoubleClick,
  onDirectoryClick,
  onDirectoryGridSelectionChange,
  directoryGridSelectedPaths,
  projectionTabs,
  activeProjectionTabId,
  onProjectionGridSelectionChange,
  projectionGridSelectedPaths,
  activeDuplicateSelectionRule,
  onApplyDuplicateSelectionRule,
  onClearDuplicateSelection,
  onReapplyDuplicateGroup,
  onClearDuplicateGroup,
  isDirectorySurfaceActive,
  isResultPanelOpen,
  resultPanelDisplayMode,
  resultPanelHeightPx,
  onOpenResultPanel,
  onCloseResultPanel,
  onToggleResultPanelMaximized,
  onResultPanelResizeStart,
  onActivateProjectionTab,
  onCloseProjectionTab,
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
  previewHeaderTitleMode = 'actionable',
  showPreviewUnavailableReasons = true,
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
  previewFile,
  previewAutoPlayOnOpen,
  onClosePreview,
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
  deleteUndoNoticeMessage,
  deleteUndoNoticeTone,
  canUndoDelete,
  isUndoingDelete,
  onUndoDelete,
}: ExplorerWorkspaceLayoutProps) {
  const {
    previewPluginResultQueueState,
    setPreviewPluginResultQueueState,
    previewPluginWorkbenchState,
    setPreviewPluginWorkbenchState,
    workspacePluginResultQueueState,
    setWorkspacePluginResultQueueState,
    workspacePluginWorkbenchState,
    setWorkspacePluginWorkbenchState,
    workspaceToolPanelCollapsed,
    toggleWorkspaceToolPanelCollapsed,
    workspaceToolPanelWidthPx,
    updateWorkspaceToolPanelWidth,
    previewToolPanelCollapsed,
    togglePreviewToolPanelCollapsed,
    previewToolPanelWidthPx,
    updatePreviewToolPanelWidth,
  } = useWorkspacePluginPanelState()
  const [hasOpenedPeoplePanel, setHasOpenedPeoplePanel] = useState(showPeoplePanel)

  useEffect(() => {
    if (showPeoplePanel) {
      setHasOpenedPeoplePanel(true)
    }
  }, [showPeoplePanel])

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <ExplorerToolbar
        accessProvider={accessProvider}
        filter={filter}
        onFilterChange={onFilterChange}
        rootId={rootId}
        rootName={rootName}
        currentPath={currentPath}
        onSwitchWorkspace={onSwitchWorkspace}
        onForgetRemoteDevice={onForgetRemoteDevice}
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
        showAnnotationFilterControls={showAnnotationFilterControls}
        annotationFilterTagOptions={annotationFilterTagOptions}
        onOpenAnnotationFilterPanel={onOpenAnnotationFilterPanel}
        thumbnailSizePreset={thumbnailSizePreset}
        onThumbnailSizePresetChange={onThumbnailSizePresetChange}
        canOpenTrash={canOpenTrash}
        onOpenTrash={onOpenTrash}
        canOpenPeople={canOpenPeople}
        onOpenPeople={onOpenPeople}
        shortcutHelpEntries={shortcutHelpEntries}
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
              <div className="flex-1 min-w-0 flex flex-col">
                {!(isResultPanelOpen && resultPanelDisplayMode === 'maximized') && (
                  <div className="flex-1 min-h-0">
                    <FileBrowserGrid
                      ref={directoryFileGridRef}
                      files={directoryFiles}
                      rootHandle={rootHandle}
                      thumbnailSizePreset={thumbnailSizePreset}
                      onFileClick={onDirectoryFileClick}
                      onFileDoubleClick={onDirectoryFileDoubleClick}
                      onDirectoryClick={onDirectoryClick}
                      selectionScopeKey={currentPath}
                      canClearSelectionWithEscape={!hasOpenPreview}
                      keyboardNavigationEnabled={isDirectorySurfaceActive}
                      selectedPaths={directoryGridSelectedPaths}
                      onSelectionChange={onDirectoryGridSelectionChange}
                      hasNextPage={listingPage?.hasNextPage ?? false}
                      isLoadingNextPage={listingPage?.isLoadingNextPage ?? false}
                      onLoadNextPage={onLoadNextListingPage}
                    />
                  </div>
                )}
                <WorkspaceResultPanel
                  open={isResultPanelOpen}
                  displayMode={resultPanelDisplayMode}
                  heightPx={resultPanelHeightPx}
                  tabs={projectionTabs}
                  activeTabId={activeProjectionTabId}
                  rootHandle={rootHandle}
                  thumbnailSizePreset={thumbnailSizePreset}
                  gridRef={projectionFileGridRef}
                  selectedPaths={projectionGridSelectedPaths}
                  activeDuplicateSelectionRule={activeDuplicateSelectionRule}
                  keyboardNavigationEnabled={!isDirectorySurfaceActive}
                  hasOpenPreview={hasOpenPreview}
                  onSelectionChange={onProjectionGridSelectionChange}
                  onApplyDuplicateSelectionRule={onApplyDuplicateSelectionRule}
                  onClearDuplicateSelection={onClearDuplicateSelection}
                  onReapplyDuplicateGroup={onReapplyDuplicateGroup}
                  onClearDuplicateGroup={onClearDuplicateGroup}
                  onFileClick={onProjectionFileClick}
                  onFileDoubleClick={onProjectionFileDoubleClick}
                  onDirectoryClick={onDirectoryClick}
                  onOpenPanel={onOpenResultPanel}
                  onClosePanel={onCloseResultPanel}
                  onToggleMaximized={onToggleResultPanelMaximized}
                  onResizeStart={onResultPanelResizeStart}
                  onActivateTab={onActivateProjectionTab}
                  onCloseTab={onCloseProjectionTab}
                />
              </div>
              {pluginTools.length > 0 && (
                <Suspense fallback={null}>
                <WorkspacePluginHost
                  tools={pluginTools}
                  rootHandle={rootHandle}
                  rootId={rootId}
                  currentPath={currentPath}
                    visibleFiles={activeSurfaceFiles}
                    selectedPaths={isDirectorySurfaceActive ? directoryGridSelectedPaths : projectionGridSelectedPaths}
                    resultQueueState={workspacePluginResultQueueState}
                    setResultQueueState={setWorkspacePluginResultQueueState}
                    workbenchState={workspacePluginWorkbenchState}
                    setWorkbenchState={setWorkspacePluginWorkbenchState}
                    onMutationCommitted={onWorkspaceMutationCommitted}
                    activeProjection={activeProjection}
                    onActivateProjection={onActivateProjection}
                    onDismissProjectionTool={onDismissProjectionTool}
                    toolPanelCollapsed={workspaceToolPanelCollapsed}
                    onToggleToolPanelCollapsed={toggleWorkspaceToolPanelCollapsed}
                    toolPanelWidthPx={workspaceToolPanelWidthPx}
                    onToolPanelWidthChange={updateWorkspaceToolPanelWidth}
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
                toolResultQueueState={previewPluginResultQueueState}
                setToolResultQueueState={setPreviewPluginResultQueueState}
                toolWorkbenchState={previewPluginWorkbenchState}
                setToolWorkbenchState={setPreviewPluginWorkbenchState}
                enableContinuousAutoRunOwner={showPreviewPane}
                toolPanelCollapsed={previewToolPanelCollapsed}
                onToggleToolPanelCollapsed={togglePreviewToolPanelCollapsed}
                toolPanelWidthPx={previewToolPanelWidthPx}
                onToolPanelWidthChange={updatePreviewToolPanelWidth}
                onMutationCommitted={onPreviewMutationCommitted}
                onOpenPersonDetail={onOpenPeopleForPerson}
                enableAnnotationTagShortcutOwner={!previewFile}
                activeProjection={activeProjection}
                onActivateProjection={onActivateProjection}
                onDismissProjectionTool={onDismissProjectionTool}
              />
            </Suspense>
          </div>
        )}
      </div>

      {deleteUndoNoticeMessage && (
        <div className="px-4 pb-2">
          <div
            className={
              deleteUndoNoticeTone === 'error'
                ? 'flex items-center justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive'
                : 'flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/60 px-3 py-2 text-sm text-foreground'
            }
          >
            <span className="truncate">{deleteUndoNoticeMessage}</span>
            {canUndoDelete && (
              <button
                type="button"
                className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onUndoDelete}
                disabled={isUndoingDelete}
              >
                {isUndoingDelete ? '恢复中...' : '撤销'}
              </button>
            )}
          </div>
        </div>
      )}

      <ExplorerStatusBar
        rootHandle={rootHandle}
        rootId={rootId}
        visibleFiles={activeSurfaceFiles}
        selectedCount={gridSelectedCount}
        selectedMetaFile={selectedGridMetaFile}
        previewMetaFile={previewFile ?? (showPreviewPane ? selectedFile : null)}
      />

      {previewFile && (
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
            toolResultQueueState={previewPluginResultQueueState}
            setToolResultQueueState={setPreviewPluginResultQueueState}
            toolWorkbenchState={previewPluginWorkbenchState}
            setToolWorkbenchState={setPreviewPluginWorkbenchState}
            enableContinuousAutoRunOwner={!showPreviewPane}
            toolPanelCollapsed={previewToolPanelCollapsed}
            onToggleToolPanelCollapsed={togglePreviewToolPanelCollapsed}
            toolPanelWidthPx={previewToolPanelWidthPx}
            onToolPanelWidthChange={updatePreviewToolPanelWidth}
            onMutationCommitted={onPreviewMutationCommitted}
            onOpenPersonDetail={onOpenPeopleForPerson}
            enableAnnotationTagShortcutOwner
            activeProjection={activeProjection}
            onActivateProjection={onActivateProjection}
            onDismissProjectionTool={onDismissProjectionTool}
          />
        </Suspense>
      )}

      {hasOpenedPeoplePanel && (
        <Suspense fallback={null}>
          <PeoplePanel
            open={showPeoplePanel}
            rootHandle={rootHandle}
            rootId={rootId ?? ''}
            layoutMode="wide"
            readonly={accessProvider === 'remote-readonly'}
            preferredPersonId={peoplePanelPreferredPersonId}
            onClose={onClosePeoplePanel}
            onOpenFaceSource={onOpenFaceSource}
            onProjectFaceSources={onProjectFaceSources}
          />
        </Suspense>
      )}
    </div>
  )
}
