import type { FileItem } from '../../../types/index.ts'
import type { PlaybackOrder } from '../types/playback.ts'
import type { PreviewMediaCollection } from './previewMediaCollectionModel.ts'

export interface PreviewShuffleState {
  queue: string[]
  history: string[]
}

export interface ResolvePreviewPlaybackOrderTogglePlanParams {
  collection: PreviewMediaCollection
  currentPlaybackOrder: PlaybackOrder
  activeMediaFile: FileItem | null
  isPreviewModalOpen: boolean
  shufflePaths?: (paths: string[]) => string[]
}

export interface PreviewPlaybackOrderToggleSelection {
  selectedFile: FileItem
  previewFile: FileItem | null
  showPreviewPane: true
}

export interface PreviewPlaybackOrderTogglePlan {
  playbackOrder: PlaybackOrder
  shuffleState: PreviewShuffleState
  lastShuffleMediaSetKey: string | null
  selection: PreviewPlaybackOrderToggleSelection | null
}

export interface ResolvePreviewShuffleMediaSetSyncPlanParams {
  collection: PreviewMediaCollection
  playbackOrder: PlaybackOrder
  activeMediaFile: FileItem | null
  hasOpenPreview: boolean
  shuffleState: PreviewShuffleState
  lastShuffleMediaSetKey: string | null
  shufflePaths?: (paths: string[]) => string[]
}

export type PreviewShuffleMediaSetSyncPlan =
  | { kind: 'none' }
  | { kind: 'clear-last-shuffle-media-set'; lastShuffleMediaSetKey: null }
  | { kind: 'clear-shuffle-state'; shuffleState: PreviewShuffleState; lastShuffleMediaSetKey: string }
  | { kind: 'repair-shuffle-state'; shuffleState: PreviewShuffleState; lastShuffleMediaSetKey: string }
  | { kind: 'mark-current-media-set'; lastShuffleMediaSetKey: string }

export function shufflePreviewPaths(paths: string[]): string[] {
  const result = [...paths]
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = current
  }
  return result
}

export function createInitialPreviewShuffleState(
  collection: PreviewMediaCollection,
  currentPath: string,
  shufflePaths: (paths: string[]) => string[] = shufflePreviewPaths
): PreviewShuffleState {
  return {
    queue: shufflePaths(collection.mediaFiles
      .map((file) => file.path)
      .filter((path) => path !== currentPath)),
    history: [currentPath],
  }
}

export function resolvePreviewPlaybackOrderTogglePlan({
  collection,
  currentPlaybackOrder,
  activeMediaFile,
  isPreviewModalOpen,
  shufflePaths = shufflePreviewPaths,
}: ResolvePreviewPlaybackOrderTogglePlanParams): PreviewPlaybackOrderTogglePlan {
  const nextPlaybackOrder = currentPlaybackOrder === 'sequential' ? 'shuffle' : 'sequential'
  if (nextPlaybackOrder === 'sequential') {
    return {
      playbackOrder: nextPlaybackOrder,
      shuffleState: { queue: [], history: [] },
      lastShuffleMediaSetKey: null,
      selection: null,
    }
  }

  const anchorPath =
    activeMediaFile?.kind === 'file' && collection.mediaIndexByPath.has(activeMediaFile.path)
      ? activeMediaFile.path
      : null
  if (anchorPath) {
    return {
      playbackOrder: nextPlaybackOrder,
      shuffleState: createInitialPreviewShuffleState(collection, anchorPath, shufflePaths),
      lastShuffleMediaSetKey: collection.mediaSetKey,
      selection: null,
    }
  }

  const fallbackFile = collection.mediaFiles[0] ?? null
  if (!fallbackFile) {
    return {
      playbackOrder: nextPlaybackOrder,
      shuffleState: { queue: [], history: [] },
      lastShuffleMediaSetKey: null,
      selection: null,
    }
  }

  return {
    playbackOrder: nextPlaybackOrder,
    shuffleState: createInitialPreviewShuffleState(collection, fallbackFile.path, shufflePaths),
    lastShuffleMediaSetKey: collection.mediaSetKey,
    selection: {
      selectedFile: fallbackFile,
      previewFile: isPreviewModalOpen ? fallbackFile : null,
      showPreviewPane: true,
    },
  }
}

export function resolvePreviewShuffleMediaSetSyncPlan({
  collection,
  playbackOrder,
  activeMediaFile,
  hasOpenPreview,
  shuffleState,
  lastShuffleMediaSetKey,
  shufflePaths = shufflePreviewPaths,
}: ResolvePreviewShuffleMediaSetSyncPlanParams): PreviewShuffleMediaSetSyncPlan {
  if (playbackOrder !== 'shuffle') {
    if (lastShuffleMediaSetKey === null) return { kind: 'none' }
    return { kind: 'clear-last-shuffle-media-set', lastShuffleMediaSetKey: null }
  }

  if (collection.mediaFiles.length === 0) {
    if (
      shuffleState.queue.length === 0
      && shuffleState.history.length === 0
      && lastShuffleMediaSetKey === collection.mediaSetKey
    ) {
      return { kind: 'none' }
    }

    return {
      kind: 'clear-shuffle-state',
      shuffleState: { queue: [], history: [] },
      lastShuffleMediaSetKey: collection.mediaSetKey,
    }
  }

  if (!hasOpenPreview) return { kind: 'none' }

  const activePath =
    activeMediaFile?.kind === 'file' && collection.mediaIndexByPath.has(activeMediaFile.path)
      ? activeMediaFile.path
      : null
  if (!activePath) return { kind: 'none' }

  const hasInvalidQueueEntry = shuffleState.queue.some((path) => !collection.mediaIndexByPath.has(path))
  const hasInvalidHistoryEntry = shuffleState.history.some((path) => !collection.mediaIndexByPath.has(path))
  const tailPath = shuffleState.history[shuffleState.history.length - 1]
  const hasMediaSetChanged = lastShuffleMediaSetKey !== collection.mediaSetKey

  if (hasMediaSetChanged || hasInvalidQueueEntry || hasInvalidHistoryEntry || tailPath !== activePath) {
    return {
      kind: 'repair-shuffle-state',
      shuffleState: createInitialPreviewShuffleState(collection, activePath, shufflePaths),
      lastShuffleMediaSetKey: collection.mediaSetKey,
    }
  }

  return {
    kind: 'mark-current-media-set',
    lastShuffleMediaSetKey: collection.mediaSetKey,
  }
}
