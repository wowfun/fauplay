import type { FileItem } from '@/types'

interface ExplorerStatusBarProps {
  visibleFiles: FileItem[]
  selectedCount: number
  selectedMetaFile: FileItem | null
}

function formatSize(bytes?: number): string {
  if (!bytes) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDate(date?: Date): string {
  if (!date) return '未知'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ExplorerStatusBar({ visibleFiles, selectedCount, selectedMetaFile }: ExplorerStatusBarProps) {
  const visibleCount = visibleFiles.length
  const showMeta = selectedMetaFile?.kind === 'file'

  return (
    <div className="flex-shrink-0 flex items-center gap-4 px-4 h-8 border-t border-border text-xs text-muted-foreground">
      <span className="whitespace-nowrap">可见: {visibleCount}</span>
      <span className="whitespace-nowrap">已选: {selectedCount}</span>
      {showMeta && (
        <span className="whitespace-nowrap">大小: {formatSize(selectedMetaFile?.size)}</span>
      )}
      {showMeta && (
        <span className="whitespace-nowrap">修改: {formatDate(selectedMetaFile?.lastModified)}</span>
      )}
    </div>
  )
}
