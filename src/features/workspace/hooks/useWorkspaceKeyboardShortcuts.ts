import { useEffect } from 'react'
import type { KeyboardShortcuts } from '@/config/shortcuts'
import type { FileItem } from '@/types'
import { isTypingTarget } from '@/lib/keyboard'
import {
  resolveWorkspaceKeyboardShortcutIntent,
  type WorkspaceKeyboardShortcutIntent,
} from '@/features/workspace/lib/workspaceKeyboardShortcutIntentModel'

interface UseWorkspaceKeyboardShortcutsParams {
  keyboardShortcuts: KeyboardShortcuts
  selectDirectory: () => Promise<void>
  undoDelete: () => Promise<void>
  getMatchingPreviewTagShortcut: (event: KeyboardEvent) => unknown
  hasActiveVideoPreview: boolean
  hasActiveMediaPreview: boolean
  toggleActivePreviewVideoPlayback: () => boolean
  seekActivePreviewVideo: (direction: 'backward' | 'forward') => boolean
  cycleVideoPlaybackRate: () => void
  toggleAutoPlay: () => void
  togglePlaybackOrder: () => void
  previewFile: FileItem | null
  navigateMediaFromModal: (direction: 'prev' | 'next') => void
  navigateMediaFromPane: (direction: 'prev' | 'next') => void
  currentPath: string
  navigateUp: () => Promise<void>
  closePreviewModal: () => void
  showPreviewPane: boolean
  closePreviewPane: () => void
}

export function useWorkspaceKeyboardShortcuts({
  keyboardShortcuts,
  selectDirectory,
  undoDelete,
  getMatchingPreviewTagShortcut,
  hasActiveVideoPreview,
  hasActiveMediaPreview,
  toggleActivePreviewVideoPlayback,
  seekActivePreviewVideo,
  cycleVideoPlaybackRate,
  toggleAutoPlay,
  togglePlaybackOrder,
  previewFile,
  navigateMediaFromModal,
  navigateMediaFromPane,
  currentPath,
  navigateUp,
  closePreviewModal,
  showPreviewPane,
  closePreviewPane,
}: UseWorkspaceKeyboardShortcutsParams): void {
  useEffect(() => {
    const executeIntent = (intent: WorkspaceKeyboardShortcutIntent, event: KeyboardEvent) => {
      if (intent.kind === 'none') return

      event.preventDefault()
      if (intent.kind === 'select-directory') {
        void selectDirectory()
        return
      }
      if (intent.kind === 'undo-delete') {
        void undoDelete()
        return
      }
      if (intent.kind === 'toggle-video-playback') {
        toggleActivePreviewVideoPlayback()
        return
      }
      if (intent.kind === 'seek-video') {
        seekActivePreviewVideo(intent.direction)
        return
      }
      if (intent.kind === 'cycle-video-playback-rate') {
        cycleVideoPlaybackRate()
        return
      }
      if (intent.kind === 'toggle-auto-play') {
        toggleAutoPlay()
        return
      }
      if (intent.kind === 'toggle-playback-order') {
        togglePlaybackOrder()
        return
      }
      if (intent.kind === 'navigate-preview-media') {
        if (intent.target === 'lightbox') {
          navigateMediaFromModal(intent.direction)
        } else {
          navigateMediaFromPane(intent.direction)
        }
        return
      }
      if (intent.kind === 'navigate-up') {
        void navigateUp()
        return
      }
      if (intent.kind === 'close-preview') {
        if (intent.target === 'lightbox') {
          closePreviewModal()
        } else {
          closePreviewPane()
        }
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isTyping = isTypingTarget(event.target)
      const hasMatchingPreviewTagShortcut = !isTyping && Boolean(getMatchingPreviewTagShortcut(event))

      executeIntent(resolveWorkspaceKeyboardShortcutIntent({
        event,
        keyboardShortcuts,
        isTypingTarget: isTyping,
        hasMatchingPreviewTagShortcut,
        hasActiveVideoPreview,
        hasActiveMediaPreview,
        previewFileOpen: Boolean(previewFile),
        currentPath,
        showPreviewPane,
      }), event)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    keyboardShortcuts,
    closePreviewModal,
    closePreviewPane,
    hasActiveMediaPreview,
    hasActiveVideoPreview,
    undoDelete,
    currentPath,
    getMatchingPreviewTagShortcut,
    navigateMediaFromModal,
    navigateMediaFromPane,
    navigateUp,
    previewFile,
    seekActivePreviewVideo,
    selectDirectory,
    showPreviewPane,
    cycleVideoPlaybackRate,
    toggleActivePreviewVideoPlayback,
    toggleAutoPlay,
    togglePlaybackOrder,
  ])
}
