import {
  fromRemoteUiRootId as defaultFromRemoteUiRootId,
  getActiveRemoteWorkspace as defaultGetActiveRemoteWorkspace,
  isRemoteReadonlyProviderActive as defaultIsRemoteReadonlyProviderActive,
  type ActiveRemoteWorkspace,
} from './accessState.ts'
import {
  buildLocalRuntimeUrl as defaultBuildLocalRuntimeUrl,
  callLocalRuntimeHttp as defaultCallLocalRuntimeHttp,
  getLocalRuntimeBaseUrl as defaultGetLocalRuntimeBaseUrl,
  getSameOriginRuntimeBaseUrl as defaultGetSameOriginRuntimeBaseUrl,
  normalizeEndpointPath,
} from './runtimeApi/http.ts'
import { RuntimeHttpError } from './runtimeApi/errors.ts'
import { callRemoteAccessHttp as defaultCallRemoteAccessHttp } from './remoteAccess.ts'
import type { FileItem, TextPreviewPayload } from '@/types'

interface FaceCropUrlOptions {
  size?: number
  padding?: number
  rootId?: string
}

interface AbsoluteFileUrlOptions {
  sizePreset?: string
}

interface RemoteFileUrlOptions {
  sizePreset?: string
}

export interface FileAccessClient {
  buildFileContentUrl(absolutePath: string): string
  buildFileThumbnailUrl(absolutePath: string, options?: AbsoluteFileUrlOptions): string
  buildRemoteFileContentUrl(rootId: string, relativePath: string): string
  buildRemoteFileThumbnailUrl(rootId: string, relativePath: string, options?: RemoteFileUrlOptions): string
  loadTextPreview(absolutePath: string, sizeLimitBytes?: number): Promise<TextPreviewPayload>
  loadRemoteTextPreview(rootId: string, relativePath: string, sizeLimitBytes?: number): Promise<TextPreviewPayload>
  buildFileContentUrlForItem(file: FileItem): string | null
  buildFileThumbnailUrlForItem(file: FileItem, options?: AbsoluteFileUrlOptions): string | null
  loadTextPreviewForItem(file: FileItem, sizeLimitBytes?: number): Promise<TextPreviewPayload>
  buildFaceCropUrl(faceId: string, options?: FaceCropUrlOptions): string
}

export interface FileAccessClientOptions {
  buildLocalRuntimeUrl?: (endpointPath: string) => string
  getLocalRuntimeBaseUrl?: () => string
  getSameOriginRuntimeBaseUrl?: () => string
  callLocalRuntimeHttp?: <T = unknown>(
    endpointPath: string,
    body?: unknown,
    timeoutMs?: number,
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  ) => Promise<T>
  callRemoteAccessHttp?: <T = unknown>(
    endpointPath: string,
    body?: Record<string, unknown>,
    timeoutMs?: number,
    method?: 'GET' | 'POST',
  ) => Promise<T>
  isRemoteReadonlyProviderActive?: () => boolean
  fromRemoteUiRootId?: (rootId: string) => string | null
  getActiveRemoteWorkspace?: () => ActiveRemoteWorkspace | null
}

