import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { FileGridCard } from '@/features/explorer/components/FileGridCard'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import { buildGroupedProjectionRowsModel } from '@/features/workspace/lib/groupedProjectionRowsModel'
import { useGroupedProjectionRowsLayout } from '@/features/workspace/hooks/useGroupedProjectionRowsLayout'
import { useGroupedProjectionSelectionController } from '@/features/workspace/hooks/useGroupedProjectionSelectionController'
import { FILE_GRID_CARD_SIZE_BY_PRESET } from '@/features/explorer/constants/gridLayout'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import type { ThumbnailTaskPriority } from '@/lib/thumbnailPipeline'
import type { FileItem, ThumbnailSizePreset } from '@/types'

interface WorkspaceGroupedProjectionRowsProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  thumbnailSizePreset: ThumbnailSizePreset
  selectionScopeKey: string
  canClearSelectionWithEscape: boolean
  keyboardNavigationEnabled?: boolean
  selectedPaths?: string[]
  onSelectionChange: (selectedPaths: string[]) => void
  showGroupActions?: boolean
  canReapplyGroup?: boolean
  onReapplyGroup?: (groupId: string) => void
  onClearGroup?: (groupId: string) => void
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
}

export const WorkspaceGroupedProjectionRows = forwardRef<FileBrowserGridHandle, WorkspaceGroupedProjectionRowsProps>(
  function WorkspaceGroupedProjectionRows({
    files,
    rootHandle,
    thumbnailSizePreset,
    selectionScopeKey,
    canClearSelectionWithEscape,
    keyboardNavigationEnabled = true,
    selectedPaths,
    onSelectionChange,
    showGroupActions = false,
    canReapplyGroup = false,
    onReapplyGroup,
    onClearGroup,
    onFileClick,
    onFileDoubleClick,
    onDirectoryClick,
  }, ref) {
    const keyboardShortcuts = useKeyboardShortcuts()
    const cardSize = FILE_GRID_CARD_SIZE_BY_PRESET[thumbnailSizePreset]
    const groupedRowsModel = useMemo(() => buildGroupedProjectionRowsModel(files), [files])
    const groupedRows = groupedRowsModel.rows
    const {
      containerRef,
      pageRowCount,
      handleHorizontalRowWheel,
    } = useGroupedProjectionRowsLayout({
      cardHeight: cardSize.height,
    })
    const {
      selectedPathSet,
      selectedPathRef,
      handleToggleCheckedInteraction,
      handleClickInteraction,
      handleDoubleClickInteraction,
      syncSelectedPath,
    } = useGroupedProjectionSelectionController({
      files,
      model: groupedRowsModel,
      containerRef,
      pageRowCount,
      selectedPaths,
      onSelectionChange,
      selectionScopeKey,
      keyboardNavigationEnabled,
      keyboardShortcuts,
      canClearSelectionWithEscape,
      onDirectoryClick,
      onFileClick,
      onFileDoubleClick,
    })

    useImperativeHandle(ref, () => ({
      syncSelectedPath,
    }), [syncSelectedPath])

    if (files.length === 0) {
      return (
        <div className="h-full w-full flex items-center justify-center text-muted-foreground">
          <p>没有文件</p>
        </div>
      )
    }

    return (
      <div ref={containerRef} className="h-full w-full overflow-y-auto overflow-x-hidden px-3 py-3">
        <div className="space-y-4">
          {groupedRows.map((row, rowIndex) => {
            const selectedCount = row.items.filter(({ file }) => selectedPathSet.has(file.path)).length
            return (
              <section key={row.groupId} className="space-y-2">
                {showGroupActions && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        重复组 {rowIndex + 1}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.items.length} 个文件，已选 {selectedCount} 个待处理项
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-border/80 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => {
                          onReapplyGroup?.(row.groupId)
                        }}
                        disabled={!canReapplyGroup}
                      >
                        重应用本组
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-border/80 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent/40"
                        onClick={() => {
                          onClearGroup?.(row.groupId)
                        }}
                      >
                        清空本组
                      </button>
                    </div>
                  </div>
                )}
                <div
                  className="overflow-x-auto overflow-y-hidden scrollbar-thin"
                  onWheel={handleHorizontalRowWheel}
                >
                  <div className="flex min-w-fit gap-4 pb-1">
                    {row.items.map(({ file, index }) => {
                      const thumbnailPriority: ThumbnailTaskPriority = 'visible'
                      return (
                        <div
                          key={file.path}
                          style={{
                            width: cardSize.width,
                            height: cardSize.height,
                            flex: '0 0 auto',
                          }}
                        >
                          <FileGridCard
                            file={file}
                            rootHandle={rootHandle}
                            itemIndex={index}
                            thumbnailSizePreset={thumbnailSizePreset}
                            thumbnailPriority={thumbnailPriority}
                            isSelected={file.path === selectedPathRef.current}
                            isChecked={selectedPathSet.has(file.path)}
                            onToggleChecked={(event: ReactMouseEvent<HTMLInputElement>) => {
                              event.stopPropagation()
                              handleToggleCheckedInteraction({
                                file,
                                index,
                                shiftKey: event.shiftKey,
                              })
                            }}
                            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                              handleClickInteraction({
                                file,
                                index,
                                shiftKey: event.shiftKey,
                                toggleModifier: event.ctrlKey || event.metaKey,
                              })
                            }}
                            onDoubleClick={() => {
                              handleDoubleClickInteraction({
                                file,
                                index,
                              })
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      </div>
    )
  }
)
