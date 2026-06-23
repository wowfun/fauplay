import type { FileItem, TextPreviewPayload } from '@/types'
import {
  buildRuntimeUrl,
  callRuntimeJson,
  isAbsolutePathLike,
  isObject,
  normalizeRootRelativePath,
  RuntimeApiError,
  toFiniteNumber,
} from './core'
import { parseRuntimeTextPreviewPayload } from './textPreview'
import type {
  RuntimeFileContentRequest,
  RuntimeFileLocator,
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

export function resolveRuntimeFileLocator(
  file: FileItem,
  fallbackRootPath?: string | null,
): RuntimeFileLocator | null {
  const rootPath = typeof file.sourceRootPath === 'string' && file.sourceRootPath.trim()
    ? file.sourceRootPath.trim()
    : (typeof fallbackRootPath === 'string' && fallbackRootPath.trim() ? fallbackRootPath.trim() : '')
  const rawRootRelativePath = typeof file.sourceRelativePath === 'string' && file.sourceRelativePath.trim()
    ? file.sourceRelativePath
    : file.path
  const rootRelativePath = normalizeRootRelativePath(rawRootRelativePath)

  if (!rootPath || !rootRelativePath || isAbsolutePathLike(rootRelativePath)) {
    return null
  }

  return {
    rootPath,
    rootRelativePath,
  }
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
