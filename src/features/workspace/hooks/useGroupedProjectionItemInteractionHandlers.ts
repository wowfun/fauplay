import { useCallback, type MutableRefObject } from 'react'
import {
  resolveGroupedProjectionItemInteraction,
  type GroupedProjectionItemInteractionIntent,
} from '@/features/workspace/lib/groupedProjectionRowsModel'
import type { FileItem } from '@/types'

interface UseGroupedProjectionItemInteractionHandlersParams {
  applyRangeSelection: (targetIndex: number) => void
  markSelectedElement: (index: number, path: string) => void
  selectionAnchorPathRef: MutableRefObject<string | null>
  pendingPreviewPathDuringRangeRef: MutableRefObject<string | null>
  toggleCheckedPath: (path: string) => void
  onDirectoryClick: (dirName: string) => void
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
}

export interface GroupedProjectionItemInteractionHandlers {
  handleToggleCheckedInteraction: (
    params: { file: FileItem; index: number; shiftKey: boolean }
  ) => void
  handleClickInteraction: (
    params: { file: FileItem; index: number; shiftKey: boolean; toggleModifier: boolean }
  ) => void
  handleDoubleClickInteraction: (
    params: { file: FileItem; index: number }
  ) => void
}

export function useGroupedProjectionItemInteractionHandlers({
  applyRangeSelection,
  markSelectedElement,
  selectionAnchorPathRef,
  pendingPreviewPathDuringRangeRef,
  toggleCheckedPath,
  onDirectoryClick,
  onFileClick,
  onFileDoubleClick,
}: UseGroupedProjectionItemInteractionHandlersParams): GroupedProjectionItemInteractionHandlers {
  const handleItemInteractionIntent = useCallback((intent: GroupedProjectionItemInteractionIntent) => {
    switch (intent.kind) {
      case 'none':
        return
      case 'range-select':
        applyRangeSelection(intent.index)
        return
      case 'toggle-check':
        markSelectedElement(intent.markedIndex, intent.path)
        selectionAnchorPathRef.current = intent.anchorPath
        pendingPreviewPathDuringRangeRef.current = null
        toggleCheckedPath(intent.path)
        return
      case 'open-directory':
        markSelectedElement(intent.markedIndex, intent.anchorPath)
        selectionAnchorPathRef.current = intent.anchorPath
        pendingPreviewPathDuringRangeRef.current = null
        onDirectoryClick(intent.dirName)
        return
      case 'open-file':
        markSelectedElement(intent.markedIndex, intent.anchorPath)
        selectionAnchorPathRef.current = intent.anchorPath
        pendingPreviewPathDuringRangeRef.current = null
        onFileClick(intent.file)
        return
      case 'open-file-secondary':
        markSelectedElement(intent.markedIndex, intent.file.path)
        onFileDoubleClick?.(intent.file)
        return
    }
  }, [
    applyRangeSelection,
    markSelectedElement,
    onDirectoryClick,
    onFileClick,
    onFileDoubleClick,
    pendingPreviewPathDuringRangeRef,
    selectionAnchorPathRef,
    toggleCheckedPath,
  ])

  const handleToggleCheckedInteraction = useCallback(({
    file,
    index,
    shiftKey,
  }: {
    file: FileItem
    index: number
    shiftKey: boolean
  }) => {
    handleItemInteractionIntent(resolveGroupedProjectionItemInteraction({
      kind: 'toggle-checked',
      file,
      index,
      shiftKey,
    }))
  }, [handleItemInteractionIntent])

  const handleClickInteraction = useCallback(({
    file,
    index,
    shiftKey,
    toggleModifier,
  }: {
    file: FileItem
    index: number
    shiftKey: boolean
    toggleModifier: boolean
  }) => {
    handleItemInteractionIntent(resolveGroupedProjectionItemInteraction({
      kind: 'item-click',
      file,
      index,
      shiftKey,
      toggleModifier,
    }))
  }, [handleItemInteractionIntent])

  const handleDoubleClickInteraction = useCallback(({
    file,
    index,
  }: {
    file: FileItem
    index: number
  }) => {
    handleItemInteractionIntent(resolveGroupedProjectionItemInteraction({
      kind: 'item-double-click',
      file,
      index,
      canOpenFileInSecondaryTarget: Boolean(onFileDoubleClick),
    }))
  }, [handleItemInteractionIntent, onFileDoubleClick])

  return {
    handleToggleCheckedInteraction,
    handleClickInteraction,
    handleDoubleClickInteraction,
  }
}
