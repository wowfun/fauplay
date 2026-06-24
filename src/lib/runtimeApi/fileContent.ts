import type { FileItem, TextPreviewPayload } from '@/types'
import {
  buildRuntimeUrl,
  callRuntimeJson,
  isObject,
  RuntimeApiError,
  toFiniteNumber,
} from './core'
import {
  normalizeRootRelativePath,
  resolveRuntimeFileLocator,
} from './fileLocator.ts'
import { parseRuntimeTextPreviewPayload } from './textPreview'
import type {
  RuntimeFileContentRequest,
  RuntimeFileMetadataRequest,
  RuntimeFileMetadataResponse,
  RuntimeTextPreviewRequest,
} from './types'

export async function loadRuntimeTextPreview(
  request: RuntimeTextPreviewRequest,
  timeoutMs?: number,
): Promise<TextPreviewPayload> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath,
  })
  if (
    typeof request.sizeLimitBytes === 'number'
    && Number.isFinite(request.sizeLimitBytes)
    && request.sizeLimitBytes > 0
  ) {
    query.set('sizeLimitBytes', String(Math.trunc(request.sizeLimitBytes)))
  }

  const payload = await callRuntimeJson(`/v1/text-preview?${query.toString()}`, timeoutMs)
  return parseRuntimeTextPreviewPayload(payload)
}

export function buildRuntimeFileContentUrl(request: RuntimeFileContentRequest): string {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath,
  })
  return buildRuntimeUrl(`/v1/file-content?${query.toString()}`)
}

export async function loadRuntimeFileMetadata(
  request: RuntimeFileMetadataRequest,
  timeoutMs?: number,
): Promise<RuntimeFileMetadataResponse> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath,
  })
  const payload = await callRuntimeJson(`/v1/file-metadata?${query.toString()}`, timeoutMs)
  return parseRuntimeFileMetadataResponse(payload)
}

export function buildRuntimeFileContentUrlForItem(file: FileItem): string | null {
  const locator = resolveRuntimeFileLocator(file)
  if (!locator) {
    return null
  }

  return buildRuntimeFileContentUrl(locator)
}

function parseRuntimeFileMetadataResponse(payload: unknown): RuntimeFileMetadataResponse {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime File Metadata response was invalid')
  }

  const rootRelativePath = typeof payload.rootRelativePath === 'string'
    ? normalizeRootRelativePath(payload.rootRelativePath)
    : ''
  const size = toFiniteNumber(payload.size)
  if (!rootRelativePath || typeof size !== 'number') {
    throw new RuntimeApiError('Fauplay Runtime File Metadata response was invalid')
  }

  return {
    rootRelativePath,
    size,
    lastModifiedMs: toFiniteNumber(payload.lastModifiedMs),
  }
}
