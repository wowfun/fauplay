import { getFilePreviewKind } from '../../../lib/filePreview.ts'
import type { FileItem } from '../../../types/index.ts'

export interface ResolvePreviewAutoPlayEligibilityParams {
  autoPlayEnabled: boolean
  pausedByVisibility: boolean
  hasActiveMediaPreview: boolean
  mediaCount: number
}

export type PreviewAutoPlayGateIntent =
  | { kind: 'none' }
  | { kind: 'disable-autoplay' }

export interface ResolvePreviewAutoPlayGateIntentParams {
  autoPlayEnabled: boolean
  hasOpenPreview: boolean
  hasActiveMediaPreview: boolean
}

export type PreviewAutoPlayAdvanceIntent =
  | { kind: 'none' }
  | { kind: 'advance-media' }

export interface ResolvePreviewAutoPlayAdvanceIntentParams {
  isAutoPlayEligible: boolean
  activeFile: FileItem | null
}

export type PreviewAutoPlayTimerPlan =
  | { kind: 'none' }
  | { kind: 'schedule-image-advance'; delayMs: number }

export interface ResolvePreviewAutoPlayTimerPlanParams {
  isAutoPlayEligible: boolean
  activeFile: FileItem | null
  intervalSec: number
}

export function resolvePreviewAutoPlayEligibility({
  autoPlayEnabled,
  pausedByVisibility,
  hasActiveMediaPreview,
  mediaCount,
}: ResolvePreviewAutoPlayEligibilityParams): boolean {
  return autoPlayEnabled
    && !pausedByVisibility
    && hasActiveMediaPreview
    && mediaCount > 1
}

export function resolvePreviewAutoPlayGateIntent({
  autoPlayEnabled,
  hasOpenPreview,
  hasActiveMediaPreview,
}: ResolvePreviewAutoPlayGateIntentParams): PreviewAutoPlayGateIntent {
  if (!autoPlayEnabled) return { kind: 'none' }
  if (!hasOpenPreview || !hasActiveMediaPreview) return { kind: 'disable-autoplay' }
  return { kind: 'none' }
}

export function resolvePreviewAutoPlayAdvanceIntent({
  isAutoPlayEligible,
  activeFile,
}: ResolvePreviewAutoPlayAdvanceIntentParams): PreviewAutoPlayAdvanceIntent {
  if (!isAutoPlayEligible || activeFile?.kind !== 'file') return { kind: 'none' }
  if (getFilePreviewKind(activeFile.name) !== 'video') return { kind: 'none' }
  return { kind: 'advance-media' }
}

export function resolvePreviewAutoPlayTimerPlan({
  isAutoPlayEligible,
  activeFile,
  intervalSec,
}: ResolvePreviewAutoPlayTimerPlanParams): PreviewAutoPlayTimerPlan {
  if (!isAutoPlayEligible || activeFile?.kind !== 'file') return { kind: 'none' }
  if (getFilePreviewKind(activeFile.name) !== 'image') return { kind: 'none' }
  return {
    kind: 'schedule-image-advance',
    delayMs: intervalSec * 1000,
  }
}
