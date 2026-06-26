import type { FileItem } from '../../../types/index.ts'
import type { PlaybackOrder } from '../types/playback.ts'
import {
  getPreviewMediaIndex,
  type PreviewMediaCollection,
} from './previewMediaCollectionModel.ts'
import {
  shufflePreviewPaths,
  type PreviewShuffleState,
} from './previewShufflePlaybackModel.ts'

export {
  buildPreviewMediaCollection,
  canNavigatePreviewMedia,
  getPreviewMediaIndex,
} from './previewMediaCollectionModel.ts'
export type {
  PreviewMediaCollection,
} from './previewMediaCollectionModel.ts'
export {
  createInitialPreviewShuffleState,
  resolvePreviewPlaybackOrderTogglePlan,
  resolvePreviewShuffleMediaSetSyncPlan,
  shufflePreviewPaths,
} from './previewShufflePlaybackModel.ts'
export type {
  PreviewPlaybackOrderTogglePlan,
  PreviewPlaybackOrderToggleSelection,
  PreviewShuffleMediaSetSyncPlan,
  PreviewShuffleState,
  ResolvePreviewPlaybackOrderTogglePlanParams,
  ResolvePreviewShuffleMediaSetSyncPlanParams,
} from './previewShufflePlaybackModel.ts'

export const DEFAULT_AUTOPLAY_INTERVAL_SEC = 3
export const MIN_AUTOPLAY_INTERVAL_SEC = 1
export const MAX_AUTOPLAY_INTERVAL_SEC = 10
export const VIDEO_SEEK_STEP_OPTIONS = [3, 5, 10] as const
export const DEFAULT_VIDEO_SEEK_STEP_SEC = 5
export const VIDEO_PLAYBACK_RATE_OPTIONS = [0.5, 1, 3, 5] as const
export const VIDEO_PLAYBACK_RATE_CYCLE_ORDER = [1, 3, 5, 0.5] as const
export const DEFAULT_VIDEO_PLAYBACK_RATE = 1
export const DEFAULT_FACE_BBOX_VISIBLE = false

export type PreviewNavigateDirection = 'prev' | 'next'

export interface ResolvePreviewMediaNavigationParams {
  collection: PreviewMediaCollection
  currentFile: FileItem | null
  direction: PreviewNavigateDirection
  playbackOrder: PlaybackOrder
  wrap: boolean
  shuffleState?: PreviewShuffleState
  shufflePaths?: (paths: string[]) => string[]
}

export interface PreviewMediaNavigationPlan {
  nextFile: FileItem
  shuffleState: PreviewShuffleState | null
}

export interface ResolvePreviewFilteredFilesChangePlanParams {
  files: FileItem[]
  collection: PreviewMediaCollection
  preferredPreviewPath: string | null
  selectedFile: FileItem | null
  previewFile: FileItem | null
  showPreviewPane: boolean
  playbackOrder: PlaybackOrder
  shuffleState: PreviewShuffleState
}

export interface PreviewFileSelectionPlan {
  selectedFile: FileItem | null
  previewFile: FileItem | null
  showPreviewPane: boolean
}

export type PreviewFilteredFilesChangePlan =
  | { kind: 'none' }
  | {
    kind: 'apply-selection'
    clearPreferredPreviewPath: boolean
    selection: PreviewFileSelectionPlan
    shuffleState?: PreviewShuffleState
  }

export function resolvePreviewMediaNavigation({
  collection,
  currentFile,
  direction,
  playbackOrder,
  wrap,
  shuffleState,
  shufflePaths = shufflePreviewPaths,
}: ResolvePreviewMediaNavigationParams): PreviewMediaNavigationPlan | null {
  const currentIndex = getPreviewMediaIndex(collection, currentFile)
  if (currentIndex < 0 || !currentFile || currentFile.kind !== 'file') return null
  const currentPath = currentFile.path

  if (playbackOrder === 'shuffle') {
    return resolveShufflePreviewMediaNavigation({
      collection,
      currentPath,
      direction,
      shuffleState: shuffleState ?? { queue: [], history: [] },
      shufflePaths,
    })
  }

  let targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1
  if (wrap) {
    if (targetIndex < 0) {
      targetIndex = collection.mediaFiles.length - 1
    } else if (targetIndex >= collection.mediaFiles.length) {
      targetIndex = 0
    }
  } else if (targetIndex < 0 || targetIndex >= collection.mediaFiles.length) {
    return null
  }

  const nextFile = collection.mediaFiles[targetIndex]
  if (!nextFile || nextFile.path === currentPath) return null
  return {
    nextFile,
    shuffleState: null,
  }
}

