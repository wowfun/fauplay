import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmptyKeyboardShortcuts,
  setShortcutActionBindings,
} from '../../src/config/shortcutActionCatalog.ts'
import { resolveWorkspaceKeyboardShortcutIntent } from '../../src/features/workspace/lib/workspaceKeyboardShortcutIntentModel.ts'

function shortcuts() {
  const keyboardShortcuts = createEmptyKeyboardShortcuts()
  setShortcutActionBindings(keyboardShortcuts, 'app_open_directory', [{ key: 'o', primary: true }])
  setShortcutActionBindings(keyboardShortcuts, 'app_navigate_up', [{ key: 'backspace' }])
  setShortcutActionBindings(keyboardShortcuts, 'app_undo_delete', [{ key: 'z', primary: true }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_toggle_autoplay', [{ key: 'p' }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_toggle_playback_order', [{ key: 't' }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_toggle_video_play_pause', [{ key: 'space' }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_seek_backward', [{ key: 'j' }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_seek_forward', [{ key: 'l' }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_cycle_video_playback_rate', [{ key: 'r' }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_prev', [{ key: '[' }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_next', [{ key: ']' }])
  setShortcutActionBindings(keyboardShortcuts, 'preview_close', [{ key: 'escape' }])
  return keyboardShortcuts
}

function keyEvent(key, overrides = {}) {
  return {
    key,
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    ...overrides,
  }
}

function resolve(overrides = {}) {
  return resolveWorkspaceKeyboardShortcutIntent({
    event: keyEvent('x'),
    keyboardShortcuts: shortcuts(),
    isTypingTarget: false,
    hasMatchingPreviewTagShortcut: false,
    hasActiveVideoPreview: false,
    hasActiveMediaPreview: false,
    previewFileOpen: false,
    currentPath: '',
    showPreviewPane: false,
    ...overrides,
  })
}

test('Workspace Keyboard Shortcut Intent Model keeps app open-directory available while typing', () => {
  assert.deepEqual(
    resolve({
      event: keyEvent('o', { ctrlKey: true }),
      isTypingTarget: true,
    }),
    { kind: 'select-directory' },
  )
})

test('Workspace Keyboard Shortcut Intent Model ignores non-directory shortcuts while typing', () => {
  assert.deepEqual(
    resolve({
      event: keyEvent('z', { ctrlKey: true }),
      isTypingTarget: true,
    }),
    { kind: 'none' },
  )
})

test('Workspace Keyboard Shortcut Intent Model resolves app undo outside typing targets', () => {
  assert.deepEqual(
    resolve({
      event: keyEvent('z', { ctrlKey: true }),
    }),
    { kind: 'undo-delete' },
  )
})

test('Workspace Keyboard Shortcut Intent Model resolves active video shortcuts with repeat guards', () => {
  assert.deepEqual(
    resolve({
      event: keyEvent(' ', { code: 'Space' }),
      hasActiveVideoPreview: true,
    }),
    { kind: 'toggle-video-playback' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent(' ', { code: 'Space', repeat: true }),
      hasActiveVideoPreview: true,
    }),
    { kind: 'none' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent('r'),
      hasActiveVideoPreview: true,
    }),
    { kind: 'cycle-video-playback-rate' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent('r', { repeat: true }),
      hasActiveVideoPreview: true,
    }),
    { kind: 'none' },
  )
})

test('Workspace Keyboard Shortcut Intent Model resolves seek and media playback intents', () => {
  assert.deepEqual(
    resolve({
      event: keyEvent('j'),
      hasActiveVideoPreview: true,
    }),
    { kind: 'seek-video', direction: 'backward' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent('l'),
      hasActiveVideoPreview: true,
    }),
    { kind: 'seek-video', direction: 'forward' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent('p'),
      hasActiveMediaPreview: true,
    }),
    { kind: 'toggle-auto-play' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent('t'),
      hasActiveMediaPreview: true,
    }),
    { kind: 'toggle-playback-order' },
  )
})

test('Workspace Keyboard Shortcut Intent Model routes media navigation to the open preview surface', () => {
  assert.deepEqual(
    resolve({
      event: keyEvent('['),
      hasActiveMediaPreview: true,
      previewFileOpen: true,
    }),
    { kind: 'navigate-preview-media', direction: 'prev', target: 'lightbox' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent(']'),
      hasActiveMediaPreview: true,
      previewFileOpen: false,
    }),
    { kind: 'navigate-preview-media', direction: 'next', target: 'pane' },
  )
})

test('Workspace Keyboard Shortcut Intent Model resolves app navigation and preview close intents', () => {
  assert.deepEqual(
    resolve({
      event: keyEvent('Backspace'),
      currentPath: 'albums',
    }),
    { kind: 'navigate-up' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent('Escape'),
      previewFileOpen: true,
    }),
    { kind: 'close-preview', target: 'lightbox' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent('Escape'),
      showPreviewPane: true,
    }),
    { kind: 'close-preview', target: 'pane' },
  )
})

test('Workspace Keyboard Shortcut Intent Model leaves preview shortcuts to matching tag shortcuts first', () => {
  assert.deepEqual(
    resolve({
      event: keyEvent(' ', { code: 'Space' }),
      hasMatchingPreviewTagShortcut: true,
      hasActiveVideoPreview: true,
    }),
    { kind: 'none' },
  )

  assert.deepEqual(
    resolve({
      event: keyEvent('Escape'),
      hasMatchingPreviewTagShortcut: true,
      previewFileOpen: true,
    }),
    { kind: 'none' },
  )
})
