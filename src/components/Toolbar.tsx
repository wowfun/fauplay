import { Search, ArrowUpDown, Image, Video, Files, ChevronLeft, Rows3 } from 'lucide-react'
import type { FilterState } from '@/types'

interface ToolbarProps {
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  currentPath: string
  onNavigateUp: () => void
  isFlattenView: boolean
  onToggleFlattenView: () => void
  totalCount: number
  imageCount: number
  videoCount: number
}

function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

export function Toolbar({
  filter,
  onFilterChange,
  currentPath,
  onNavigateUp,
  isFlattenView,
  onToggleFlattenView,
  totalCount,
  imageCount,
  videoCount,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-border">
      {currentPath && (
        <button
          onClick={onNavigateUp}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>返回</span>
        </button>
      )}

      {currentPath && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span className="px-2 py-1 bg-muted rounded">{currentPath}</span>
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索文件..."
            value={filter.search}
            onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
            className="pl-9 pr-4 py-1.5 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onFilterChange({ ...filter, type: 'all' })}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
            filter.type === 'all' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
        >
          <Files className="w-4 h-4" />
          <span>全部</span>
          <span className="text-xs opacity-80">({formatCount(totalCount)})</span>
        </button>
        <button
          onClick={() => onFilterChange({ ...filter, type: 'image' })}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
            filter.type === 'image' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
        >
          <Image className="w-4 h-4" />
          <span>图片</span>
          <span className="text-xs opacity-80">({formatCount(imageCount)})</span>
        </button>
        <button
          onClick={() => onFilterChange({ ...filter, type: 'video' })}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
            filter.type === 'video' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
        >
          <Video className="w-4 h-4" />
          <span>视频</span>
          <span className="text-xs opacity-80">({formatCount(videoCount)})</span>
        </button>
      </div>

      <button
        onClick={() => onFilterChange({ ...filter, hideEmptyFolders: !filter.hideEmptyFolders })}
        className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
          filter.hideEmptyFolders ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
        }`}
        title="隐藏空文件夹"
      >
        隐藏空文件夹
      </button>

      <button
        onClick={onToggleFlattenView}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
          isFlattenView ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
        }`}
        title="平铺显示当前目录及其子目录中的所有文件"
      >
        <Rows3 className="w-4 h-4" />
        <span>平铺视图</span>
      </button>

      <select
        value={filter.sortBy}
        onChange={(e) => onFilterChange({ ...filter, sortBy: e.target.value as FilterState['sortBy'] })}
        className="px-2 py-1.5 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="name">名称</option>
        <option value="date">日期</option>
        <option value="size">大小</option>
      </select>

      <button
        onClick={() => onFilterChange({ ...filter, sortOrder: filter.sortOrder === 'asc' ? 'desc' : 'asc' })}
        className="p-1.5 rounded-md hover:bg-accent transition-colors"
        title={filter.sortOrder === 'asc' ? '升序' : '降序'}
      >
        <ArrowUpDown className="w-4 h-4" />
      </button>
    </div>
  )
}
