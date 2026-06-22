import type { ThumbnailSizePreset } from '@/types'
import { getFilePreviewKind, isImageFile, isVideoFile } from '@/lib/filePreview'

const DEFAULT_THUMBNAIL_SIZE = 180
const VIDEO_THUMBNAIL_TIMEOUT_MS = 4000

const thumbnailCache = new Map<string, string>()

const THUMBNAIL_SIZE_BY_PRESET: Record<ThumbnailSizePreset, number> = {
  auto: DEFAULT_THUMBNAIL_SIZE,
  '256': 256,
  '512': 512,
}

interface GenerateThumbnailOptions {
  filePath?: string
  sizePreset?: ThumbnailSizePreset
  fileSize?: number
  fileLastModifiedMs?: number
  crossOrigin?: boolean
}

function resolveThumbnailSize(sizePreset: ThumbnailSizePreset): number {
  return THUMBNAIL_SIZE_BY_PRESET[sizePreset]
}

function buildCacheKey(
  filePath: string,
  sizePreset: ThumbnailSizePreset,
  size: number,
  fileVersion: string
): string {
  return `${filePath}::${fileVersion}::${sizePreset}::${size}`
}

function buildFileVersion(options: GenerateThumbnailOptions, file?: File): string | null {
  if (file) {
    return `${file.lastModified}:${file.size}`
  }

  if (
    typeof options.fileLastModifiedMs === 'number'
    && Number.isFinite(options.fileLastModifiedMs)
    && typeof options.fileSize === 'number'
    && Number.isFinite(options.fileSize)
  ) {
    return `${options.fileLastModifiedMs}:${options.fileSize}`
  }

  return null
}

export function isMediaFile(name: string): boolean {
  return isImageFile(name) || isVideoFile(name)
}

export async function generateThumbnail(
  file: File,
  type: 'image' | 'video',
  options: GenerateThumbnailOptions = {}
): Promise<string> {
  const sizePreset = options.sizePreset ?? 'auto'
  const maxSize = resolveThumbnailSize(sizePreset)
  const fileVersion = buildFileVersion(options, file)
  const cacheKey = options.filePath && fileVersion
    ? buildCacheKey(options.filePath, sizePreset, maxSize, fileVersion)
    : null

  if (cacheKey) {
    const cached = thumbnailCache.get(cacheKey)
    if (cached) return cached
  }

  let url: string
  if (type === 'video') {
    url = await generateVideoThumbnailFromObjectUrl(file, maxSize)
  } else {
    url = await generateImageThumbnail(file, maxSize)
  }

  if (cacheKey) {
    thumbnailCache.set(cacheKey, url)
  }

  return url
}

export async function generateThumbnailFromUrl(
  sourceUrl: string,
  type: 'image' | 'video',
  options: GenerateThumbnailOptions = {}
): Promise<string> {
  const sizePreset = options.sizePreset ?? 'auto'
  const maxSize = resolveThumbnailSize(sizePreset)
  const fileVersion = buildFileVersion(options)
  const cacheKey = options.filePath && fileVersion
    ? buildCacheKey(options.filePath, sizePreset, maxSize, fileVersion)
    : null

  if (cacheKey) {
    const cached = thumbnailCache.get(cacheKey)
    if (cached) return cached
  }

  const url = type === 'video'
    ? await generateVideoThumbnailFromUrl(sourceUrl, maxSize, {
      crossOrigin: options.crossOrigin === true,
      revokeSourceUrl: false,
    })
    : await generateImageThumbnailFromUrl(sourceUrl, maxSize, {
      crossOrigin: options.crossOrigin === true,
      revokeSourceUrl: false,
    })

  if (cacheKey) {
    thumbnailCache.set(cacheKey, url)
  }

  return url
}

async function generateImageThumbnail(file: File, maxSize: number): Promise<string> {
  const url = URL.createObjectURL(file)
  return generateImageThumbnailFromUrl(url, maxSize, {
    revokeSourceUrl: true,
  })
}

async function generateImageThumbnailFromUrl(
  sourceUrl: string,
  maxSize: number,
  options: { crossOrigin?: boolean; revokeSourceUrl?: boolean } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (options.crossOrigin === true) {
      img.crossOrigin = 'anonymous'
    }

    img.onload = () => {
      if (options.revokeSourceUrl === true) {
        URL.revokeObjectURL(sourceUrl)
      }

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      let width = img.width
      let height = img.height

      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width
          width = maxSize
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height
          height = maxSize
        }
      }

      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)

      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }

    img.onerror = () => {
      if (options.revokeSourceUrl === true) {
        URL.revokeObjectURL(sourceUrl)
      }
      reject(new Error('Failed to load image'))
    }

    img.src = sourceUrl
  })
}

async function generateVideoThumbnailFromObjectUrl(file: File, maxSize: number): Promise<string> {
  const url = URL.createObjectURL(file)
  return generateVideoThumbnailFromUrl(url, maxSize, {
    revokeSourceUrl: true,
  })
}

async function generateVideoThumbnailFromUrl(
  sourceUrl: string,
  maxSize: number,
  options: { crossOrigin?: boolean; revokeSourceUrl?: boolean } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      if (options.revokeSourceUrl === true) {
        URL.revokeObjectURL(sourceUrl)
      }
      reject(new Error('Failed to get canvas context'))
      return
    }

    let settled = false
    const timeoutId = window.setTimeout(() => {
      settleWithError(new Error('Video thumbnail generation timed out'))
    }, VIDEO_THUMBNAIL_TIMEOUT_MS)

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      video.pause()
      video.removeAttribute('src')
      video.load()
      if (options.revokeSourceUrl === true) {
        URL.revokeObjectURL(sourceUrl)
      }
    }

    const settleWithError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const settleWithSuccess = (thumbnailDataUrl: string) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(thumbnailDataUrl)
    }

    const captureCurrentFrame = () => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        settleWithError(new Error('Failed to read video dimensions'))
        return
      }

      let width = video.videoWidth
      let height = video.videoHeight

      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width
          width = maxSize
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height
          height = maxSize
        }
      }

      canvas.width = width
      canvas.height = height
      ctx.drawImage(video, 0, 0, width, height)
      settleWithSuccess(canvas.toDataURL('image/jpeg', 0.7))
    }

    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const seekTime = duration > 0 ? Math.min(1, Math.max(0, duration * 0.1)) : 0
      if (seekTime <= 0) {
        captureCurrentFrame()
        return
      }
      try {
        video.currentTime = seekTime
      } catch {
        settleWithError(new Error('Failed to seek video'))
      }
    }

    video.onseeked = captureCurrentFrame

    video.onerror = () => {
      settleWithError(new Error('Failed to load video'))
    }

    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    if (options.crossOrigin === true) {
      video.crossOrigin = 'anonymous'
    }
    video.src = sourceUrl
  })
}

export function getMediaType(name: string): 'image' | 'video' | null {
  const kind = getFilePreviewKind(name)
  if (kind === 'image' || kind === 'video') return kind
  return null
}
