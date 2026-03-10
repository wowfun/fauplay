import type { ShortcutBinding } from '@/lib/keyboard'

export const keyboardShortcuts = {
  app: {
    openDirectory: [
      { key: 'o', primary: true },
    ] satisfies ShortcutBinding[],
    navigateUp: [
      { key: 'backspace' },
    ] satisfies ShortcutBinding[],
  },
  preview: {
    toggleAutoPlay: [
      { key: 'p', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    togglePlaybackOrder: [
      { key: 't', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    softDelete: [
      { key: 'delete', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    prev: [
      { code: 'bracketleft', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    next: [
      { code: 'bracketright', ctrl: false, meta: false, alt: false },
    ] satisfies ShortcutBinding[],
    close: [
      { key: 'escape' },
    ] satisfies ShortcutBinding[],
  },
  grid: {
    selectAll: [
      { key: 'a', primary: true },
    ] satisfies ShortcutBinding[],
    clearSelection: [
      { key: 'escape' },
    ] satisfies ShortcutBinding[],
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
} as const
