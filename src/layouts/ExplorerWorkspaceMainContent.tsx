import { lazy, Suspense, type MutableRefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { FileBrowserGrid } from '@/features/explorer/components/FileBrowserGrid'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { WorkspaceResultPanel } from '@/features/workspace/components/WorkspaceResultPanel'
import type { WorkspacePluginPanelState } from '@/features/workspace/hooks/useWorkspacePluginPanelState'
import type { DuplicateSelectionRule } from '@/features/workspace/lib/duplicateSelection'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import type { RuntimeToolDescriptor } from '@/lib/runtimeApi'
import type {
  FileItem,
  ListingPageState,
  ResultProjection,
  ResultPanelDisplayMode,
  ThumbnailSizePreset,
} from '@/types'

const WorkspacePluginHost = lazy(async () => {
  const mod = await import('@/features/explorer/components/WorkspacePluginHost')
  return { default: mod.WorkspacePluginHost }
})

interface ExplorerWorkspaceMainContentProps {
  isLoading: boolean
  currentPath: string
  directoryFiles: FileItem[]
  listingPage?: ListingPageState
  onLoadNextListingPage?: () => Promise<void>
  activeSurfaceFiles: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  thumbnailSizePreset: ThumbnailSizePreset
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
  onResultPanelResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void
  onActivateProjectionTab: (tabId: string) => void
  onCloseProjectionTab: (tabId: string) => void
  onWorkspaceMutationCommitted: (params?: WorkspaceMutationCommitParams) => void | Promise<void>
  hasOpenPreview: boolean
  pluginTools: RuntimeToolDescriptor[]
  pluginPanelState: WorkspacePluginPanelState
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
  onDismissProjectionTool: (toolName: string) => void
}

export function ExplorerWorkspaceMainContent({
  isLoading,
  currentPath,
  directoryFiles,
  listingPage,
  onLoadNextListingPage,
  activeSurfaceFiles,
  rootHandle,
  rootId,
  thumbnailSizePreset,
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
  hasOpenPreview,
  pluginTools,
  pluginPanelState,
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
}: ExplorerWorkspaceMainContentProps) {
  return (
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
                resultQueueState={pluginPanelState.workspacePluginResultQueueState}
                setResultQueueState={pluginPanelState.setWorkspacePluginResultQueueState}
                workbenchState={pluginPanelState.workspacePluginWorkbenchState}
                setWorkbenchState={pluginPanelState.setWorkspacePluginWorkbenchState}
                onMutationCommitted={onWorkspaceMutationCommitted}
                activeProjection={activeProjection}
                onActivateProjection={onActivateProjection}
                onDismissProjectionTool={onDismissProjectionTool}
                toolPanelCollapsed={pluginPanelState.workspaceToolPanelCollapsed}
                onToggleToolPanelCollapsed={pluginPanelState.toggleWorkspaceToolPanelCollapsed}
                toolPanelWidthPx={pluginPanelState.workspaceToolPanelWidthPx}
                onToolPanelWidthChange={pluginPanelState.updateWorkspaceToolPanelWidth}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  )
}
