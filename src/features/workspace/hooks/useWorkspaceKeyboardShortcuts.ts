import { useEffect } from 'react'
import type { KeyboardShortcuts } from '@/config/shortcuts'
import type { FileItem } from '@/types'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const isTyping = isTypingTarget(event.target)

      if (matchesAnyShortcut(event, keyboardShortcuts.app.openDirectory)) {
        event.preventDefault()
        void selectDirectory()
        return
      }

      if (isTyping) return
      if (matchesAnyShortcut(event, keyboardShortcuts.app.undoDelete)) {
        event.preventDefault()
        void undoDelete()
        return
      }
      const matchedPreviewTagShortcut = getMatchingPreviewTagShortcut(event)

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.toggleVideoPlayPause)) {
        event.preventDefault()
        if (event.repeat) return
        toggleActivePreviewVideoPlayback()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.seekBackward)) {
        event.preventDefault()
        seekActivePreviewVideo('backward')
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.seekForward)) {
        event.preventDefault()
        seekActivePreviewVideo('forward')
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.cycleVideoPlaybackRate)) {
        event.preventDefault()
        if (event.repeat) return
        cycleVideoPlaybackRate()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveMediaPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.toggleAutoPlay)) {
        event.preventDefault()
        toggleAutoPlay()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveMediaPreview) {
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.togglePlaybackOrder)) {
          event.preventDefault()
          togglePlaybackOrder()
          return
        }
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.prev)) {
          event.preventDefault()
          if (previewFile) {
            navigateMediaFromModal('prev')
          } else {
            navigateMediaFromPane('prev')
          }
          return
        }
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.next)) {
          event.preventDefault()
          if (previewFile) {
            navigateMediaFromModal('next')
          } else {
            navigateMediaFromPane('next')
          }
          return
        }
      }

      if (matchesAnyShortcut(event, keyboardShortcuts.app.navigateUp) && currentPath) {
        event.preventDefault()
        void navigateUp()
        return
      }

      if (!matchedPreviewTagShortcut && matchesAnyShortcut(event, keyboardShortcuts.preview.close)) {
        if (previewFile) {
          event.preventDefault()
          closePreviewModal()
          return
        }
        if (showPreviewPane) {
          event.preventDefault()
          closePreviewPane()
        }
      }
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
