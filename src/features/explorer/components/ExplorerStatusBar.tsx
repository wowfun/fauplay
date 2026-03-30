import { useEffect, useMemo, useState } from 'react'
import { EXPLORER_STATUS_BAR_HEIGHT_PX } from '@/features/explorer/constants/statusBar'
import { getFileFromPath } from '@/lib/fileSystem'
import { getBoundRootPath } from '@/lib/reveal'
import type { FileItem } from '@/types'

interface ExplorerStatusBarProps {
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  visibleFiles: FileItem[]
  selectedCount: number
  selectedMetaFile: FileItem | null
  previewMetaFile?: FileItem | null
}

function formatSize(bytes?: number): string {
  if (typeof bytes !== 'number') return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDate(timestamp?: number): string {
  if (typeof timestamp !== 'number') return '未知'
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function getParentDirectory(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''

  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    const normalized = trimmed.replace(/\//g, '\\').replace(/\\+$/, '')
    const separatorIndex = normalized.lastIndexOf('\\')
    if (separatorIndex < 0) return ''
    if (separatorIndex <= 2) return `${normalized.slice(0, 2)}\\`
    return normalized.slice(0, separatorIndex)
  }

  const normalized = trimmed.replace(/\/+$/, '') || '/'
  const separatorIndex = normalized.lastIndexOf('/')
  if (separatorIndex < 0) return ''
  if (separatorIndex === 0) return '/'
  return normalized.slice(0, separatorIndex)
}

function joinRootPath(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  const normalizedRelative = normalizeRelativePath(relativePath)
  if (!normalizedRelative) return normalizedRoot
  return `${normalizedRoot}/${normalizedRelative}`
}

function resolveParentDirectory(file: FileItem, rootId: string | null | undefined): string {
  const displayPath = typeof file.displayPath === 'string' ? file.displayPath.trim() : ''
  if (displayPath && isAbsolutePathLike(displayPath)) {
    const parentDirectory = getParentDirectory(displayPath)
    if (parentDirectory) return parentDirectory
  }

  const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
  if (absolutePath && isAbsolutePathLike(absolutePath)) {
    const parentDirectory = getParentDirectory(absolutePath)
    if (parentDirectory) return parentDirectory
  }

  const relativePath = normalizeRelativePath(file.path)
  const boundRootPath = rootId ? getBoundRootPath(rootId) : null
  if (boundRootPath) {
    const absoluteResolvedPath = joinRootPath(boundRootPath, relativePath)
    const parentDirectory = getParentDirectory(absoluteResolvedPath)
    if (parentDirectory) return parentDirectory
    return boundRootPath
  }

  const relativeParent = getParentDirectory(relativePath)
  if (relativeParent) return relativeParent
  return '当前根目录'
}

export function ExplorerStatusBar({
  rootHandle,
  rootId,
  visibleFiles,
  selectedCount,
  selectedMetaFile,
  previewMetaFile = null,
}: ExplorerStatusBarProps) {
  const visibleCount = visibleFiles.length
  const metaTarget = previewMetaFile?.kind === 'file'
    ? previewMetaFile
    : (selectedMetaFile?.kind === 'file' ? selectedMetaFile : null)
  const [resolvedMeta, setResolvedMeta] = useState<{ size?: number; lastModifiedMs?: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!metaTarget || metaTarget.kind !== 'file') {
      setResolvedMeta(null)
      return () => {
        cancelled = true
      }
    }

    const nextResolvedMeta = {
      size: typeof metaTarget.size === 'number' ? metaTarget.size : undefined,
      lastModifiedMs: typeof metaTarget.lastModifiedMs === 'number'
        ? metaTarget.lastModifiedMs
        : (metaTarget.lastModified ? metaTarget.lastModified.getTime() : undefined),
    }

    if (
      typeof nextResolvedMeta.size === 'number'
      && typeof nextResolvedMeta.lastModifiedMs === 'number'
    ) {
      setResolvedMeta(nextResolvedMeta)
      return () => {
        cancelled = true
      }
    }

    const shouldReadThroughCurrentRoot = Boolean(
      rootHandle
      && metaTarget.path
      && !isAbsolutePathLike(metaTarget.path)
      && (!metaTarget.sourceRootPath || metaTarget.sourceRootPath === (rootId ? getBoundRootPath(rootId) : null))
    )

    if (!shouldReadThroughCurrentRoot || !rootHandle) {
      setResolvedMeta(nextResolvedMeta)
      return () => {
        cancelled = true
      }
    }

    setResolvedMeta(nextResolvedMeta)

    void (async () => {
      try {
        const file = await getFileFromPath(rootHandle, metaTarget.path)
        if (cancelled) return
        setResolvedMeta({
          size: file.size,
          lastModifiedMs: file.lastModified,
        })
      } catch {
        if (cancelled) return
        setResolvedMeta(nextResolvedMeta)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [metaTarget, rootHandle, rootId])

  const parentDirectory = useMemo(
    () => (metaTarget ? resolveParentDirectory(metaTarget, rootId) : null),
    [metaTarget, rootId]
  )
  const showMeta = Boolean(metaTarget)

  return (
    <div
      className="flex shrink-0 items-center gap-4 border-t border-border bg-background px-4 text-xs text-muted-foreground"
      style={{ height: EXPLORER_STATUS_BAR_HEIGHT_PX }}
    >
      <span className="shrink-0 whitespace-nowrap">可见: {visibleCount}</span>
      <span className="shrink-0 whitespace-nowrap">已选: {selectedCount}</span>
      {showMeta && (
        <span className="shrink-0 whitespace-nowrap">大小: {formatSize(resolvedMeta?.size)}</span>
      )}
      {showMeta && (
        <span className="shrink-0 whitespace-nowrap">修改: {formatDate(resolvedMeta?.lastModifiedMs)}</span>
      )}
      {showMeta && (
        <span className="min-w-0 flex-1 truncate" title={parentDirectory || undefined}>
          路径: {parentDirectory || '当前根目录'}
        </span>
      )}
    </div>
  )
}
