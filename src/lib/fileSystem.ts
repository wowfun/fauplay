const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
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

export function getMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    ogg: 'video/ogg',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

export function createObjectUrlForFile(file: File, fallbackName?: string): string {
  if (file.type) {
    return URL.createObjectURL(file)
  }

  const inferredName = fallbackName || file.name
  const inferredMimeType = getMimeType(inferredName)
  if (inferredMimeType === 'application/octet-stream') {
    return URL.createObjectURL(file)
  }

  const typedFile = new File([file], inferredName, {
    type: inferredMimeType,
    lastModified: file.lastModified,
  })

  return URL.createObjectURL(typedFile)
}

export async function openDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await window.showDirectoryPicker()
    return handle
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null
    }
    throw error
  }
}

export async function readDirectory(
  dirHandle: FileSystemDirectoryHandle,
  recursive: boolean = false
): Promise<{ files: import('@/types').FileItem[]; directories: import('@/types').FileItem[] }> {
  const files: import('@/types').FileItem[] = []
  const directories: import('@/types').FileItem[] = []

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      if (recursive || isMediaFile(entry.name)) {
        const fileHandle = entry as FileSystemFileHandle
        const file = await fileHandle.getFile()
        files.push({
          name: entry.name,
          path: entry.name,
          kind: 'file',
          size: file.size,
          lastModified: file.lastModified ? new Date(file.lastModified) : undefined,
          mimeType: getMimeType(entry.name),
        })
      }
    } else if (entry.kind === 'directory') {
      const directoryHandle = entry as FileSystemDirectoryHandle
      let isEmpty = true
      for await (const _ of directoryHandle.values()) {
        isEmpty = false
        break
      }

      directories.push({
        name: entry.name,
        path: entry.name,
        kind: 'directory',
        isEmpty,
      })

      if (recursive) {
        const subResult = await readDirectory(directoryHandle, true)
        files.push(...subResult.files.map(f => ({
          ...f,
          path: `${entry.name}/${f.path}`,
        })))
        directories.push(...subResult.directories.map(d => ({
          ...d,
          path: `${entry.name}/${d.path}`,
        })))
      }
    }
  }

  return { files, directories }
}

export async function getFileUrl(handle: FileSystemDirectoryHandle, filePath: string): Promise<string> {
  const pathParts = filePath.split('/')
  let current: FileSystemHandle = handle

  for (const part of pathParts) {
    if (part.includes('.')) {
      const fileHandle = await (current as FileSystemDirectoryHandle).getFileHandle(part)
      const file = await fileHandle.getFile()
      return createObjectUrlForFile(file, part)
    } else {
      current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(part)
    }
  }

  throw new Error('Invalid file path')
}

export async function getDirectoryItemCount(
  rootHandle: FileSystemDirectoryHandle,
  dirPath: string,
  limit: number = 100
): Promise<number> {
  const pathParts = dirPath.split('/').filter(Boolean)
  let current: FileSystemDirectoryHandle = rootHandle

  for (const part of pathParts) {
    current = await current.getDirectoryHandle(part)
  }

  let count = 0
  for await (const _ of current.values()) {
    count += 1
    if (count >= limit) {
      return count
    }
  }

  return count
}
