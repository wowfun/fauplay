const THUMBNAIL_SIZE = 180

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg']

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
  type: 'image' | 'video'
): Promise<string> {
  if (type === 'video') {
    return generateVideoThumbnail(file)
  }
  return generateImageThumbnail(file)
}

async function generateImageThumbnail(file: File): Promise<string> {
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
        if (width > THUMBNAIL_SIZE) {
          height = (height * THUMBNAIL_SIZE) / width
          width = THUMBNAIL_SIZE
        }
      } else {
        if (height > THUMBNAIL_SIZE) {
          width = (width * THUMBNAIL_SIZE) / height
          height = THUMBNAIL_SIZE
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

async function generateVideoThumbnail(file: File): Promise<string> {
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
        if (width > THUMBNAIL_SIZE) {
          height = (height * THUMBNAIL_SIZE) / width
          width = THUMBNAIL_SIZE
        }
      } else {
        if (height > THUMBNAIL_SIZE) {
          width = (width * THUMBNAIL_SIZE) / height
          height = THUMBNAIL_SIZE
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
