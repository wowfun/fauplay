const PREVIEW_KIND_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
const PREVIEW_KIND_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'])
const PREVIEW_KIND_TEXT_EXTS = new Set([
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

const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
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
}

function getFileExtension(name) {
  return String(name || '').split('.').pop()?.toLowerCase() || ''
}

export function getPreviewKind(name) {
  const ext = getFileExtension(name)
  if (PREVIEW_KIND_IMAGE_EXTS.has(ext)) return 'image'
  if (PREVIEW_KIND_VIDEO_EXTS.has(ext)) return 'video'
  if (PREVIEW_KIND_TEXT_EXTS.has(ext)) return 'text'
  return 'unsupported'
}

export function getMimeType(name) {
  return MIME_BY_EXTENSION[getFileExtension(name)] || 'application/octet-stream'
}
