import type { ShortcutBinding } from '@/lib/keyboard'

export const keyboardShortcuts = {
  global: {
    openDirectory: [
      { key: 'o', primary: true },
    ] satisfies ShortcutBinding[],
    toggleAutoPlay: [
      { key: 'p', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    toggleTraversalOrder: [
      { key: 'r', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    previewPrev: [
      { code: 'bracketleft', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    previewNext: [
      { code: 'bracketright', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    navigateUp: [
      { key: 'backspace' },
    ] satisfies ShortcutBinding[],
    closePreview: [
      { key: 'escape' },
    ] satisfies ShortcutBinding[],
  },
  grid: {
    moveRight: [
      { key: 'arrowright' },
      { key: 'd' },
    ] satisfies ShortcutBinding[],
    moveLeft: [
      { key: 'arrowleft' },
      { key: 'a' },
    ] satisfies ShortcutBinding[],
    moveDown: [
      { key: 'arrowdown' },
      { key: 's' },
    ] satisfies ShortcutBinding[],
    moveUp: [
      { key: 'arrowup' },
      { key: 'w' },
    ] satisfies ShortcutBinding[],
    pageDown: [
      { key: 'pagedown' },
    ] satisfies ShortcutBinding[],
    pageUp: [
      { key: 'pageup' },
    ] satisfies ShortcutBinding[],
    openSelected: [
      { key: 'enter' },
    ] satisfies ShortcutBinding[],
  },
  previewModal: {
    close: [
      { key: 'escape' },
    ] satisfies ShortcutBinding[],
    toggleVideoPlayback: [
      { key: 'space' },
    ] satisfies ShortcutBinding[],
  },
} as const
