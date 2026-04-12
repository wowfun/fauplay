import { lazy, Suspense, useEffect, useState, type ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'
import { ExplorerToolbar } from '@/features/explorer/components/ExplorerToolbar'
import { FileBrowserGrid } from '@/features/explorer/components/FileBrowserGrid'
import { ExplorerStatusBar } from '@/features/explorer/components/ExplorerStatusBar'
import { EXPLORER_STATUS_BAR_HEIGHT_PX } from '@/features/explorer/constants/statusBar'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import { WorkspaceResultPanel } from '@/features/workspace/components/WorkspaceResultPanel'
import type { WorkspacePresentationProfile } from '@/features/workspace/types/presentation'
import { ExplorerWorkspaceLayout } from '@/layouts/ExplorerWorkspaceLayout'

const FileLightboxModal = lazy(async () => {
  const mod = await import('@/features/preview/components/FileLightboxModal')
  return { default: mod.FileLightboxModal }
})

const PeoplePanel = lazy(async () => {
  const mod = await import('@/features/faces/components/PeoplePanel')
  return { default: mod.PeoplePanel }
})

type CompactWorkspaceShellProps = ComponentProps<typeof ExplorerWorkspaceLayout> & {
  presentationProfile: WorkspacePresentationProfile
}

const DEFAULT_TOOL_PANEL_WIDTH_PX = 320

export function CompactWorkspaceShell({
  accessProvider,
  presentationProfile,
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
  onPreviewMutationCommitted,
  hasOpenPreview,
  selectedFile,
  gridSelectedCount,
  selectedGridMetaFile,
  pluginTools,
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
  canNavigatePreviewBackward,
  canNavigatePreviewForward,
  onNavigatePreviewBackward,
  onNavigatePreviewForward,
}: CompactWorkspaceShellProps & {
  canNavigatePreviewBackward: boolean
  canNavigatePreviewForward: boolean
  onNavigatePreviewBackward: () => void
  onNavigatePreviewForward: () => void
}) {
  const [previewPluginResultQueueState, setPreviewPluginResultQueueState] = useState<PluginResultQueueState>({
    byContextKey: {},
    contextOrder: [],
  })
  const [previewPluginWorkbenchState, setPreviewPluginWorkbenchState] = useState<PluginWorkbenchState>({
    activeToolName: null,
    optionValuesByTool: {},
  })
  const [previewToolPanelCollapsed, setPreviewToolPanelCollapsed] = useState(false)
  const [previewToolPanelWidthPx, setPreviewToolPanelWidthPx] = useState(DEFAULT_TOOL_PANEL_WIDTH_PX)
  const [hasOpenedPeoplePanel, setHasOpenedPeoplePanel] = useState(showPeoplePanel)

  useEffect(() => {
    if (showPeoplePanel) {
      setHasOpenedPeoplePanel(true)
    }
  }, [showPeoplePanel])

  const showResultOverlay = projectionTabs.length > 0

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <ExplorerToolbar
        accessProvider={accessProvider}
        toolbarKind={presentationProfile.toolbarKind}
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
        <div className="mx-3 mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="h-full min-h-0">
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
            />
          </div>
        )}

        {showResultOverlay && (
          <div
            className={
              resultPanelDisplayMode === 'maximized'
                ? 'absolute inset-0 z-20 bg-background/95 backdrop-blur'
                : 'absolute inset-x-0 bottom-0 z-20'
            }
          >
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
        )}
      </div>

      {deleteUndoNoticeMessage && (
        <div className="px-3 pb-2">
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
        previewMetaFile={previewFile ?? selectedFile}
      />

      {previewFile && (
        <Suspense
          fallback={(
            <div
              className="fixed inset-x-0 top-0 z-50 flex items-center justify-center bg-background"
              style={{ bottom: EXPLORER_STATUS_BAR_HEIGHT_PX }}
            >
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        >
          <FileLightboxModal
            file={previewFile}
            rootHandle={rootHandle}
            rootId={rootId}
            previewActionTools={pluginTools}
            onClose={onClosePreview}
            titleMode={presentationProfile.previewHeaderTitleMode}
            showUnavailableReasons={presentationProfile.showPreviewUnavailableReasons}
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
            enableContinuousAutoRunOwner
            toolPanelCollapsed={previewToolPanelCollapsed}
            onToggleToolPanelCollapsed={() => {
              setPreviewToolPanelCollapsed((previous) => !previous)
            }}
            toolPanelWidthPx={previewToolPanelWidthPx}
            onToolPanelWidthChange={setPreviewToolPanelWidthPx}
            onMutationCommitted={onPreviewMutationCommitted}
            onOpenPersonDetail={onOpenPeopleForPerson}
            enableAnnotationTagShortcutOwner
            activeProjection={activeProjection}
            onActivateProjection={onActivateProjection}
            onDismissProjectionTool={onDismissProjectionTool}
            showNavigationButtons={presentationProfile.previewNavigationUi.showButtons}
            enableImageSwipe={presentationProfile.previewNavigationUi.enableImageSwipe}
            canNavigatePrev={canNavigatePreviewBackward}
            canNavigateNext={canNavigatePreviewForward}
            onNavigatePrev={onNavigatePreviewBackward}
            onNavigateNext={onNavigatePreviewForward}
          />
        </Suspense>
      )}

      {hasOpenedPeoplePanel && (
        <Suspense fallback={null}>
          <PeoplePanel
            open={showPeoplePanel}
            rootHandle={rootHandle}
            rootId={rootId ?? ''}
            layoutMode="compact"
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
