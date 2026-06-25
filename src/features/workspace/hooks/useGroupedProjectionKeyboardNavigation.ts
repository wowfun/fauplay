import { useEffect, type MutableRefObject } from 'react'
import type { KeyboardShortcuts } from '@/config/shortcuts'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import type { FileItem } from '@/types'
import {
  resolveGroupedProjectionKeyboardIntent,
  type GroupedProjectionKeyboardAction,
  type GroupedProjectionRowsModel,
} from '@/features/workspace/lib/groupedProjectionRowsModel'

interface GroupedProjectionKeyboardFocusOptions {
  syncPreview: boolean
  updateAnchor: boolean
  applyRangeSelection: boolean
  queuePreviewAfterShiftRelease: boolean
}

interface UseGroupedProjectionKeyboardNavigationParams {
  enabled: boolean
  files: FileItem[]
  model: GroupedProjectionRowsModel
  keyboardShortcuts: KeyboardShortcuts
  selectedIndexRef: MutableRefObject<number>
  pendingPreviewPathDuringRangeRef: MutableRefObject<string | null>
  selectedCount: number
  canClearSelectionWithEscape: boolean
  pageRowCount: number
  onSelectAll: () => void
  onClearSelection: () => void
  onFocusItem: (index: number, options: GroupedProjectionKeyboardFocusOptions) => void
  onDirectoryClick: (dirName: string) => void
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
}

export function useGroupedProjectionKeyboardNavigation({
  enabled,
  files,
  model,
  keyboardShortcuts,
  selectedIndexRef,
  pendingPreviewPathDuringRangeRef,
  selectedCount,
  canClearSelectionWithEscape,
  pageRowCount,
  onSelectAll,
  onClearSelection,
  onFocusItem,
  onDirectoryClick,
  onFileClick,
  onFileDoubleClick,
}: UseGroupedProjectionKeyboardNavigationParams) {
  useEffect(() => {
    if (!enabled) return

    const getCurrentIndex = () => {
      const active = document.activeElement as HTMLElement | null
      const rawIndex = active?.dataset?.gridIndex
      if (rawIndex === undefined) {
        return selectedIndexRef.current
      }
      const index = Number(rawIndex)
      return Number.isNaN(index) ? selectedIndexRef.current : index
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || files.length === 0 || isTypingTarget(event.target)) return

      const action = resolveKeyboardAction(event, keyboardShortcuts)
      if (!action) return

      const currentIndex = getCurrentIndex()
      const intent = resolveGroupedProjectionKeyboardIntent({
        model,
        action,
        currentIndex,
        fileCount: files.length,
        pageRowCount,
        selectedCount,
        canClearSelectionWithEscape,
      })
      if (intent.kind === 'none') return

      event.preventDefault()

      if (intent.kind === 'select-all') {
        onSelectAll()
        return
      }

      if (intent.kind === 'clear-selection') {
        onClearSelection()
        return
      }

      if (intent.kind === 'open-selected') {
        const targetFile = files[currentIndex]
        if (!targetFile) return

        if (targetFile.kind === 'directory') {
          onDirectoryClick(targetFile.name)
        } else if (onFileDoubleClick) {
          onFileDoubleClick(targetFile)
        } else {
          onFileClick(targetFile)
        }
        return
      }

      if (intent.kind !== 'focus-item') return

      const applyRangeSelectionByKeyboard = event.shiftKey
      onFocusItem(intent.index, {
        syncPreview: !applyRangeSelectionByKeyboard,
        updateAnchor: !applyRangeSelectionByKeyboard,
        applyRangeSelection: applyRangeSelectionByKeyboard,
        queuePreviewAfterShiftRelease: applyRangeSelectionByKeyboard,
      })
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return
      const pendingPath = pendingPreviewPathDuringRangeRef.current
      if (!pendingPath) return
      pendingPreviewPathDuringRangeRef.current = null

      const targetFile = files.find((file) => file.path === pendingPath)
      if (targetFile?.kind === 'file') {
        onFileClick(targetFile)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [
    canClearSelectionWithEscape,
    enabled,
    files,
    keyboardShortcuts,
    model,
    onClearSelection,
    onDirectoryClick,
    onFileClick,
    onFileDoubleClick,
    onFocusItem,
    onSelectAll,
    pageRowCount,
    pendingPreviewPathDuringRangeRef,
    selectedCount,
    selectedIndexRef,
  ])
}

function resolveKeyboardAction(
  event: KeyboardEvent,
  keyboardShortcuts: KeyboardShortcuts,
): GroupedProjectionKeyboardAction | null {
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.selectAll)) return 'select-all'
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.clearSelection)) return 'clear-selection'
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.moveRight)) return 'move-right'
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.moveLeft)) return 'move-left'
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.moveDown)) return 'move-down'
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.moveUp)) return 'move-up'
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.pageDown)) return 'page-down'
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.pageUp)) return 'page-up'
  if (matchesAnyShortcut(event, keyboardShortcuts.grid.openSelected)) return 'open-selected'
  return null
}
