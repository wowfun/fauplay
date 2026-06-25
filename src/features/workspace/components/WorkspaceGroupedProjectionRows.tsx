import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { FileGridCard } from '@/features/explorer/components/FileGridCard'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import {
  buildGroupedProjectionRowsModel,
  resolveGroupedProjectionRangeSelection,
} from '@/features/workspace/lib/groupedProjectionRowsModel'
import { useGroupedProjectionKeyboardNavigation } from '@/features/workspace/hooks/useGroupedProjectionKeyboardNavigation'
import { FILE_GRID_CARD_SIZE_BY_PRESET, FILE_GRID_GAP } from '@/features/explorer/constants/gridLayout'
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

interface FocusItemOptions {
  syncPreview: boolean
  updateAnchor: boolean
  applyRangeSelection: boolean
  queuePreviewAfterShiftRelease: boolean
}

function arePathSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) {
    if (!right.has(item)) {
      return false
    }
  }
  return true
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
    const containerRef = useRef<HTMLDivElement>(null)
    const selectedIndexRef = useRef(0)
    const selectedPathRef = useRef<string | null>(null)
    const selectionAnchorPathRef = useRef<string | null>(null)
    const pendingPreviewPathDuringRangeRef = useRef<string | null>(null)
    const [containerHeight, setContainerHeight] = useState(0)
    const [selectedPathSet, setSelectedPathSet] = useState<Set<string>>(() => new Set())
    const cardSize = FILE_GRID_CARD_SIZE_BY_PRESET[thumbnailSizePreset]
    const groupedRowsModel = useMemo(() => {
      return buildGroupedProjectionRowsModel(files)
    }, [files])
    const groupedRows = groupedRowsModel.rows

    const pageRowCount = useMemo(() => {
      const rowHeight = cardSize.height + FILE_GRID_GAP
      return Math.max(1, Math.floor(containerHeight / rowHeight))
    }, [cardSize.height, containerHeight])

    const orderedSelectedPaths = useMemo(() => {
      return files.filter((file) => selectedPathSet.has(file.path)).map((file) => file.path)
    }, [files, selectedPathSet])

    const markSelectedElement = useCallback((index: number, path: string) => {
      selectedIndexRef.current = index
      selectedPathRef.current = path

      const container = containerRef.current
      if (!container) return

      const prev = container.querySelector<HTMLButtonElement>('[data-grid-selected="true"]')
      if (prev) {
        prev.setAttribute('data-grid-selected', 'false')
      }

      const next = container.querySelector<HTMLButtonElement>(`[data-grid-index="${index}"]`)
      if (next) {
        next.setAttribute('data-grid-selected', 'true')
      }
    }, [])

    const scrollIndexIntoView = useCallback((index: number) => {
      requestAnimationFrame(() => {
        const element = containerRef.current?.querySelector<HTMLButtonElement>(`[data-grid-index="${index}"]`)
        element?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        })
      })
    }, [])

    const setCheckedPathSet = useCallback((updater: (previous: Set<string>) => Set<string>) => {
      setSelectedPathSet((previous) => {
        const next = updater(previous)
        if (arePathSetsEqual(previous, next)) {
          return previous
        }
        return next
      })
    }, [])

    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerHeight(entry.contentRect.height)
        }
      })

      observer.observe(container)
      return () => observer.disconnect()
    }, [])

    useEffect(() => {
      onSelectionChange(orderedSelectedPaths)
    }, [onSelectionChange, orderedSelectedPaths])

    useEffect(() => {
      if (!selectedPaths) return
      const nextPathSet = new Set(selectedPaths)
      setCheckedPathSet((previous) => (
        arePathSetsEqual(previous, nextPathSet) ? previous : nextPathSet
      ))
    }, [selectedPaths, setCheckedPathSet])

    const applyRangeSelection = useCallback((targetIndex: number, options?: { queuePreviewAfterShiftRelease?: boolean }) => {
      const selection = resolveGroupedProjectionRangeSelection({
        files,
        targetIndex,
        anchorPath: selectionAnchorPathRef.current,
        fallbackPath: selectedPathRef.current,
      })
      if (!selection) return

      setCheckedPathSet(() => new Set(selection.selectedPaths))
      markSelectedElement(selection.clampedIndex, selection.targetPath)
      scrollIndexIntoView(selection.clampedIndex)

      if (options?.queuePreviewAfterShiftRelease) {
        const targetFile = files[selection.clampedIndex]
        pendingPreviewPathDuringRangeRef.current = targetFile?.kind === 'file' ? targetFile.path : null
      }
    }, [files, markSelectedElement, scrollIndexIntoView, setCheckedPathSet])

    const focusItem = useCallback((index: number, options: FocusItemOptions) => {
      if (files.length === 0) return

      const clampedIndex = Math.max(0, Math.min(files.length - 1, index))
      const targetFile = files[clampedIndex]
      markSelectedElement(clampedIndex, targetFile.path)
      scrollIndexIntoView(clampedIndex)

      requestAnimationFrame(() => {
        const element = containerRef.current?.querySelector<HTMLButtonElement>(
          `[data-grid-index="${clampedIndex}"]`
        )
        element?.focus({ preventScroll: true })
      })

      if (options.updateAnchor) {
        selectionAnchorPathRef.current = targetFile.path
      }

      if (options.applyRangeSelection) {
        applyRangeSelection(clampedIndex, {
          queuePreviewAfterShiftRelease: options.queuePreviewAfterShiftRelease,
        })
        return
      }

      pendingPreviewPathDuringRangeRef.current = null

      if (options.syncPreview && targetFile.kind === 'file') {
        onFileClick(targetFile)
      }
    }, [applyRangeSelection, files, markSelectedElement, onFileClick, scrollIndexIntoView])

    const toggleCheckedPath = useCallback((path: string) => {
      setCheckedPathSet((previous) => {
        const next = new Set(previous)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      })
    }, [setCheckedPathSet])

    const clearCheckedPaths = useCallback(() => {
      setCheckedPathSet((previous) => {
        if (previous.size === 0) return previous
        return new Set()
      })
    }, [setCheckedPathSet])

    const selectAllVisiblePaths = useCallback(() => {
      setCheckedPathSet(() => new Set(files.map((file) => file.path)))
    }, [files, setCheckedPathSet])

    const syncSelectedPath = useCallback((
      path: string | null,
      options?: { scroll?: boolean; focus?: boolean }
    ) => {
      if (!path || files.length === 0) return

      const selectedIndex = files.findIndex((file) => file.path === path)
      if (selectedIndex < 0) return

      selectedIndexRef.current = selectedIndex
      selectedPathRef.current = path
      markSelectedElement(selectedIndex, path)

      if (options?.scroll !== false) {
        scrollIndexIntoView(selectedIndex)
      }

      if (options?.focus) {
        requestAnimationFrame(() => {
          const element = containerRef.current?.querySelector<HTMLButtonElement>(
            `[data-grid-index="${selectedIndex}"]`
          )
          element?.focus({ preventScroll: true })
        })
      }
    }, [files, markSelectedElement, scrollIndexIntoView])

    useImperativeHandle(ref, () => ({
      syncSelectedPath,
    }), [syncSelectedPath])

    useEffect(() => {
      selectionAnchorPathRef.current = null
      pendingPreviewPathDuringRangeRef.current = null
      if (selectedPaths) {
        return
      }
      clearCheckedPaths()
    }, [clearCheckedPaths, selectedPaths, selectionScopeKey])

    useEffect(() => {
      const visiblePathSet = new Set(files.map((file) => file.path))
      setCheckedPathSet((previous) => {
        return new Set([...previous].filter((path) => visiblePathSet.has(path)))
      })

      if (selectionAnchorPathRef.current && !visiblePathSet.has(selectionAnchorPathRef.current)) {
        selectionAnchorPathRef.current = null
      }
      if (
        pendingPreviewPathDuringRangeRef.current
        && !visiblePathSet.has(pendingPreviewPathDuringRangeRef.current)
      ) {
        pendingPreviewPathDuringRangeRef.current = null
      }
    }, [files, setCheckedPathSet])

    useEffect(() => {
      if (files.length === 0) {
        selectedIndexRef.current = 0
        selectedPathRef.current = null
        return
      }

      const selectedPath = selectedPathRef.current
      if (selectedPath) {
        const selectedIndexByPath = files.findIndex((item) => item.path === selectedPath)
        if (selectedIndexByPath >= 0) {
          selectedIndexRef.current = selectedIndexByPath
        } else {
          selectedIndexRef.current = Math.min(selectedIndexRef.current, files.length - 1)
          selectedPathRef.current = files[selectedIndexRef.current]?.path ?? null
        }
      } else {
        selectedIndexRef.current = Math.min(selectedIndexRef.current, files.length - 1)
        selectedPathRef.current = files[selectedIndexRef.current]?.path ?? null
      }

      const path = selectedPathRef.current
      if (!path) return

      requestAnimationFrame(() => {
        markSelectedElement(selectedIndexRef.current, path)
      })
    }, [files, markSelectedElement])

    useGroupedProjectionKeyboardNavigation({
      enabled: keyboardNavigationEnabled,
      files,
      model: groupedRowsModel,
      keyboardShortcuts,
      selectedIndexRef,
      pendingPreviewPathDuringRangeRef,
      selectedCount: selectedPathSet.size,
      canClearSelectionWithEscape,
      pageRowCount,
      onSelectAll: selectAllVisiblePaths,
      onClearSelection: clearCheckedPaths,
      onFocusItem: focusItem,
      onDirectoryClick,
      onFileClick,
      onFileDoubleClick,
    })

    const handleHorizontalRowWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.shiftKey) {
        return
      }
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return
      }
      const container = containerRef.current
      if (!container) {
        return
      }
      event.preventDefault()
      container.scrollTop += event.deltaY
    }, [])

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
                              markSelectedElement(index, file.path)

                              if (event.shiftKey) {
                                applyRangeSelection(index)
                                return
                              }

                              selectionAnchorPathRef.current = file.path
                              pendingPreviewPathDuringRangeRef.current = null
                              toggleCheckedPath(file.path)
                            }}
                            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                              markSelectedElement(index, file.path)

                              if (event.shiftKey) {
                                applyRangeSelection(index)
                                return
                              }

                              if (event.ctrlKey || event.metaKey) {
                                selectionAnchorPathRef.current = file.path
                                pendingPreviewPathDuringRangeRef.current = null
                                toggleCheckedPath(file.path)
                                return
                              }

                              selectionAnchorPathRef.current = file.path
                              pendingPreviewPathDuringRangeRef.current = null
                              if (file.kind === 'directory') {
                                onDirectoryClick(file.name)
                              } else {
                                onFileClick(file)
                              }
                            }}
                            onDoubleClick={() => {
                              if (file.kind === 'file' && onFileDoubleClick) {
                                onFileDoubleClick(file)
                              }
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
