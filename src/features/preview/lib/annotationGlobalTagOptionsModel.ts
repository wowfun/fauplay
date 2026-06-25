import type { AnnotationFilterTagOption } from '../../../types/index.ts'
import {
  buildGlobalAnnotationTagOptions,
  type AnnotationGatewayTagOptionRecord,
} from './annotationTagModel.ts'

export type GlobalAnnotationTagOptionsStatus = 'idle' | 'loading' | 'ready'

export interface GlobalAnnotationTagOptionsSnapshot {
  status: GlobalAnnotationTagOptionsStatus
  options: AnnotationFilterTagOption[]
  error: string | null
  loadedAtMs: number | null
}

export type GlobalAnnotationTagOptionsAction =
  | { type: 'mark-loading' }
  | { type: 'apply-option-records'; optionRecords: AnnotationGatewayTagOptionRecord[]; nowMs: number }
  | { type: 'apply-error'; error: unknown; nowMs: number }

export function createGlobalAnnotationTagOptionsState(
  overrides: Partial<GlobalAnnotationTagOptionsSnapshot> = {},
): GlobalAnnotationTagOptionsSnapshot {
  return {
    status: 'idle',
    options: [],
    error: null,
    loadedAtMs: null,
    ...overrides,
  }
}

export function reduceGlobalAnnotationTagOptions(
  snapshot: GlobalAnnotationTagOptionsSnapshot,
  action: GlobalAnnotationTagOptionsAction,
): GlobalAnnotationTagOptionsSnapshot {
  switch (action.type) {
    case 'mark-loading':
      return {
        ...snapshot,
        status: 'loading',
        error: null,
      }

    case 'apply-option-records':
      return {
        status: 'ready',
        options: buildGlobalAnnotationTagOptions(action.optionRecords),
        error: null,
        loadedAtMs: action.nowMs,
      }

    case 'apply-error':
      return {
        status: 'ready',
        options: [],
        error: action.error instanceof Error ? action.error.message : '读取标签候选失败',
        loadedAtMs: action.nowMs,
      }
  }
}

export function cloneGlobalAnnotationTagOptions(
  options: AnnotationFilterTagOption[],
): AnnotationFilterTagOption[] {
  return options.map((item) => ({
    ...item,
    sources: [...item.sources],
  }))
}