export function resolvePreviewFilteredFilesChangePlan({
  files,
  collection,
  preferredPreviewPath,
  selectedFile,
  previewFile,
  showPreviewPane,
  playbackOrder,
  shuffleState,
}: ResolvePreviewFilteredFilesChangePlanParams): PreviewFilteredFilesChangePlan {
  if (files.length === 0) {
    return {
      kind: 'apply-selection',
      clearPreferredPreviewPath: true,
      selection: {
        selectedFile: null,
        previewFile: null,
        showPreviewPane: false,
      },
    }
  }

  if (preferredPreviewPath) {
    const preferredFile = findPreviewFileByPath(files, preferredPreviewPath)
    if (preferredFile) {
      return {
        kind: 'apply-selection',
        clearPreferredPreviewPath: true,
        selection: {
          selectedFile: preferredFile,
          previewFile: previewFile ? preferredFile : null,
          showPreviewPane,
        },
      }
    }
  }

  if (!selectedFile) return { kind: 'none' }
  const selectedFileStillExists = files.some((file) => file.path === selectedFile.path)
  if (selectedFileStillExists) return { kind: 'none' }

  if (playbackOrder === 'shuffle' && selectedFile.kind === 'file') {
    const nextShufflePath = shuffleState.queue.find((path) => collection.mediaIndexByPath.has(path))
    const nextShuffleFile = nextShufflePath ? collection.mediaFileByPath.get(nextShufflePath) ?? null : null
    if (nextShuffleFile) {
      return {
        kind: 'apply-selection',
        clearPreferredPreviewPath: false,
        selection: createPreviewSelectionPlan({
          nextFile: nextShuffleFile,
          previewFile,
          showPreviewPane,
        }),
        shuffleState: {
          queue: shuffleState.queue.filter((path) => (
            collection.mediaIndexByPath.has(path) && path !== nextShuffleFile.path
          )),
          history: appendPreviewShuffleHistory(
            shuffleState.history.filter((path) => collection.mediaIndexByPath.has(path)),
            nextShuffleFile.path
          ),
        },
      }
    }
  }

  const fallbackFile = files.find((file): file is FileItem => file.kind === 'file') ?? null
  if (fallbackFile) {
    return {
      kind: 'apply-selection',
      clearPreferredPreviewPath: false,
      selection: createPreviewSelectionPlan({
        nextFile: fallbackFile,
        previewFile,
        showPreviewPane,
      }),
    }
  }

  return {
    kind: 'apply-selection',
    clearPreferredPreviewPath: false,
    selection: {
      selectedFile: files[0],
      previewFile: null,
      showPreviewPane: false,
    },
  }
}

export function clampAutoPlayIntervalSec(value: number): number {
  return Math.min(
    MAX_AUTOPLAY_INTERVAL_SEC,
    Math.max(MIN_AUTOPLAY_INTERVAL_SEC, value)
  )
}

export function normalizeVideoSeekStepSec(value: number): number {
  return VIDEO_SEEK_STEP_OPTIONS.includes(value as (typeof VIDEO_SEEK_STEP_OPTIONS)[number])
    ? value
    : DEFAULT_VIDEO_SEEK_STEP_SEC
}

export function normalizeVideoPlaybackRate(value: number): number {
  return VIDEO_PLAYBACK_RATE_OPTIONS.includes(value as (typeof VIDEO_PLAYBACK_RATE_OPTIONS)[number])
    ? value
    : DEFAULT_VIDEO_PLAYBACK_RATE
}

export function nextVideoPlaybackRate(value: number): number {
  const normalized = normalizeVideoPlaybackRate(value)
  const currentIndex = VIDEO_PLAYBACK_RATE_CYCLE_ORDER.indexOf(
    normalized as (typeof VIDEO_PLAYBACK_RATE_CYCLE_ORDER)[number]
  )
  if (currentIndex < 0) return DEFAULT_VIDEO_PLAYBACK_RATE
  return VIDEO_PLAYBACK_RATE_CYCLE_ORDER[
    (currentIndex + 1) % VIDEO_PLAYBACK_RATE_CYCLE_ORDER.length
  ]
}

export function normalizePreviewPath(path: string | null): string | null {
  const normalizedPath = (path || '').split('/').filter(Boolean).join('/')
  return normalizedPath || null
}

function resolveShufflePreviewMediaNavigation({
  collection,
  currentPath,
  direction,
  shuffleState,
  shufflePaths,
}: {
  collection: PreviewMediaCollection
  currentPath: string
  direction: PreviewNavigateDirection
  shuffleState: PreviewShuffleState
  shufflePaths: (paths: string[]) => string[]
}): PreviewMediaNavigationPlan | null {
  if (direction === 'prev') {
    const historyTail = shuffleState.history[shuffleState.history.length - 1]
    if (historyTail !== currentPath || shuffleState.history.length <= 1) return null

    const previousPath = shuffleState.history[shuffleState.history.length - 2]
    const previousFile = collection.mediaFileByPath.get(previousPath)
    if (!previousFile) return null

    return {
      nextFile: previousFile,
      shuffleState: {
        history: shuffleState.history.slice(0, -1),
        queue: [
          currentPath,
          ...shuffleState.queue.filter((path) => path !== currentPath),
        ],
      },
    }
  }

  let nextQueue = shuffleState.queue.filter((path) => path !== currentPath)
  if (nextQueue.length === 0) {
    nextQueue = shufflePaths(collection.mediaFiles
      .map((file) => file.path)
      .filter((path) => path !== currentPath))
  }

  const nextPath = nextQueue[0]
  if (!nextPath) return null

  const nextFile = collection.mediaFileByPath.get(nextPath)
  if (!nextFile) return null

  return {
    nextFile,
    shuffleState: {
      queue: nextQueue.slice(1),
      history: shuffleState.history.length > 0
        && shuffleState.history[shuffleState.history.length - 1] === currentPath
        ? [...shuffleState.history, nextPath]
        : [currentPath, nextPath],
    },
  }
}

function findPreviewFileByPath(files: FileItem[], path: string): FileItem | null {
  return files.find((file): file is FileItem => file.kind === 'file' && file.path === path) ?? null
}

function createPreviewSelectionPlan({
  nextFile,
  previewFile,
  showPreviewPane,
}: {
  nextFile: FileItem
  previewFile: FileItem | null
  showPreviewPane: boolean
}): PreviewFileSelectionPlan {
  return {
    selectedFile: nextFile,
    previewFile: previewFile ? nextFile : null,
    showPreviewPane,
  }
}

function appendPreviewShuffleHistory(history: string[], nextPath: string): string[] {
  if (history[history.length - 1] === nextPath) return history
  return [...history, nextPath]
}