export function createFileAccessClient(options: FileAccessClientOptions = {}): FileAccessClient {
  const buildLocalRuntimeUrl = options.buildLocalRuntimeUrl ?? defaultBuildLocalRuntimeUrl
  const getLocalRuntimeBaseUrl = options.getLocalRuntimeBaseUrl ?? defaultGetLocalRuntimeBaseUrl
  const getSameOriginRuntimeBaseUrl = options.getSameOriginRuntimeBaseUrl ?? defaultGetSameOriginRuntimeBaseUrl
  const callLocalRuntimeHttp = options.callLocalRuntimeHttp ?? defaultCallLocalRuntimeHttp
  const callRemoteAccessHttp = options.callRemoteAccessHttp ?? defaultCallRemoteAccessHttp
  const isRemoteReadonlyProviderActive = options.isRemoteReadonlyProviderActive ?? defaultIsRemoteReadonlyProviderActive
  const fromRemoteUiRootId = options.fromRemoteUiRootId ?? defaultFromRemoteUiRootId
  const getActiveRemoteWorkspace = options.getActiveRemoteWorkspace ?? defaultGetActiveRemoteWorkspace

  function buildFileContentUrl(absolutePath: string): string {
    return appendAbsolutePathQuery('/v1/files/content', absolutePath)
  }

  function buildFileThumbnailUrl(absolutePath: string, fileOptions: AbsoluteFileUrlOptions = {}): string {
    return appendAbsolutePathQuery('/v1/files/thumbnail', absolutePath, fileOptions)
  }

  function buildRemoteFileContentUrl(rootId: string, relativePath: string): string {
    return appendRemoteFileQuery('/v1/remote/files/content', rootId, relativePath)
  }

  function buildRemoteFileThumbnailUrl(
    rootId: string,
    relativePath: string,
    fileOptions: RemoteFileUrlOptions = {},
  ): string {
    return appendRemoteFileQuery('/v1/remote/files/thumbnail', rootId, relativePath, fileOptions)
  }

  async function loadTextPreview(
    absolutePath: string,
    sizeLimitBytes?: number,
  ): Promise<TextPreviewPayload> {
    return callLocalRuntimeHttp('/v1/files/text-preview', {
      absolutePath,
      ...(typeof sizeLimitBytes === 'number' ? { sizeLimitBytes } : {}),
    })
  }

  async function loadRemoteTextPreview(
    rootId: string,
    relativePath: string,
    sizeLimitBytes?: number,
  ): Promise<TextPreviewPayload> {
    return callRemoteAccessHttp('/v1/remote/files/text-preview', {
      rootId,
      relativePath,
      ...(typeof sizeLimitBytes === 'number' ? { sizeLimitBytes } : {}),
    })
  }

  function buildFileContentUrlForItem(file: FileItem): string | null {
    const remoteRootId = getFileRemoteRootId(file)
    if (remoteRootId) {
      return buildRemoteFileContentUrl(remoteRootId, file.path)
    }
    if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
      return buildFileContentUrl(file.absolutePath.trim())
    }
    return null
  }

  function buildFileThumbnailUrlForItem(
    file: FileItem,
    fileOptions: AbsoluteFileUrlOptions = {},
  ): string | null {
    const remoteRootId = getFileRemoteRootId(file)
    if (remoteRootId) {
      return buildRemoteFileThumbnailUrl(remoteRootId, file.path, {
        sizePreset: fileOptions.sizePreset,
      })
    }
    if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
      return buildFileThumbnailUrl(file.absolutePath.trim(), fileOptions)
    }
    return null
  }

  async function loadTextPreviewForItem(
    file: FileItem,
    sizeLimitBytes?: number,
  ): Promise<TextPreviewPayload> {
    const remoteRootId = getFileRemoteRootId(file)
    if (remoteRootId) {
      return loadRemoteTextPreview(remoteRootId, file.path, sizeLimitBytes)
    }
    if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
      return loadTextPreview(file.absolutePath.trim(), sizeLimitBytes)
    }
    throw new RuntimeHttpError('File preview is unavailable', 'FILE_PREVIEW_UNAVAILABLE')
  }

  function buildFaceCropUrl(faceId: string, faceOptions: FaceCropUrlOptions = {}): string {
    const normalizedFaceId = String(faceId || '').trim()
    const remoteRootId = isRemoteReadonlyProviderActive()
      ? (
        (typeof faceOptions.rootId === 'string' && faceOptions.rootId.trim()
          ? (fromRemoteUiRootId(faceOptions.rootId) ?? faceOptions.rootId.trim())
          : getActiveRemoteWorkspace()?.configRootId)
        || ''
      )
      : ''

    const params = new URLSearchParams()
    if (remoteRootId) {
      params.set('rootId', remoteRootId)
    }
    if (typeof faceOptions.size === 'number' && Number.isFinite(faceOptions.size) && faceOptions.size > 0) {
      params.set('size', String(Math.trunc(faceOptions.size)))
    }
    if (typeof faceOptions.padding === 'number' && Number.isFinite(faceOptions.padding) && faceOptions.padding >= 0) {
      params.set('padding', String(faceOptions.padding))
    }

    if (!normalizedFaceId) {
      const baseUrl = isRemoteReadonlyProviderActive()
        ? getSameOriginRuntimeBaseUrl()
        : getLocalRuntimeBaseUrl()
      const path = isRemoteReadonlyProviderActive() ? '/v1/remote/faces/crops/invalid' : '/v1/faces/crops/invalid'
      return appendSerializedQuery(`${baseUrl}${path}`, params)
    }

    const endpoint = isRemoteReadonlyProviderActive()
      ? `${getSameOriginRuntimeBaseUrl()}/v1/remote/faces/crops/${encodeURIComponent(normalizedFaceId)}`
      : buildLocalRuntimeUrl(`/v1/faces/crops/${encodeURIComponent(normalizedFaceId)}`)
    return appendSerializedQuery(endpoint, params)
  }

  function appendAbsolutePathQuery(
    endpointPath: string,
    absolutePath: string,
    fileOptions: AbsoluteFileUrlOptions = {},
  ): string {
    const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
    const endpoint = new URL(buildLocalRuntimeUrl(normalizedPath))
    endpoint.searchParams.set('absolutePath', absolutePath)
    if (typeof fileOptions.sizePreset === 'string' && fileOptions.sizePreset.trim()) {
      endpoint.searchParams.set('sizePreset', fileOptions.sizePreset.trim())
    }
    return endpoint.toString()
  }

  function appendRemoteFileQuery(
    endpointPath: string,
    rootId: string,
    relativePath: string,
    fileOptions: RemoteFileUrlOptions = {},
  ): string {
    const normalizedPath = normalizeEndpointPath(endpointPath)
    const endpoint = new URL(`${getSameOriginRuntimeBaseUrl()}${normalizedPath}`)
    endpoint.searchParams.set('rootId', rootId)
    endpoint.searchParams.set('relativePath', relativePath)
    if (typeof fileOptions.sizePreset === 'string' && fileOptions.sizePreset.trim()) {
      endpoint.searchParams.set('sizePreset', fileOptions.sizePreset.trim())
    }
    return endpoint.toString()
  }

  return {
    buildFileContentUrl,
    buildFileThumbnailUrl,
    buildRemoteFileContentUrl,
    buildRemoteFileThumbnailUrl,
    loadTextPreview,
    loadRemoteTextPreview,
    buildFileContentUrlForItem,
    buildFileThumbnailUrlForItem,
    loadTextPreviewForItem,
    buildFaceCropUrl,
  }
}

