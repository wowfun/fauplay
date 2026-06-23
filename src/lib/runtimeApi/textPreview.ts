import type { TextPreviewPayload } from '@/types'
import { isObject } from './core'

export function parseRuntimeTextPreviewPayload(payload: unknown): TextPreviewPayload {
  if (!isObject(payload)) {
    return {
      status: 'error',
      content: null,
      fileSizeBytes: null,
      sizeLimitBytes: 0,
      error: 'Fauplay Runtime text preview response was invalid',
    }
  }

  const status = (
    payload.status === 'ready'
    || payload.status === 'too_large'
    || payload.status === 'binary'
    || payload.status === 'error'
  ) ? payload.status : 'error'

  return {
    status,
    content: typeof payload.content === 'string' ? payload.content : null,
    fileSizeBytes: typeof payload.fileSizeBytes === 'number' && Number.isFinite(payload.fileSizeBytes)
      ? payload.fileSizeBytes
      : null,
    sizeLimitBytes: typeof payload.sizeLimitBytes === 'number' && Number.isFinite(payload.sizeLimitBytes)
      ? payload.sizeLimitBytes
      : 0,
    error: typeof payload.error === 'string' ? payload.error : null,
  }
}
