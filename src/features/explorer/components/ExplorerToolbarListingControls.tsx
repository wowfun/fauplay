import {
  ArrowUpDown,
  Files,
  Image,
  Rows3,
  Search,
  Video,
} from 'lucide-react'
import {
  type AnnotationFilterTagOption,
  type FilterState,
  type ThumbnailSizePreset,
} from '@/types'
import { ExplorerToolbarAnnotationFilterControls } from '@/features/explorer/components/ExplorerToolbarAnnotationFilterControls'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Select } from '@/ui/Select'

interface ExplorerToolbarListingControlsProps {
  toolbarKind: 'wide' | 'compact'
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  totalCount: number
  imageCount: number
  videoCount: number
  showAnnotationFilterControls: boolean
  annotationFilterTagOptions: AnnotationFilterTagOption[]
  onOpenAnnotationFilterPanel: () => void
  thumbnailSizePreset: ThumbnailSizePreset
  onThumbnailSizePresetChange: (preset: ThumbnailSizePreset) => void
  isFlattenView: boolean
  onToggleFlattenView: () => void
}

function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

export function ExplorerToolbarListingControls({
  toolbarKind,
  filter,
  onFilterChange,
  totalCount,
  imageCount,
  videoCount,
  showAnnotationFilterControls,
  annotationFilterTagOptions,
  onOpenAnnotationFilterPanel,
  thumbnailSizePreset,
  onThumbnailSizePresetChange,
  isFlattenView,
  onToggleFlattenView,
}: ExplorerToolbarListingControlsProps) {
  return (
    <>
      <div className={toolbarKind === 'compact' ? 'flex w-full items-center gap-2' : 'flex items-center gap-2'}>
        <div className={toolbarKind === 'compact' ? 'relative min-w-0 flex-1' : 'relative'}>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索文件..."
            value={filter.search}
            onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
            className={toolbarKind === 'compact' ? 'h-8 w-full pl-9 pr-4' : 'h-8 pl-9 pr-4'}
          />
        </div>
      </div>

      <div className={toolbarKind === 'compact' ? 'flex w-full flex-wrap items-center gap-1' : 'flex items-center gap-1'}>
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

      {showAnnotationFilterControls && (
        <ExplorerToolbarAnnotationFilterControls
          toolbarKind={toolbarKind}
          filter={filter}
          onFilterChange={onFilterChange}
          annotationFilterTagOptions={annotationFilterTagOptions}
          onOpenAnnotationFilterPanel={onOpenAnnotationFilterPanel}
        />
      )}

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
        className={toolbarKind === 'compact' ? 'h-8 min-w-[92px]' : 'h-8'}
      >
        <option value="name">名称</option>
        <option value="date">日期</option>
        <option value="size">大小</option>
        <option value="annotationTime">标注时间</option>
      </Select>

      <Select
        value={thumbnailSizePreset}
        onChange={(e) => onThumbnailSizePresetChange(e.target.value as ThumbnailSizePreset)}
        className={toolbarKind === 'compact' ? 'h-8 min-w-[120px]' : 'h-8'}
        title="缩略图尺寸"
      >
        <option value="auto">缩略图：默认</option>
        <option value="256">缩略图：256</option>
        <option value="512">缩略图：512</option>
      </Select>

      <Button
        onClick={() => onFilterChange({ ...filter, sortOrder: filter.sortOrder === 'asc' ? 'desc' : 'asc' })}
        variant="ghost"
        size="icon"
        title={filter.sortOrder === 'asc' ? '升序' : '降序'}
      >
        <ArrowUpDown className="w-4 h-4" />
      </Button>
    </>
  )
}
