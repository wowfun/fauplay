import type { KeyboardShortcuts } from '../../../config/shortcutActionCatalog.ts'
import { matchesAnyShortcut } from '../../../lib/keyboard.ts'

export interface WorkspaceKeyboardShortcutEvent {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
  defaultPrevented: boolean
}

export type WorkspaceKeyboardShortcutIntent =
  | { kind: 'none' }
  | { kind: 'select-directory' }
  | { kind: 'undo-delete' }
  | { kind: 'toggle-video-playback' }
  | { kind: 'seek-video'; direction: 'backward' | 'forward' }
  | { kind: 'cycle-video-playback-rate' }
  | { kind: 'toggle-auto-play' }
  | { kind: 'toggle-playback-order' }
  | { kind: 'navigate-preview-media'; direction: 'prev' | 'next'; target: 'lightbox' | 'pane' }
  | { kind: 'navigate-up' }
  | { kind: 'close-preview'; target: 'lightbox' | 'pane' }

export interface ResolveWorkspaceKeyboardShortcutIntentParams {
  event: WorkspaceKeyboardShortcutEvent
  keyboardShortcuts: KeyboardShortcuts
  isTypingTarget: boolean
  hasMatchingPreviewTagShortcut: boolean
  hasActiveVideoPreview: boolean
  hasActiveMediaPreview: boolean
  previewFileOpen: boolean
  currentPath: string
  showPreviewPane: boolean
}

export function resolveWorkspaceKeyboardShortcutIntent({
  event,
  keyboardShortcuts,
  isTypingTarget,
  hasMatchingPreviewTagShortcut,
  hasActiveVideoPreview,
  hasActiveMediaPreview,
  previewFileOpen,
  currentPath,
  showPreviewPane,
}: ResolveWorkspaceKeyboardShortcutIntentParams): WorkspaceKeyboardShortcutIntent {
  if (event.defaultPrevented) return { kind: 'none' }

  if (matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.app.openDirectory)) {
    return { kind: 'select-directory' }
  }

  if (isTypingTarget) return { kind: 'none' }

  if (matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.app.undoDelete)) {
    return { kind: 'undo-delete' }
  }

  if (
    !hasMatchingPreviewTagShortcut
    && hasActiveVideoPreview
    && matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.toggleVideoPlayPause)
  ) {
    if (event.repeat) return { kind: 'none' }
    return { kind: 'toggle-video-playback' }
  }

  if (
    !hasMatchingPreviewTagShortcut
    && hasActiveVideoPreview
    && matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.seekBackward)
  ) {
    return { kind: 'seek-video', direction: 'backward' }
  }

  if (
    !hasMatchingPreviewTagShortcut
    && hasActiveVideoPreview
    && matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.seekForward)
  ) {
    return { kind: 'seek-video', direction: 'forward' }
  }

  if (
    !hasMatchingPreviewTagShortcut
    && hasActiveVideoPreview
    && matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.cycleVideoPlaybackRate)
  ) {
    if (event.repeat) return { kind: 'none' }
    return { kind: 'cycle-video-playback-rate' }
  }

  if (
    !hasMatchingPreviewTagShortcut
    && hasActiveMediaPreview
    && matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.toggleAutoPlay)
  ) {
    return { kind: 'toggle-auto-play' }
  }

  if (!hasMatchingPreviewTagShortcut && hasActiveMediaPreview) {
    if (matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.togglePlaybackOrder)) {
      return { kind: 'toggle-playback-order' }
    }
    if (matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.prev)) {
      return {
        kind: 'navigate-preview-media',
        direction: 'prev',
        target: previewFileOpen ? 'lightbox' : 'pane',
      }
    }
    if (matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.next)) {
      return {
        kind: 'navigate-preview-media',
        direction: 'next',
        target: previewFileOpen ? 'lightbox' : 'pane',
      }
    }
  }

  if (currentPath && matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.app.navigateUp)) {
    return { kind: 'navigate-up' }
  }

  if (!hasMatchingPreviewTagShortcut && matchesAnyShortcut(event as KeyboardEvent, keyboardShortcuts.preview.close)) {
    if (previewFileOpen) return { kind: 'close-preview', target: 'lightbox' }
    if (showPreviewPane) return { kind: 'close-preview', target: 'pane' }
  }

  return { kind: 'none' }
}