const defaultFileAccessClient = createFileAccessClient()

export function buildFileContentUrl(absolutePath: string): string {
  return defaultFileAccessClient.buildFileContentUrl(absolutePath)
}

export function buildFileThumbnailUrl(absolutePath: string, options?: AbsoluteFileUrlOptions): string {
  return defaultFileAccessClient.buildFileThumbnailUrl(absolutePath, options)
}

export function buildRemoteFileContentUrl(rootId: string, relativePath: string): string {
  return defaultFileAccessClient.buildRemoteFileContentUrl(rootId, relativePath)
}

export function buildRemoteFileThumbnailUrl(
  rootId: string,
  relativePath: string,
  options?: RemoteFileUrlOptions,
): string {
  return defaultFileAccessClient.buildRemoteFileThumbnailUrl(rootId, relativePath, options)
}

export function loadTextPreview(absolutePath: string, sizeLimitBytes?: number): Promise<TextPreviewPayload> {
  return defaultFileAccessClient.loadTextPreview(absolutePath, sizeLimitBytes)
}

export function loadRemoteTextPreview(
  rootId: string,
  relativePath: string,
  sizeLimitBytes?: number,
): Promise<TextPreviewPayload> {
  return defaultFileAccessClient.loadRemoteTextPreview(rootId, relativePath, sizeLimitBytes)
}

export function buildFileContentUrlForItem(file: FileItem): string | null {
  return defaultFileAccessClient.buildFileContentUrlForItem(file)
}

export function buildFileThumbnailUrlForItem(file: FileItem, options?: AbsoluteFileUrlOptions): string | null {
  return defaultFileAccessClient.buildFileThumbnailUrlForItem(file, options)
}

export function loadTextPreviewForItem(file: FileItem, sizeLimitBytes?: number): Promise<TextPreviewPayload> {
  return defaultFileAccessClient.loadTextPreviewForItem(file, sizeLimitBytes)
}

export function buildFaceCropUrl(faceId: string, options?: FaceCropUrlOptions): string {
  return defaultFileAccessClient.buildFaceCropUrl(faceId, options)
}

function getFileRemoteRootId(file: FileItem): string {
  return typeof file.remoteRootId === 'string' ? file.remoteRootId.trim() : ''
}

function appendSerializedQuery(baseUrl: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${baseUrl}?${query}` : baseUrl
}
