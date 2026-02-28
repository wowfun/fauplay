import type { FileItem } from '@/types'

interface StatusBarProps {
  visibleFiles: FileItem[]
  selectedFile: FileItem | null
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

export function StatusBar({ visibleFiles, selectedFile }: StatusBarProps) {
  const visibleCount = visibleFiles.length
  const selectedCount = selectedFile ? 1 : 0
  const showMeta = selectedFile?.kind === 'file'

  return (
    <div className="flex items-center gap-4 px-4 h-8 border-t border-border text-xs text-muted-foreground">
      <span className="whitespace-nowrap">可见: {visibleCount}</span>
      <span className="whitespace-nowrap">已选: {selectedCount}</span>
      {showMeta && (
        <span className="whitespace-nowrap">大小: {formatSize(selectedFile?.size)}</span>
      )}
      {showMeta && (
        <span className="whitespace-nowrap">修改: {formatDate(selectedFile?.lastModified)}</span>
      )}
    </div>
  )
}
