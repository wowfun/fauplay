import { Search, ArrowUpDown, Image, Video, Files, ChevronLeft, Rows3 } from 'lucide-react'
import type { FilterState } from '@/types'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Select } from '@/ui/Select'

function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

interface ExplorerToolbarProps {
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

export function ExplorerToolbar({
  filter,
  onFilterChange,
  currentPath,
  onNavigateUp,
  isFlattenView,
  onToggleFlattenView,
  totalCount,
  imageCount,
  videoCount,
}: ExplorerToolbarProps) {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-border">
      {currentPath && (
        <Button
          onClick={onNavigateUp}
          variant="ghost"
          size="md"
          className="flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>返回</span>
        </Button>
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
          <Input
            placeholder="搜索文件..."
            value={filter.search}
            onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
            className="h-8 pl-9 pr-4"
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          onClick={() => onFilterChange({ ...filter, type: 'all' })}
          variant={filter.type === 'all' ? 'default' : 'ghost'}
          size="md"
          className={`flex items-center gap-1 ${
            filter.type === 'all' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
        >
          <Files className="w-4 h-4" />
          <span>全部</span>
          <span className="text-xs opacity-80">({formatCount(totalCount)})</span>
        </Button>
        <Button
          onClick={() => onFilterChange({ ...filter, type: 'image' })}
          variant={filter.type === 'image' ? 'default' : 'ghost'}
          size="md"
          className={`flex items-center gap-1 ${
            filter.type === 'image' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
        >
          <Image className="w-4 h-4" />
          <span>图片</span>
          <span className="text-xs opacity-80">({formatCount(imageCount)})</span>
        </Button>
        <Button
          onClick={() => onFilterChange({ ...filter, type: 'video' })}
          variant={filter.type === 'video' ? 'default' : 'ghost'}
          size="md"
          className={`flex items-center gap-1 ${
            filter.type === 'video' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
        >
          <Video className="w-4 h-4" />
          <span>视频</span>
          <span className="text-xs opacity-80">({formatCount(videoCount)})</span>
        </Button>
      </div>

      <Button
        onClick={() => onFilterChange({ ...filter, hideEmptyFolders: !filter.hideEmptyFolders })}
        variant={filter.hideEmptyFolders ? 'default' : 'ghost'}
        size="md"
        className={`${
          filter.hideEmptyFolders ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
        }`}
        title="隐藏空文件夹"
      >
        隐藏空文件夹
      </Button>

      <Button
        onClick={onToggleFlattenView}
        variant={isFlattenView ? 'default' : 'ghost'}
        size="md"
        className={`flex items-center gap-1 ${
          isFlattenView ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
        }`}
        title="平铺显示当前目录及其子目录中的所有文件"
      >
        <Rows3 className="w-4 h-4" />
        <span>平铺视图</span>
      </Button>

      <Select
        value={filter.sortBy}
        onChange={(e) => onFilterChange({ ...filter, sortBy: e.target.value as FilterState['sortBy'] })}
        className="h-8"
      >
        <option value="name">名称</option>
        <option value="date">日期</option>
        <option value="size">大小</option>
      </Select>

      <Button
        onClick={() => onFilterChange({ ...filter, sortOrder: filter.sortOrder === 'asc' ? 'desc' : 'asc' })}
        variant="ghost"
        size="icon"
        title={filter.sortOrder === 'asc' ? '升序' : '降序'}
      >
        <ArrowUpDown className="w-4 h-4" />
      </Button>
    </div>
  )
}
