import { useEffect, useSyncExternalStore } from 'react'
import {
  defaultConfiguredPreviewTagShortcuts,
  defaultShortcutConfigLayer,
  defaultShortcutConfigWarnings,
  detectShortcutConflictWarnings,
  resolveConfiguredPreviewTagShortcuts,
  resolveKeyboardShortcuts,
  type ConfiguredPreviewTagShortcut,
  parseShortcutConfigLayer,
  type KeyboardShortcuts,
  type ParsedShortcutConfigLayer,
} from '@/config/shortcuts'
import { loadGlobalShortcutConfig } from '@/lib/gateway'

const ROOT_SHORTCUTS_DIRECTORY = '.fauplay'
const ROOT_SHORTCUTS_FILENAME = 'shortcuts.json'
const ROOT_SHORTCUTS_SOURCE_LABEL = '<root>/.fauplay/shortcuts.json'

type ShortcutStoreListener = () => void

const listeners = new Set<ShortcutStoreListener>()
const emittedWarnings = new Set<string>()

let keyboardShortcutsSnapshot = resolveKeyboardShortcuts([defaultShortcutConfigLayer])
let previewTagShortcutsSnapshot = defaultConfiguredPreviewTagShortcuts
let globalShortcutLayer: ParsedShortcutConfigLayer | null = null
let rootShortcutLayer: ParsedShortcutConfigLayer | null = null
let activeRootHandle: FileSystemDirectoryHandle | null = null
let activeRootId: string | null = null
let contextVersion = 0
let globalLoadState: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
let globalLoadPromise: Promise<void> | null = null

function emitWarnings(warnings: readonly string[]) {
  for (const warning of warnings) {
    if (!warning || emittedWarnings.has(warning)) continue
    emittedWarnings.add(warning)
    console.warn(`[shortcuts] ${warning}`)
  }
}

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

function rebuildShortcutSnapshot() {
  const layers: ParsedShortcutConfigLayer[] = [defaultShortcutConfigLayer]
  if (globalShortcutLayer) {
    layers.push(globalShortcutLayer)
  }
  if (rootShortcutLayer) {
    layers.push(rootShortcutLayer)
  }

  keyboardShortcutsSnapshot = resolveKeyboardShortcuts(layers)
  previewTagShortcutsSnapshot = resolveConfiguredPreviewTagShortcuts(layers)
  emitWarnings(detectShortcutConflictWarnings(keyboardShortcutsSnapshot))
  notifyListeners()
}

function subscribe(listener: ShortcutStoreListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): KeyboardShortcuts {
  return keyboardShortcutsSnapshot
}

function getPreviewTagShortcutSnapshot(): ConfiguredPreviewTagShortcut[] {
  return previewTagShortcutsSnapshot
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return 'unknown error'
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'NotFoundError'
  }
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError')
}

async function readRootShortcutConfig(rootHandle: FileSystemDirectoryHandle): Promise<unknown | null> {
  try {
    const configDirectory = await rootHandle.getDirectoryHandle(ROOT_SHORTCUTS_DIRECTORY)
    const fileHandle = await configDirectory.getFileHandle(ROOT_SHORTCUTS_FILENAME)
    const file = await fileHandle.getFile()
    return JSON.parse(await file.text()) as unknown
  } catch (error) {
    if (isNotFoundError(error)) {
      return null
    }
    throw error
  }
}

async function loadRootShortcutLayer(rootHandle: FileSystemDirectoryHandle, requestVersion: number) {
  try {
    const rawConfig = await readRootShortcutConfig(rootHandle)
    if (requestVersion !== contextVersion) return

    if (rawConfig === null) {
      rootShortcutLayer = null
      rebuildShortcutSnapshot()
      return
    }

    const parsedLayer = parseShortcutConfigLayer(rawConfig, ROOT_SHORTCUTS_SOURCE_LABEL)
    emitWarnings(parsedLayer.warnings)
    rootShortcutLayer = parsedLayer
  } catch (error) {
    if (requestVersion !== contextVersion) return
    emitWarnings([`${ROOT_SHORTCUTS_SOURCE_LABEL}: ${toErrorMessage(error)}`])
    rootShortcutLayer = null
  }

  rebuildShortcutSnapshot()
}

async function ensureGlobalShortcutLayerLoaded() {
  if (globalLoadState === 'ready' || globalLoadState === 'loading') {
    return globalLoadPromise ?? Promise.resolve()
  }

  globalLoadState = 'loading'
  globalLoadPromise = (async () => {
    try {
      const result = await loadGlobalShortcutConfig()
      if (!result.loaded || result.config === null) {
        globalShortcutLayer = null
      } else {
        const parsedLayer = parseShortcutConfigLayer(result.config, result.path)
        emitWarnings(parsedLayer.warnings)
        globalShortcutLayer = parsedLayer
      }
      globalLoadState = 'ready'
    } catch (error) {
      globalLoadState = 'error'
      globalShortcutLayer = null
      emitWarnings([`~/.fauplay/global/shortcuts.json: ${toErrorMessage(error)}`])
    } finally {
      globalLoadPromise = null
      rebuildShortcutSnapshot()
    }
  })()

  return globalLoadPromise
}

export function setKeyboardShortcutsContext(
  rootHandle: FileSystemDirectoryHandle | null,
  rootId?: string | null
) {
  const nextRootId = rootId ?? null
  const hasSameContext = activeRootHandle === rootHandle && activeRootId === nextRootId

  activeRootHandle = rootHandle
  activeRootId = nextRootId

  if (!hasSameContext) {
    contextVersion += 1
    rootShortcutLayer = null
    rebuildShortcutSnapshot()
    if (rootHandle) {
      void loadRootShortcutLayer(rootHandle, contextVersion)
    }
  }

  if (globalLoadState === 'idle' || globalLoadState === 'error') {
    void ensureGlobalShortcutLayerLoaded()
  }
}

export function useKeyboardShortcutsRuntime(
  rootHandle: FileSystemDirectoryHandle | null,
  rootId?: string | null
) {
  useEffect(() => {
    setKeyboardShortcutsContext(rootHandle, rootId ?? null)
  }, [rootHandle, rootId])
}

export function useKeyboardShortcuts(): KeyboardShortcuts {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function usePreviewTagShortcuts(): ConfiguredPreviewTagShortcut[] {
  return useSyncExternalStore(subscribe, getPreviewTagShortcutSnapshot, getPreviewTagShortcutSnapshot)
}

emitWarnings(defaultShortcutConfigWarnings)
emitWarnings(detectShortcutConflictWarnings(keyboardShortcutsSnapshot))
