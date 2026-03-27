import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import { ChevronUp, Maximize2, Minimize2, X } from 'lucide-react'
import { FileBrowserGrid, type FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { WorkspaceGroupedProjectionRows } from '@/features/workspace/components/WorkspaceGroupedProjectionRows'
import { isDuplicateProjection, type DuplicateSelectionRule } from '@/features/workspace/lib/duplicateSelection'
import type { FileItem, ResultPanelDisplayMode, ResultProjection, ThumbnailSizePreset } from '@/types'

interface WorkspaceResultPanelProps {
  open: boolean
  displayMode: ResultPanelDisplayMode
  heightPx: number
  tabs: ResultProjection[]
  activeTabId: string | null
  rootHandle: FileSystemDirectoryHandle | null
  thumbnailSizePreset: ThumbnailSizePreset
  gridRef: MutableRefObject<FileBrowserGridHandle | null>
  selectedPaths: string[]
  activeDuplicateSelectionRule: DuplicateSelectionRule | null
  keyboardNavigationEnabled: boolean
  hasOpenPreview: boolean
  onSelectionChange: (selectedPaths: string[]) => void
  onApplyDuplicateSelectionRule: (rule: DuplicateSelectionRule) => void
  onClearDuplicateSelection: () => void
  onReapplyDuplicateGroup: (groupId: string) => void
  onClearDuplicateGroup: (groupId: string) => void
  onFileClick: (file: FileItem) => void
  onFileDoubleClick: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
  onOpenPanel: () => void
  onClosePanel: () => void
  onToggleMaximized: () => void
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

export function WorkspaceResultPanel({
  open,
  displayMode,
  heightPx,
  tabs,
  activeTabId,
  rootHandle,
  thumbnailSizePreset,
  gridRef,
  selectedPaths,
  activeDuplicateSelectionRule,
  keyboardNavigationEnabled,
  hasOpenPreview,
  onSelectionChange,
  onApplyDuplicateSelectionRule,
  onClearDuplicateSelection,
  onReapplyDuplicateGroup,
  onClearDuplicateGroup,
  onFileClick,
  onFileDoubleClick,
  onDirectoryClick,
  onOpenPanel,
  onClosePanel,
  onToggleMaximized,
  onResizeStart,
  onActivateTab,
  onCloseTab,
}: WorkspaceResultPanelProps) {
  if (tabs.length === 0) {
    return null
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null
  const isDuplicateProjectionTab = isDuplicateProjection(activeTab)
  const shouldRenderGroupedRows = Boolean(
    activeTab
    && activeTab.ordering?.mode === 'group_contiguous'
    && activeTab.files.length > 0
    && activeTab.files.every((file) => typeof file.groupId === 'string' && file.groupId.length > 0)
  )
  const duplicateRuleActions: Array<{ rule: DuplicateSelectionRule; label: string }> = [
    { rule: 'keep_newest', label: '保留最新' },
    { rule: 'keep_oldest', label: '保留最旧' },
    { rule: 'keep_current_or_first', label: '保留当前文件/首项' },
  ]
  if (!open) {
    return (
      <div className="shrink-0 border-t border-border bg-card/70 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">结果面板已关闭</p>
            <p className="text-xs text-muted-foreground">
              已保留 {tabs.length} 个结果标签
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border/80 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent/40"
            onClick={onOpenPanel}
          >
            <ChevronUp className="h-3.5 w-3.5" />
            打开结果面板
          </button>
        </div>
      </div>
    )
  }

  return (
    <section
      className={`relative min-h-0 border-t border-border bg-card/70 backdrop-blur flex flex-col ${
        displayMode === 'maximized' ? 'flex-1' : 'shrink-0'
      }`}
      style={displayMode === 'normal' ? { height: `${heightPx}px` } : undefined}
      data-plugin-subzone="WorkspaceResultPanel"
    >
      {displayMode === 'normal' && (
        <div
          className="absolute left-0 right-0 top-0 h-1.5 cursor-row-resize hover:bg-primary/30 bg-transparent transition-colors z-20"
          onMouseDown={onResizeStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整结果面板高度"
        />
      )}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex items-center gap-2">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab?.id
              return (
                <div
                  key={tab.id}
                  className={`inline-flex min-w-0 items-center gap-1 rounded-md border px-2 py-1 ${
                    isActive
                      ? 'border-primary/40 bg-accent/60 text-foreground'
                      : 'border-border/70 bg-background/60 text-muted-foreground'
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 text-left text-xs font-medium"
                    onClick={() => {
                      onActivateTab(tab.id)
                    }}
                  >
                    <span className="block truncate max-w-[180px]">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    className="rounded-sm p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                    aria-label={`关闭 ${tab.title}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded-md border border-border/80 p-1.5 text-foreground transition-colors hover:bg-accent/40"
            onClick={onToggleMaximized}
            aria-label={displayMode === 'maximized' ? '恢复结果面板大小' : '最大化结果面板'}
            title={displayMode === 'maximized' ? '恢复结果面板大小' : '最大化结果面板'}
          >
            {displayMode === 'maximized' ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="rounded-md border border-border/80 p-1.5 text-foreground transition-colors hover:bg-accent/40"
            onClick={onClosePanel}
            aria-label="关闭结果面板"
            title="关闭结果面板"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {isDuplicateProjectionTab && (
        <div className="border-b border-border/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground">快捷选择</span>
            {duplicateRuleActions.map((action) => {
              const isActive = activeDuplicateSelectionRule === action.rule
              return (
                <button
                  key={action.rule}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                    isActive
                      ? 'border-primary/40 bg-accent/60 text-foreground'
                      : 'border-border/80 text-foreground hover:bg-accent/40'
                  }`}
                  onClick={() => {
                    onApplyDuplicateSelectionRule(action.rule)
                  }}
                >
                  {action.label}
                </button>
              )
            })}
            <button
              type="button"
              className="rounded-md border border-border/80 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent/40"
              onClick={onClearDuplicateSelection}
            >
              清空全部
            </button>
            <span className="ml-auto text-xs text-muted-foreground">已选 = 待处理项</span>
          </div>
        </div>
      )}
      {activeTab ? (
        <div className="flex-1 min-h-0">
          {shouldRenderGroupedRows ? (
            <WorkspaceGroupedProjectionRows
              ref={gridRef}
              files={activeTab.files}
              rootHandle={rootHandle}
              thumbnailSizePreset={thumbnailSizePreset}
              selectionScopeKey={`projection:${activeTab.id}`}
              canClearSelectionWithEscape={!hasOpenPreview}
              keyboardNavigationEnabled={keyboardNavigationEnabled}
              selectedPaths={selectedPaths}
              onSelectionChange={onSelectionChange}
              showGroupActions={isDuplicateProjectionTab}
              canReapplyGroup={activeDuplicateSelectionRule !== null}
              onReapplyGroup={onReapplyDuplicateGroup}
              onClearGroup={onClearDuplicateGroup}
              onFileClick={onFileClick}
              onFileDoubleClick={onFileDoubleClick}
              onDirectoryClick={onDirectoryClick}
            />
          ) : (
            <FileBrowserGrid
              ref={gridRef}
              files={activeTab.files}
              rootHandle={rootHandle}
              thumbnailSizePreset={thumbnailSizePreset}
              onFileClick={onFileClick}
              onFileDoubleClick={onFileDoubleClick}
              onDirectoryClick={onDirectoryClick}
              selectionScopeKey={`projection:${activeTab.id}`}
              canClearSelectionWithEscape={!hasOpenPreview}
              keyboardNavigationEnabled={keyboardNavigationEnabled}
              selectedPaths={selectedPaths}
              onSelectionChange={onSelectionChange}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">
          没有可显示的结果标签
        </div>
      )}
    </section>
  )
}
