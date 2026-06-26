import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from 'react'
import type { FixedSizeGrid as FixedSizeGridType } from 'react-window'
import type { KeyboardShortcuts } from '@/config/shortcuts'
import {
  resolveFileGridSelectedPathState,
  resolveFileGridTransientSelectionState,
} from '@/features/explorer/lib/fileGridViewportModel'
import { useFileGridItemInteractionHandlers } from '@/features/explorer/hooks/useFileGridItemInteractionHandlers'
import { useFileGridKeyboardNavigation } from '@/features/explorer/hooks/useFileGridKeyboardNavigation'
import { useGridSelection } from '@/hooks/useGridSelection'
import type { FileItem } from '@/types'

interface FileGridKeyboardFocusOptions {
  syncPreview: boolean
  updateAnchor: boolean
  applyRangeSelection: boolean
  queuePreviewAfterShiftRelease: boolean
}

interface UseFileGridSelectionControllerParams {
  files: FileItem[]
  containerRef: RefObject<HTMLDivElement | null>
  gridRef: RefObject<FixedSizeGridType | null>
  columnCount: number
  pageSize: number
  selectedPaths?: string[]
  onSelectionChange: (selectedPaths: string[]) => void
  selectionScopeKey: string
  keyboardNavigationEnabled: boolean
  keyboardShortcuts: KeyboardShortcuts
  canClearSelectionWithEscape: boolean
  onDirectoryClick: (dirName: string) => void
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
}

function getFileSelectionId(file: FileItem): string {
  return file.path
}

