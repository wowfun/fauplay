import { useCallback, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'
import {
  type FileGridItemPrimaryIntent,
  type FileGridItemSecondaryIntent,
  resolveFileGridItemClickIntent,
  resolveFileGridItemDoubleClickIntent,
  resolveFileGridItemToggleIntent,
} from '@/features/explorer/lib/fileGridItemInteractionModel'
import type { FileItem } from '@/types'

interface UseFileGridItemInteractionHandlersParams {
  markSelectedElement: (index: number, path: string) => void
  applyRangeSelection: (index: number) => void
  selectionAnchorPathRef: MutableRefObject<string | null>
  pendingPreviewPathDuringRangeRef: MutableRefObject<string | null>
  setAnchorId: (path: string) => void
  toggleSelection: (path: string) => void
  shouldSuppressClick: () => boolean
  onDirectoryClick: (dirName: string) => void
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
}

export function useFileGridItemInteractionHandlers({
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
}: UseFileGridItemInteractionHandlersParams) {
  const applyPrimaryItemInteractionIntent = useCallback((
    intent: FileGridItemPrimaryIntent,
    file: FileItem,
  ) => {
    if (intent.kind === 'none') return

    markSelectedElement(intent.index, intent.path)

    if (intent.kind === 'range-select') {
      applyRangeSelection(intent.index)
      return
    }

    selectionAnchorPathRef.current = intent.path
    setAnchorId(intent.path)
    pendingPreviewPathDuringRangeRef.current = null

    switch (intent.kind) {
      case 'toggle-selection':
        toggleSelection(intent.path)
        return
      case 'open-directory':
        onDirectoryClick(intent.directoryName)
        return
      case 'open-file':
        if (file.kind === 'file') {
          onFileClick(file)
        }
        return
    }
  }, [
    applyRangeSelection,
    markSelectedElement,
    onDirectoryClick,
    onFileClick,
    pendingPreviewPathDuringRangeRef,
    selectionAnchorPathRef,
    setAnchorId,
    toggleSelection,
  ])

  const applySecondaryItemInteractionIntent = useCallback((
    intent: FileGridItemSecondaryIntent,
    file: FileItem,
  ) => {
    if (intent.kind !== 'open-file-secondary') return
    if (file.kind === 'file') {
      onFileDoubleClick?.(file)
    }
  }, [onFileDoubleClick])

  const handleItemToggleChecked = useCallback((
    file: FileItem,
    index: number,
    event: ReactMouseEvent<HTMLInputElement>,
  ) => {
    event.stopPropagation()
    applyPrimaryItemInteractionIntent(resolveFileGridItemToggleIntent({
      file,
      index,
      shiftKey: event.shiftKey,
    }), file)
  }, [applyPrimaryItemInteractionIntent])

  const handleItemClick = useCallback((
    file: FileItem,
    index: number,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    applyPrimaryItemInteractionIntent(resolveFileGridItemClickIntent({
      file,
      index,
      suppressClick: shouldSuppressClick(),
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    }), file)
  }, [applyPrimaryItemInteractionIntent, shouldSuppressClick])

  const handleItemDoubleClick = useCallback((file: FileItem) => {
    applySecondaryItemInteractionIntent(resolveFileGridItemDoubleClickIntent({
      file,
      suppressClick: shouldSuppressClick(),
      canOpenFile: Boolean(onFileDoubleClick),
    }), file)
  }, [applySecondaryItemInteractionIntent, onFileDoubleClick, shouldSuppressClick])

  return {
    handleItemToggleChecked,
    handleItemClick,
    handleItemDoubleClick,
  }
}
