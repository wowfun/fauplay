import type { PlaybackOrder } from '../types/playback.ts'
import {
  DEFAULT_FACE_BBOX_VISIBLE,
  DEFAULT_VIDEO_PLAYBACK_RATE,
  DEFAULT_VIDEO_SEEK_STEP_SEC,
  normalizeVideoPlaybackRate,
  normalizeVideoSeekStepSec,
} from './previewTraversalModel.ts'

export interface PreviewPlaybackPreferencesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PreviewPlaybackPreferences {
  videoSeekStepSec: number
  videoPlaybackRate: number
  playbackOrder: PlaybackOrder
  faceBboxVisible: boolean
}

export const PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS = {
  videoSeekStepSec: 'fauplay:preview-video-seek-step-sec',
  videoPlaybackRate: 'fauplay:preview-video-playback-rate',
  playbackOrder: 'fauplay:preview-playback-order',
  faceBboxVisible: 'fauplay:preview-face-bbox-visible',
} as const

const DEFAULT_PREVIEW_PLAYBACK_PREFERENCES: PreviewPlaybackPreferences = {
  videoSeekStepSec: DEFAULT_VIDEO_SEEK_STEP_SEC,
  videoPlaybackRate: DEFAULT_VIDEO_PLAYBACK_RATE,
  playbackOrder: 'sequential',
  faceBboxVisible: DEFAULT_FACE_BBOX_VISIBLE,
}

function readStorageItem(
  storage: PreviewPlaybackPreferencesStorage | null | undefined,
  key: string,
): string | null {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function writeStorageItem(
  storage: PreviewPlaybackPreferencesStorage | null | undefined,
  key: string,
  value: string,
): void {
  if (!storage) return
  try {
    storage.setItem(key, value)
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

function readStoredNumber(
  storage: PreviewPlaybackPreferencesStorage | null | undefined,
  key: string,
): number | null {
  const raw = readStorageItem(storage, key)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function readStoredPlaybackOrder(
  storage: PreviewPlaybackPreferencesStorage | null | undefined,
): PlaybackOrder {
  const raw = readStorageItem(storage, PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.playbackOrder)
  return raw === 'shuffle' || raw === 'sequential'
    ? raw
    : DEFAULT_PREVIEW_PLAYBACK_PREFERENCES.playbackOrder
}

function readStoredFaceBboxVisible(
  storage: PreviewPlaybackPreferencesStorage | null | undefined,
): boolean {
  const raw = readStorageItem(storage, PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.faceBboxVisible)
  if (raw === null) return DEFAULT_PREVIEW_PLAYBACK_PREFERENCES.faceBboxVisible
  if (raw === 'true') return true
  if (raw === 'false') return false

  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'boolean'
      ? parsed
      : DEFAULT_PREVIEW_PLAYBACK_PREFERENCES.faceBboxVisible
  } catch {
    return DEFAULT_PREVIEW_PLAYBACK_PREFERENCES.faceBboxVisible
  }
}

export function readPreviewPlaybackPreferences(
  storage: PreviewPlaybackPreferencesStorage | null | undefined,
): PreviewPlaybackPreferences {
  return {
    videoSeekStepSec: normalizeVideoSeekStepSec(
      readStoredNumber(storage, PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoSeekStepSec)
        ?? DEFAULT_PREVIEW_PLAYBACK_PREFERENCES.videoSeekStepSec
    ),
    videoPlaybackRate: normalizeVideoPlaybackRate(
      readStoredNumber(storage, PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoPlaybackRate)
        ?? DEFAULT_PREVIEW_PLAYBACK_PREFERENCES.videoPlaybackRate
    ),
    playbackOrder: readStoredPlaybackOrder(storage),
    faceBboxVisible: readStoredFaceBboxVisible(storage),
  }
}

export function savePreviewPlaybackPreferences(
  storage: PreviewPlaybackPreferencesStorage | null | undefined,
  preferences: PreviewPlaybackPreferences,
): void {
  writeStorageItem(
    storage,
    PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoSeekStepSec,
    String(normalizeVideoSeekStepSec(preferences.videoSeekStepSec)),
  )
  writeStorageItem(
    storage,
    PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.videoPlaybackRate,
    String(normalizeVideoPlaybackRate(preferences.videoPlaybackRate)),
  )
  writeStorageItem(
    storage,
    PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.playbackOrder,
    preferences.playbackOrder === 'shuffle' ? 'shuffle' : 'sequential',
  )
  writeStorageItem(
    storage,
    PREVIEW_PLAYBACK_PREFERENCE_STORAGE_KEYS.faceBboxVisible,
    preferences.faceBboxVisible ? 'true' : 'false',
  )
}
