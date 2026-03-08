import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Copy,
  Files,
  Image,
  Rows3,
  Search,
  Video,
} from 'lucide-react'
import type { AddressPathHistoryEntry, FilterState, ThumbnailSizePreset } from '@/types'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Select } from '@/ui/Select'

function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

type AddressBarMode = 'breadcrumb' | 'edit'

type SegmentDropdownStatus = 'idle' | 'loading' | 'ready' | 'error'

interface SegmentDropdownState {
  status: SegmentDropdownStatus
  items: string[]
  errorMessage: string | null
}

interface ExplorerToolbarProps {
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  rootName: string
  currentPath: string
  onNavigateToPath: (path: string) => Promise<boolean>
  onListChildDirectories: (path: string) => Promise<string[]>
  recentPathHistory: AddressPathHistoryEntry[]
  onNavigateUp: () => void
  isFlattenView: boolean
  onToggleFlattenView: () => void
  totalCount: number
  imageCount: number
  videoCount: number
  thumbnailSizePreset: ThumbnailSizePreset
  onThumbnailSizePresetChange: (preset: ThumbnailSizePreset) => void
}

function segmentKey(path: string): string {
  return path || '__root__'
}

function buildCopyPathText(rootLabel: string, relativePath: string): string {
  return relativePath ? `${rootLabel}/${relativePath}` : rootLabel
}

