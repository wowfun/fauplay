import type { FileItem } from '@/types'
import type { RuntimeFileLocator } from './types.ts'

export function normalizeRootRelativePath(path: string): string {
  return path.replace(/\\/g, '/').trim().split('/').filter(Boolean).join('/')
}

export function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

export function resolveRuntimeFileLocator(
  file: FileItem,
  fallbackRootPath?: string | null,
): RuntimeFileLocator | null {
  const rootPath = typeof file.sourceRootPath === 'string' && file.sourceRootPath.trim()
    ? file.sourceRootPath.trim()
    : (typeof fallbackRootPath === 'string' && fallbackRootPath.trim() ? fallbackRootPath.trim() : '')
  const rawRootRelativePath = typeof file.sourceRelativePath === 'string' && file.sourceRelativePath.trim()
    ? file.sourceRelativePath.trim()
    : file.path.trim()

  if (!rootPath || !rawRootRelativePath || isAbsolutePathLike(rawRootRelativePath)) {
    return null
  }

  const rootRelativePath = normalizeRootRelativePath(rawRootRelativePath)
  if (!rootRelativePath) {
    return null
  }

  return {
    rootPath,
    rootRelativePath,
  }
}
