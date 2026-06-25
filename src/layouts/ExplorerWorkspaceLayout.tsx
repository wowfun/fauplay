import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import { ExplorerToolbar } from '@/features/explorer/components/ExplorerToolbar'
import type { ShortcutHelpEntry } from '@/features/explorer/hooks/useShortcutHelpEntries'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { ExplorerStatusBar } from '@/features/explorer/components/ExplorerStatusBar'
import { ExplorerWorkspaceDeleteUndoNotice } from '@/layouts/ExplorerWorkspaceDeleteUndoNotice'
import { ExplorerWorkspaceMainContent } from '@/layouts/ExplorerWorkspaceMainContent'
import { ExplorerWorkspacePeoplePanel } from '@/layouts/ExplorerWorkspacePeoplePanel'
import {
  ExplorerWorkspacePreviewModal,
  ExplorerWorkspacePreviewPane,
} from '@/layouts/ExplorerWorkspacePreviewSurfaces'
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
  const pluginPanelState = useWorkspacePluginPanelState()

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
        <ExplorerWorkspaceMainContent
          isLoading={isLoading}
          currentPath={currentPath}
          directoryFiles={directoryFiles}
          listingPage={listingPage}
          onLoadNextListingPage={onLoadNextListingPage}
          activeSurfaceFiles={activeSurfaceFiles}
          rootHandle={rootHandle}
          rootId={rootId}
          thumbnailSizePreset={thumbnailSizePreset}
          directoryFileGridRef={directoryFileGridRef}
          projectionFileGridRef={projectionFileGridRef}
          onDirectoryFileClick={onDirectoryFileClick}
          onDirectoryFileDoubleClick={onDirectoryFileDoubleClick}
          onProjectionFileClick={onProjectionFileClick}
          onProjectionFileDoubleClick={onProjectionFileDoubleClick}
          onDirectoryClick={onDirectoryClick}
          onDirectoryGridSelectionChange={onDirectoryGridSelectionChange}
          directoryGridSelectedPaths={directoryGridSelectedPaths}
          projectionTabs={projectionTabs}
          activeProjectionTabId={activeProjectionTabId}
          onProjectionGridSelectionChange={onProjectionGridSelectionChange}
          projectionGridSelectedPaths={projectionGridSelectedPaths}
          activeDuplicateSelectionRule={activeDuplicateSelectionRule}
          onApplyDuplicateSelectionRule={onApplyDuplicateSelectionRule}
          onClearDuplicateSelection={onClearDuplicateSelection}
          onReapplyDuplicateGroup={onReapplyDuplicateGroup}
          onClearDuplicateGroup={onClearDuplicateGroup}
          isDirectorySurfaceActive={isDirectorySurfaceActive}
          isResultPanelOpen={isResultPanelOpen}
          resultPanelDisplayMode={resultPanelDisplayMode}
          resultPanelHeightPx={resultPanelHeightPx}
          onOpenResultPanel={onOpenResultPanel}
          onCloseResultPanel={onCloseResultPanel}
          onToggleResultPanelMaximized={onToggleResultPanelMaximized}
          onResultPanelResizeStart={onResultPanelResizeStart}
          onActivateProjectionTab={onActivateProjectionTab}
          onCloseProjectionTab={onCloseProjectionTab}
          onWorkspaceMutationCommitted={onWorkspaceMutationCommitted}
          hasOpenPreview={hasOpenPreview}
          pluginTools={pluginTools}
          pluginPanelState={pluginPanelState}
          activeProjection={activeProjection}
          onActivateProjection={onActivateProjection}
          onDismissProjectionTool={onDismissProjectionTool}
        />

        <ExplorerWorkspacePreviewPane
          showPreviewPane={showPreviewPane}
          contentRef={contentRef}
          paneWidthRatio={paneWidthRatio}
          onPreviewPaneResizeStart={onPreviewPaneResizeStart}
          selectedFile={selectedFile}
          previewFile={previewFile}
          rootHandle={rootHandle}
          rootId={rootId}
          pluginTools={pluginTools}
          pluginPanelState={pluginPanelState}
          previewHeaderTitleMode={previewHeaderTitleMode}
          showPreviewUnavailableReasons={showPreviewUnavailableReasons}
          onClosePane={onClosePane}
          onOpenFullscreenFromPane={onOpenFullscreenFromPane}
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
          onPreviewMutationCommitted={onPreviewMutationCommitted}
          onOpenPeopleForPerson={onOpenPeopleForPerson}
          activeProjection={activeProjection}
          onActivateProjection={onActivateProjection}
          onDismissProjectionTool={onDismissProjectionTool}
        />
      </div>

      <ExplorerWorkspaceDeleteUndoNotice
        message={deleteUndoNoticeMessage}
        tone={deleteUndoNoticeTone}
        canUndoDelete={canUndoDelete}
        isUndoingDelete={isUndoingDelete}
        onUndoDelete={onUndoDelete}
      />

      <ExplorerStatusBar
        rootHandle={rootHandle}
        rootId={rootId}
        visibleFiles={activeSurfaceFiles}
        selectedCount={gridSelectedCount}
        selectedMetaFile={selectedGridMetaFile}
        previewMetaFile={previewFile ?? (showPreviewPane ? selectedFile : null)}
      />

      <ExplorerWorkspacePreviewModal
        showPreviewPane={showPreviewPane}
        previewFile={previewFile}
        previewAutoPlayOnOpen={previewAutoPlayOnOpen}
        rootHandle={rootHandle}
        rootId={rootId}
        pluginTools={pluginTools}
        pluginPanelState={pluginPanelState}
        previewHeaderTitleMode={previewHeaderTitleMode}
        showPreviewUnavailableReasons={showPreviewUnavailableReasons}
        onClosePreview={onClosePreview}
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
        onPreviewMutationCommitted={onPreviewMutationCommitted}
        onOpenPeopleForPerson={onOpenPeopleForPerson}
        activeProjection={activeProjection}
        onActivateProjection={onActivateProjection}
        onDismissProjectionTool={onDismissProjectionTool}
      />

      <ExplorerWorkspacePeoplePanel
        accessProvider={accessProvider}
        showPeoplePanel={showPeoplePanel}
        peoplePanelPreferredPersonId={peoplePanelPreferredPersonId}
        rootHandle={rootHandle}
        rootId={rootId}
        onClosePeoplePanel={onClosePeoplePanel}
        onOpenFaceSource={onOpenFaceSource}
        onProjectFaceSources={onProjectFaceSources}
      />
    </div>
  )
}
