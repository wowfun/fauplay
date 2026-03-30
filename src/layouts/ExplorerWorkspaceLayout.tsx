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
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import type {
  AddressPathHistoryEntry,
  AnnotationFilterTagOption,
  FavoriteFolderEntry,
  FileItem,
  FilterState,
  ResultProjection,
  ResultPanelDisplayMode,
  ThumbnailSizePreset,
} from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'

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

const WORKSPACE_TOOL_PANEL_COLLAPSED_STORAGE_KEY = 'fauplay:workspace-tool-panel-collapsed'
const PREVIEW_TOOL_PANEL_COLLAPSED_STORAGE_KEY = 'fauplay:preview-tool-panel-collapsed'
const WORKSPACE_TOOL_PANEL_WIDTH_STORAGE_KEY = 'fauplay:workspace-tool-panel-width'
const PREVIEW_TOOL_PANEL_WIDTH_STORAGE_KEY = 'fauplay:preview-tool-panel-width'
const SAME_DURATION_SCOPE_STORAGE_KEY = 'fauplay:media-search-same-duration-scope'
const SAME_DURATION_TOOL_NAME = 'media.searchSameDurationVideos'
const SAME_DURATION_SCOPE_OPTION_KEY = 'search.scope'
const DEFAULT_TOOL_PANEL_WIDTH_PX = 320
const MIN_TOOL_PANEL_WIDTH_PX = 320
const MAX_TOOL_PANEL_WIDTH_PX = 640

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

function clampToolPanelWidthPx(value: number): number {
  return Math.min(MAX_TOOL_PANEL_WIDTH_PX, Math.max(MIN_TOOL_PANEL_WIDTH_PX, value))
}

function readPersistedToolPanelWidthPx(key: string): number {
  if (typeof window === 'undefined') return DEFAULT_TOOL_PANEL_WIDTH_PX

  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return DEFAULT_TOOL_PANEL_WIDTH_PX

    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return DEFAULT_TOOL_PANEL_WIDTH_PX
    return clampToolPanelWidthPx(parsed)
  } catch {
    return DEFAULT_TOOL_PANEL_WIDTH_PX
  }
}

function writePersistedToolPanelWidthPx(key: string, value: number): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, String(clampToolPanelWidthPx(value)))
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

function readPersistedSameDurationScope(): 'global' | 'root' | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SAME_DURATION_SCOPE_STORAGE_KEY)
    if (raw === 'global' || raw === 'root') return raw
    return null
  } catch {
    return null
  }
}

function writePersistedSameDurationScope(value: 'global' | 'root'): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SAME_DURATION_SCOPE_STORAGE_KEY, value)
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
  error: string | null
  isLoading: boolean
  directoryFiles: FileItem[]
  activeSurfaceFiles: FileItem[]
  rootHandle: FileSystemDirectoryHandle
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
  pluginTools: GatewayToolDescriptor[]
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
  const [previewPluginResultQueueState, setPreviewPluginResultQueueState] = useState<PluginResultQueueState>({
    byContextKey: {},
    contextOrder: [],
  })
  const [previewPluginWorkbenchState, setPreviewPluginWorkbenchState] = useState<PluginWorkbenchState>(() => {
    const persistedSameDurationScope = readPersistedSameDurationScope()
    const optionValuesByTool: PluginWorkbenchState['optionValuesByTool'] = {}
    if (persistedSameDurationScope) {
      optionValuesByTool[SAME_DURATION_TOOL_NAME] = {
        [SAME_DURATION_SCOPE_OPTION_KEY]: persistedSameDurationScope,
      }
    }

    return {
      activeToolName: null,
      optionValuesByTool,
    }
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
  const [workspaceToolPanelWidthPx, setWorkspaceToolPanelWidthPx] = useState<number>(() => (
    readPersistedToolPanelWidthPx(WORKSPACE_TOOL_PANEL_WIDTH_STORAGE_KEY)
  ))
  const [previewToolPanelWidthPx, setPreviewToolPanelWidthPx] = useState<number>(() => (
    readPersistedToolPanelWidthPx(PREVIEW_TOOL_PANEL_WIDTH_STORAGE_KEY)
  ))

  useEffect(() => {
    writePersistedBoolean(WORKSPACE_TOOL_PANEL_COLLAPSED_STORAGE_KEY, workspaceToolPanelCollapsed)
  }, [workspaceToolPanelCollapsed])

  useEffect(() => {
    writePersistedBoolean(PREVIEW_TOOL_PANEL_COLLAPSED_STORAGE_KEY, previewToolPanelCollapsed)
  }, [previewToolPanelCollapsed])

  useEffect(() => {
    writePersistedToolPanelWidthPx(WORKSPACE_TOOL_PANEL_WIDTH_STORAGE_KEY, workspaceToolPanelWidthPx)
  }, [workspaceToolPanelWidthPx])

  useEffect(() => {
    writePersistedToolPanelWidthPx(PREVIEW_TOOL_PANEL_WIDTH_STORAGE_KEY, previewToolPanelWidthPx)
  }, [previewToolPanelWidthPx])

  useEffect(() => {
    const scopeValue = previewPluginWorkbenchState.optionValuesByTool[SAME_DURATION_TOOL_NAME]?.[SAME_DURATION_SCOPE_OPTION_KEY]
    if (scopeValue === 'global' || scopeValue === 'root') {
      writePersistedSameDurationScope(scopeValue)
    }
  }, [previewPluginWorkbenchState.optionValuesByTool])

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <ExplorerToolbar
        filter={filter}
        onFilterChange={onFilterChange}
        rootId={rootId}
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
                    onToggleToolPanelCollapsed={() => {
                      setWorkspaceToolPanelCollapsed((prev) => !prev)
                    }}
                    toolPanelWidthPx={workspaceToolPanelWidthPx}
                    onToolPanelWidthChange={(nextWidthPx) => {
                      setWorkspaceToolPanelWidthPx(clampToolPanelWidthPx(nextWidthPx))
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
              <FilePreviewPanel
                file={selectedFile}
                rootHandle={rootHandle}
                rootId={rootId}
                previewActionTools={pluginTools}
                onClose={onClosePane}
                onOpenFullscreen={onOpenFullscreenFromPane}
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
                onToggleToolPanelCollapsed={() => {
                  setPreviewToolPanelCollapsed((prev) => !prev)
                }}
                toolPanelWidthPx={previewToolPanelWidthPx}
                onToolPanelWidthChange={(nextWidthPx) => {
                  setPreviewToolPanelWidthPx(clampToolPanelWidthPx(nextWidthPx))
                }}
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
            onToggleToolPanelCollapsed={() => {
              setPreviewToolPanelCollapsed((prev) => !prev)
            }}
            toolPanelWidthPx={previewToolPanelWidthPx}
            onToolPanelWidthChange={(nextWidthPx) => {
              setPreviewToolPanelWidthPx(clampToolPanelWidthPx(nextWidthPx))
            }}
            onMutationCommitted={onPreviewMutationCommitted}
            onOpenPersonDetail={onOpenPeopleForPerson}
            enableAnnotationTagShortcutOwner
            activeProjection={activeProjection}
            onActivateProjection={onActivateProjection}
            onDismissProjectionTool={onDismissProjectionTool}
          />
        </Suspense>
      )}

      {showPeoplePanel && (
        <Suspense fallback={null}>
          <PeoplePanel
            open={showPeoplePanel}
            rootHandle={rootHandle}
            rootId={rootId ?? ''}
            preferredPersonId={peoplePanelPreferredPersonId}
            onClose={onClosePeoplePanel}
          />
        </Suspense>
      )}
    </div>
  )
}
