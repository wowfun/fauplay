import type { ThumbnailSizePreset } from '@/types'

const DEFAULT_THUMBNAIL_SIZE = 180

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg']

const thumbnailCache = new Map<string, string>()

const THUMBNAIL_SIZE_BY_PRESET: Record<ThumbnailSizePreset, number> = {
  auto: DEFAULT_THUMBNAIL_SIZE,
  '256': 256,
  '512': 512,
}

interface GenerateThumbnailOptions {
  filePath?: string
  sizePreset?: ThumbnailSizePreset
}

function resolveThumbnailSize(sizePreset: ThumbnailSizePreset): number {
  return THUMBNAIL_SIZE_BY_PRESET[sizePreset]
}

function buildCacheKey(filePath: string, sizePreset: ThumbnailSizePreset, size: number): string {
  return `${filePath}::${sizePreset}::${size}`
}

export function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.includes(ext)
}

export function isVideoFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return VIDEO_EXTENSIONS.includes(ext)
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
  const cacheKey = options.filePath ? buildCacheKey(options.filePath, sizePreset, maxSize) : null

  if (cacheKey) {
    const cached = thumbnailCache.get(cacheKey)
    if (cached) return cached
  }

  let url: string
  if (type === 'video') {
    url = await generateVideoThumbnail(file, maxSize)
  } else {
    url = await generateImageThumbnail(file, maxSize)
  }

  if (cacheKey) {
    thumbnailCache.set(cacheKey, url)
  }

  return url
}

async function generateImageThumbnail(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

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
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

async function generateVideoThumbnail(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to get canvas context'))
      return
    }

    video.onloadeddata = () => {
      video.currentTime = 1
    }

    video.onseeked = () => {
      URL.revokeObjectURL(url)

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

      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load video'))
    }

    video.src = url
    video.crossOrigin = 'anonymous'
  })
}

export function getMediaType(name: string): 'image' | 'video' | null {
  if (isImageFile(name)) return 'image'
  if (isVideoFile(name)) return 'video'
  return null
}
