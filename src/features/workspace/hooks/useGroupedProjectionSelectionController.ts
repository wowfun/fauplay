import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { KeyboardShortcuts } from '@/config/shortcuts'
import {
  resolveGroupedProjectionRangeSelection,
  resolveGroupedProjectionSelectedPathState,
  resolveGroupedProjectionVisibleSelectionState,
  type GroupedProjectionRowsModel,
} from '@/features/workspace/lib/groupedProjectionRowsModel'
import { useGroupedProjectionKeyboardNavigation } from '@/features/workspace/hooks/useGroupedProjectionKeyboardNavigation'
import { useGroupedProjectionItemInteractionHandlers } from '@/features/workspace/hooks/useGroupedProjectionItemInteractionHandlers'
import type { FileItem } from '@/types'

interface FocusItemOptions {
  syncPreview: boolean
  updateAnchor: boolean
  applyRangeSelection: boolean
  queuePreviewAfterShiftRelease: boolean
}

interface UseGroupedProjectionSelectionControllerParams {
  files: FileItem[]
  model: GroupedProjectionRowsModel
  containerRef: RefObject<HTMLDivElement | null>
  pageRowCount: number
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

function arePathSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) {
    if (!right.has(item)) {
      return false
    }
  }
  return true
}

export function useGroupedProjectionSelectionController({
  files,
  model,
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
}: UseGroupedProjectionSelectionControllerParams) {
  const selectedIndexRef = useRef(0)
  const selectedPathRef = useRef<string | null>(null)
  const selectionAnchorPathRef = useRef<string | null>(null)
  const pendingPreviewPathDuringRangeRef = useRef<string | null>(null)
  const [selectedPathSet, setSelectedPathSet] = useState<Set<string>>(() => new Set())

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
  }, [containerRef])

  const scrollIndexIntoView = useCallback((index: number) => {
    requestAnimationFrame(() => {
      const element = containerRef.current?.querySelector<HTMLButtonElement>(`[data-grid-index="${index}"]`)
      element?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      })
    })
  }, [containerRef])

  const focusIndexElement = useCallback((index: number) => {
    requestAnimationFrame(() => {
      const element = containerRef.current?.querySelector<HTMLButtonElement>(
        `[data-grid-index="${index}"]`
      )
      element?.focus({ preventScroll: true })
    })
  }, [containerRef])

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
    focusIndexElement(clampedIndex)

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
  }, [applyRangeSelection, files, focusIndexElement, markSelectedElement, onFileClick, scrollIndexIntoView])

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

  const {
    handleToggleCheckedInteraction,
    handleClickInteraction,
    handleDoubleClickInteraction,
  } = useGroupedProjectionItemInteractionHandlers({
    applyRangeSelection,
    markSelectedElement,
    selectionAnchorPathRef,
    pendingPreviewPathDuringRangeRef,
    toggleCheckedPath,
    onDirectoryClick,
    onFileClick,
    onFileDoubleClick,
  })

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
      focusIndexElement(selectedIndex)
    }
  }, [files, focusIndexElement, markSelectedElement, scrollIndexIntoView])

  useEffect(() => {
    selectionAnchorPathRef.current = null
    pendingPreviewPathDuringRangeRef.current = null
    if (selectedPaths) {
      return
    }
    clearCheckedPaths()
  }, [clearCheckedPaths, selectedPaths, selectionScopeKey])

  useEffect(() => {
    const transientSelectionState = resolveGroupedProjectionVisibleSelectionState({
      files,
      selectedPaths: [],
      selectionAnchorPath: selectionAnchorPathRef.current,
      pendingPreviewPathDuringRange: pendingPreviewPathDuringRangeRef.current,
    })
    selectionAnchorPathRef.current = transientSelectionState.selectionAnchorPath
    pendingPreviewPathDuringRangeRef.current = transientSelectionState.pendingPreviewPathDuringRange

    setCheckedPathSet((previous) => {
      const visibleSelectionState = resolveGroupedProjectionVisibleSelectionState({
        files,
        selectedPaths: [...previous],
        selectionAnchorPath: null,
        pendingPreviewPathDuringRange: null,
      })
      return new Set(visibleSelectionState.selectedPaths)
    })
  }, [files, setCheckedPathSet])

  useEffect(() => {
    const nextState = resolveGroupedProjectionSelectedPathState({
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

  useGroupedProjectionKeyboardNavigation({
    enabled: keyboardNavigationEnabled,
    files,
    model,
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

  return {
    selectedPathSet,
    selectedPathRef,
    handleToggleCheckedInteraction,
    handleClickInteraction,
    handleDoubleClickInteraction,
    syncSelectedPath,
  }
}
