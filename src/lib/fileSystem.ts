import { isImageFile as isImagePreviewFile, isVideoFile as isVideoPreviewFile } from '@/lib/filePreview'

const HIDDEN_SYSTEM_DIRECTORIES = new Set(['.trash'])

export function isImageFile(name: string): boolean {
  return isImagePreviewFile(name)
}

export function isVideoFile(name: string): boolean {
  return isVideoPreviewFile(name)
}

export function isMediaFile(name: string): boolean {
  return isImageFile(name) || isVideoFile(name)
}

export function isHiddenSystemDirectory(name: string): boolean {
  return HIDDEN_SYSTEM_DIRECTORIES.has(name)
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
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    json: 'application/json',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    xml: 'application/xml',
    csv: 'text/csv',
    log: 'text/plain',
    js: 'text/javascript',
    jsx: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    css: 'text/css',
    scss: 'text/x-scss',
    less: 'text/x-less',
    html: 'text/html',
    htm: 'text/html',
    py: 'text/x-python',
    sh: 'text/x-shellscript',
    bash: 'text/x-shellscript',
    zsh: 'text/x-shellscript',
    ini: 'text/plain',
    conf: 'text/plain',
    toml: 'application/toml',
    sql: 'application/sql',
    c: 'text/x-c',
    cc: 'text/x-c++',
    cpp: 'text/x-c++',
    h: 'text/x-c',
    hpp: 'text/x-c++',
    java: 'text/x-java-source',
    go: 'text/x-go',
    rs: 'text/x-rust',
    vue: 'text/plain',
    svelte: 'text/plain',
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
  recursive: boolean = false,
  options: { includeMetadata?: boolean } = {}
): Promise<{ files: import('@/types').FileItem[]; directories: import('@/types').FileItem[] }> {
  const files: import('@/types').FileItem[] = []
  const directories: import('@/types').FileItem[] = []
  const includeMetadata = options.includeMetadata === true

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const fileItem: import('@/types').FileItem = {
        name: entry.name,
        path: entry.name,
        kind: 'file',
        mimeType: getMimeType(entry.name),
      }

      if (includeMetadata) {
        const fileHandle = entry as FileSystemFileHandle
        const file = await fileHandle.getFile()
        fileItem.size = file.size
        fileItem.lastModified = file.lastModified ? new Date(file.lastModified) : undefined
      }

      files.push(fileItem)
    } else if (entry.kind === 'directory') {
      if (isHiddenSystemDirectory(entry.name)) {
        continue
      }
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
        const subResult = await readDirectory(directoryHandle, true, options)
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
  const file = await getFileFromPath(handle, filePath)
  const pathParts = filePath.split('/').filter(Boolean)
  const fallbackName = pathParts[pathParts.length - 1] || file.name
  return createObjectUrlForFile(file, fallbackName)
}

export async function getFileFromPath(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string
): Promise<File> {
  const pathParts = filePath.split('/').filter(Boolean)
  if (pathParts.length === 0) {
    throw new Error('Invalid file path')
  }

  let current: FileSystemDirectoryHandle = rootHandle
  for (let i = 0; i < pathParts.length - 1; i++) {
    current = await current.getDirectoryHandle(pathParts[i])
  }

  const fileName = pathParts[pathParts.length - 1]
  const fileHandle = await current.getFileHandle(fileName)
  return fileHandle.getFile()
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
