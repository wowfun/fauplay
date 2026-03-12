import type { FilePreviewKind } from '@/types'

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'])
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'xml',
  'csv',
  'log',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'py',
  'sh',
  'bash',
  'zsh',
  'ini',
  'conf',
  'toml',
  'sql',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'java',
  'go',
  'rs',
  'vue',
  'svelte',
])

export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024

function getExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() || ''
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(name))
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(name))
}

export function isTextPreviewFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(getExtension(name))
}

export function isMediaPreviewKind(kind: FilePreviewKind): boolean {
  return kind === 'image' || kind === 'video'
}

export function getFilePreviewKind(name: string): FilePreviewKind {
  if (isImageFile(name)) return 'image'
  if (isVideoFile(name)) return 'video'
  if (isTextPreviewFile(name)) return 'text'
  return 'unsupported'
}