export function ExplorerToolbar({
  filter,
  onFilterChange,
  rootName,
  currentPath,
  onNavigateToPath,
  onListChildDirectories,
  recentPathHistory,
  onNavigateUp,
  isFlattenView,
  onToggleFlattenView,
  totalCount,
  imageCount,
  videoCount,
  thumbnailSizePreset,
  onThumbnailSizePresetChange,
}: ExplorerToolbarProps) {
  const [addressBarMode, setAddressBarMode] = useState<AddressBarMode>('breadcrumb')
  const [draftPath, setDraftPath] = useState(currentPath)
  const [editError, setEditError] = useState<string | null>(null)
  const [openSegmentPath, setOpenSegmentPath] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isNavigatingByAddressBar, setIsNavigatingByAddressBar] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [segmentDropdownStateByPath, setSegmentDropdownStateByPath] = useState<Record<string, SegmentDropdownState>>({})

  const pathSegments = currentPath.split('/').filter(Boolean)
  const rootLabel = rootName || '根目录'
  const breadcrumbItems = useMemo(() => {
    return [
      { label: rootLabel, path: '' },
      ...pathSegments.map((segment, index) => ({
        label: segment,
        path: pathSegments.slice(0, index + 1).join('/'),
      })),
    ]
  }, [pathSegments, rootLabel])

  const sortedHistory = useMemo(() => {
    return [...recentPathHistory].sort((left, right) => right.visitedAt - left.visitedAt)
  }, [recentPathHistory])

  const addressBarRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addressBarMode !== 'breadcrumb') return
    setDraftPath(currentPath)
    setEditError(null)
  }, [addressBarMode, currentPath])

  useEffect(() => {
    if (addressBarMode !== 'edit') return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [addressBarMode])

  useEffect(() => {
    setOpenSegmentPath(null)
    setIsHistoryOpen(false)
  }, [currentPath])

  useEffect(() => {
    const handleGlobalPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (addressBarRef.current?.contains(target)) return
      setOpenSegmentPath(null)
      setIsHistoryOpen(false)
      if (addressBarMode === 'edit' && event.button === 0) {
        setAddressBarMode('breadcrumb')
        setDraftPath(currentPath)
        setEditError(null)
      }
    }

    window.addEventListener('mousedown', handleGlobalPointerDown)
    return () => window.removeEventListener('mousedown', handleGlobalPointerDown)
  }, [addressBarMode, currentPath])

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 1200)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const enterEditMode = () => {
    setAddressBarMode('edit')
    setDraftPath(currentPath)
    setEditError(null)
    setOpenSegmentPath(null)
    setIsHistoryOpen(false)
  }

  const cancelEditMode = () => {
    setAddressBarMode('breadcrumb')
    setDraftPath(currentPath)
    setEditError(null)
  }

  const navigateByAddressBar = async (path: string): Promise<boolean> => {
    setIsNavigatingByAddressBar(true)
    try {
      const ok = await onNavigateToPath(path)
      if (ok) {
        setEditError(null)
      }
      return ok
    } finally {
      setIsNavigatingByAddressBar(false)
    }
  }

  const loadSegmentDirectories = async (path: string): Promise<void> => {
    const key = segmentKey(path)
    setSegmentDropdownStateByPath((previous) => ({
      ...previous,
      [key]: {
        status: 'loading',
        items: [],
        errorMessage: null,
      },
    }))

    try {
      const directories = await onListChildDirectories(path)
      setSegmentDropdownStateByPath((previous) => ({
        ...previous,
        [key]: {
          status: 'ready',
          items: directories,
          errorMessage: null,
        },
      }))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '读取子目录失败'
      setSegmentDropdownStateByPath((previous) => ({
        ...previous,
        [key]: {
          status: 'error',
          items: [],
          errorMessage,
        },
      }))
    }
  }

  const handleToggleSegmentDropdown = async (path: string) => {
    if (openSegmentPath === path) {
      setOpenSegmentPath(null)
      return
    }

    setOpenSegmentPath(path)
    setIsHistoryOpen(false)
    await loadSegmentDirectories(path)
  }

  const handleSegmentNavigate = async (segmentPath: string, childName: string) => {
    const nextPath = segmentPath ? `${segmentPath}/${childName}` : childName
    const ok = await navigateByAddressBar(nextPath)
    if (!ok) return
    setAddressBarMode('breadcrumb')
    setOpenSegmentPath(null)
  }

  const handleSubmitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const ok = await navigateByAddressBar(draftPath)
    if (ok) {
      setAddressBarMode('breadcrumb')
      return
    }
    setEditError('路径无效或不可访问')
  }

  const handleToggleHistory = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setOpenSegmentPath(null)
    setIsHistoryOpen((previous) => !previous)
  }

  const handleNavigateHistoryPath = async (path: string) => {
    const ok = await navigateByAddressBar(path)
    if (!ok) return
    setAddressBarMode('breadcrumb')
    setIsHistoryOpen(false)
  }

  const handleCopyPath = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const copyText = buildCopyPathText(rootLabel, currentPath)

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard write not supported')
      }
      await navigator.clipboard.writeText(copyText)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const renderSegmentDropdown = (path: string) => {
    if (openSegmentPath !== path) return null

    const state = segmentDropdownStateByPath[segmentKey(path)]
      ?? { status: 'idle' as const, items: [], errorMessage: null }

    return (
      <div
        className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-background p-1 shadow-md"
        onClick={(event) => event.stopPropagation()}
      >
        {state.status === 'loading' && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">加载中...</div>
        )}
        {state.status === 'error' && (
          <div className="px-2 py-1.5 text-xs text-destructive" title={state.errorMessage ?? undefined}>
            读取失败
          </div>
        )}
        {state.status === 'ready' && state.items.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">无子目录</div>
        )}
        {state.status === 'ready' && state.items.length > 0 && (
          <div className="max-h-56 overflow-auto">
            {state.items.map((item) => (
              <button
                key={item}
                type="button"
                className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                title={item}
                onClick={() => {
                  void handleSegmentNavigate(path, item)
                }}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

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

      <div ref={addressBarRef} className="relative min-w-0 flex-1">
        <div className="flex min-h-9 min-w-0 items-center gap-1 rounded-md border border-border bg-background px-2">
          {addressBarMode === 'edit' ? (
            <form className="flex w-full min-w-0 items-center gap-2" onSubmit={handleSubmitEdit}>
              <Input
                ref={inputRef}
                value={draftPath}
                onChange={(event) => {
                  setDraftPath(event.target.value)
                  if (editError) {
                    setEditError(null)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEditMode()
                  }
                }}
                className="h-7 min-w-0 flex-1"
                placeholder="输入相对路径"
                disabled={isNavigatingByAddressBar}
              />
            </form>
          ) : (
            <div
              className="flex min-w-0 flex-1 items-center text-sm"
              onClick={enterEditMode}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  enterEditMode()
                }
              }}
              title="点击空白区域可编辑路径"
            >
              {breadcrumbItems.map((item, index) => (
                <div key={item.path || '__root'} className="relative flex min-w-0 items-center">
                  {index > 0 && <span className="px-1 text-muted-foreground">/</span>}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void navigateByAddressBar(item.path)
                    }}
                    className={`max-w-40 truncate rounded px-2 py-1 transition-colors hover:bg-accent ${
                      index === breadcrumbItems.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'
                    }`}
                    title={item.path || rootLabel}
                  >
                    {item.label}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleToggleSegmentDropdown(item.path)
                    }}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="展开子目录"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {renderSegmentDropdown(item.path)}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1">
            <div className="relative">
              <Button
                onClick={handleToggleHistory}
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="最近路径"
              >
                <Clock3 className="h-3.5 w-3.5" />
              </Button>
              {isHistoryOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 w-72 rounded-md border border-border bg-background p-1 shadow-md"
                  onClick={(event) => event.stopPropagation()}
                >
                  {sortedHistory.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无历史路径</div>
                  ) : (
                    <div className="max-h-64 overflow-auto">
                      {sortedHistory.map((item) => {
                        const displayPath = buildCopyPathText(rootLabel, item.path)
                        return (
                          <button
                            key={`${item.path}:${item.visitedAt}`}
                            type="button"
                            onClick={() => {
                              void handleNavigateHistoryPath(item.path)
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                            title={displayPath}
                          >
                            <div className="truncate text-sm">{displayPath}</div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <Button
              onClick={handleCopyPath}
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制当前路径'}
            >
              {copyState === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        {editError && (
          <div className="absolute left-0 top-full mt-1 text-xs text-destructive">{editError}</div>
        )}
      </div>

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

      <Select
        value={thumbnailSizePreset}
        onChange={(e) => onThumbnailSizePresetChange(e.target.value as ThumbnailSizePreset)}
        className="h-8"
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
    </div>
  )
}