export function useFileGridSelectionController({
  files,
  containerRef,
  gridRef,
  columnCount,
  pageSize,
  selectedPaths,
  onSelectionChange,
  selectionScopeKey,
  keyboardNavigationEnabled,
  keyboardShortcuts,
  canClearSelectionWithEscape,
  onDirectoryClick,
  onFileClick,
  onFileDoubleClick,
}: UseFileGridSelectionControllerParams) {
  const selectedIndexRef = useRef(0)
  const selectedPathRef = useRef<string | null>(null)
  const selectionAnchorPathRef = useRef<string | null>(null)
  const pendingPreviewPathDuringRangeRef = useRef<string | null>(null)
  const {
    selectedIdSet: selectedPathSet,
    marqueeRect,
    clearSelection,
    selectAll,
    toggleSelection,
    setAnchorId,
    resetAnchor,
    selectRangeToId,
    handleMarqueePointerDown,
    shouldSuppressClick,
  } = useGridSelection({
    items: files,
    getId: getFileSelectionId,
    selectedIds: selectedPaths ?? null,
    onSelectionChange,
    containerRef,
  })

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
  }, [containerRef])

  const applyRangeSelection = useCallback((
    targetIndex: number,
    options?: { queuePreviewAfterShiftRelease?: boolean },
  ) => {
    if (files.length === 0) return
    const clampedIndex = Math.max(0, Math.min(files.length - 1, targetIndex))
    const targetFile = files[clampedIndex]
    const fallbackAnchor = selectionAnchorPathRef.current ?? selectedPathRef.current ?? targetFile.path
    if (!selectionAnchorPathRef.current) {
      selectionAnchorPathRef.current = fallbackAnchor
      setAnchorId(fallbackAnchor)
    }
    selectRangeToId(targetFile.path)
    markSelectedElement(clampedIndex, targetFile.path)

    if (options?.queuePreviewAfterShiftRelease) {
      pendingPreviewPathDuringRangeRef.current = targetFile.kind === 'file' ? targetFile.path : null
    }
  }, [files, markSelectedElement, selectRangeToId, setAnchorId])

  const focusItem = useCallback((index: number, options: FileGridKeyboardFocusOptions) => {
    if (files.length === 0) return

    const clampedIndex = Math.max(0, Math.min(files.length - 1, index))
    const targetFile = files[clampedIndex]
    markSelectedElement(clampedIndex, targetFile.path)

    gridRef.current?.scrollToItem({
      rowIndex: Math.floor(clampedIndex / columnCount),
      columnIndex: clampedIndex % columnCount,
      align: 'smart',
    })

    requestAnimationFrame(() => {
      const element = containerRef.current?.querySelector<HTMLButtonElement>(
        `[data-grid-index="${clampedIndex}"]`
      )
      element?.focus({ preventScroll: true })
    })

    if (options.updateAnchor) {
      selectionAnchorPathRef.current = targetFile.path
      setAnchorId(targetFile.path)
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
  }, [applyRangeSelection, columnCount, containerRef, files, gridRef, markSelectedElement, onFileClick, setAnchorId])

  const clearCheckedPaths = useCallback(() => {
    clearSelection()
  }, [clearSelection])

  const selectAllVisiblePaths = useCallback(() => {
    selectAll()
  }, [selectAll])

  const syncSelectedPath = useCallback((
    path: string | null,
    options?: { scroll?: boolean; focus?: boolean },
  ) => {
    if (!path || files.length === 0) return

    const selectedIndex = files.findIndex((item) => item.path === path)
    if (selectedIndex < 0) return
    if (
      selectedIndexRef.current === selectedIndex &&
      selectedPathRef.current === path
    ) {
      return
    }

    selectedIndexRef.current = selectedIndex
    selectedPathRef.current = path
    markSelectedElement(selectedIndex, path)

    if (options?.scroll !== false) {
      gridRef.current?.scrollToItem({
        rowIndex: Math.floor(selectedIndex / columnCount),
        columnIndex: selectedIndex % columnCount,
        align: 'smart',
      })
    }

    if (options?.focus) {
      requestAnimationFrame(() => {
        const element = containerRef.current?.querySelector<HTMLButtonElement>(
          `[data-grid-index="${selectedIndex}"]`
        )
        element?.focus({ preventScroll: true })
      })
    }
  }, [columnCount, containerRef, files, gridRef, markSelectedElement])

  useEffect(() => {
    selectionAnchorPathRef.current = null
    resetAnchor()
    pendingPreviewPathDuringRangeRef.current = null
    if (selectedPaths) {
      return
    }
    clearCheckedPaths()
  }, [clearCheckedPaths, resetAnchor, selectedPaths, selectionScopeKey])

  useEffect(() => {
    const nextState = resolveFileGridTransientSelectionState({
      files,
      selectionAnchorPath: selectionAnchorPathRef.current,
      pendingPreviewPathDuringRange: pendingPreviewPathDuringRangeRef.current,
    })

    selectionAnchorPathRef.current = nextState.selectionAnchorPath
    pendingPreviewPathDuringRangeRef.current = nextState.pendingPreviewPathDuringRange

    if (nextState.shouldResetAnchor) {
      resetAnchor()
    }
  }, [files, resetAnchor])

  useEffect(() => {
    const nextState = resolveFileGridSelectedPathState({
      files,
      selectedIndex: selectedIndexRef.current,
      selectedPath: selectedPathRef.current,
    })
    selectedIndexRef.current = nextState.selectedIndex
    selectedPathRef.current = nextState.selectedPath

    const path = selectedPathRef.current
    if (!path) return

    requestAnimationFrame(() => {
      markSelectedElement(selectedIndexRef.current, path)
    })
  }, [files, markSelectedElement])

  useFileGridKeyboardNavigation({
    enabled: keyboardNavigationEnabled,
    keyboardShortcuts,
    files,
    selectedIndexRef,
    pendingPreviewPathDuringRangeRef,
    selectedCount: selectedPathSet.size,
    canClearSelectionWithEscape,
    columnCount,
    pageSize,
    onSelectAll: selectAllVisiblePaths,
    onClearSelection: clearCheckedPaths,
    onFocusItem: focusItem,
    onDirectoryClick,
    onFileClick,
    onFileDoubleClick,
  })

  const {
    handleItemToggleChecked,
    handleItemClick,
    handleItemDoubleClick,
  } = useFileGridItemInteractionHandlers({
    markSelectedElement,
    applyRangeSelection,
    selectionAnchorPathRef,
    pendingPreviewPathDuringRangeRef,
    setAnchorId,
    toggleSelection,
    shouldSuppressClick,
    onDirectoryClick,
    onFileClick,
    onFileDoubleClick,
  })

  return {
    selectedPathSet,
    selectedPathRef,
    marqueeRect,
    handleMarqueePointerDown,
    handleItemToggleChecked,
    handleItemClick,
    handleItemDoubleClick,
    syncSelectedPath,
  }
}
