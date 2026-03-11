import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
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
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import type { AddressPathHistoryEntry, FavoriteFolderEntry, FilterState, ThumbnailSizePreset } from '@/types'
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
  rootId?: string | null
  rootName: string
  currentPath: string
  onNavigateToPath: (path: string) => Promise<boolean>
  onNavigateHistoryEntry: (entry: AddressPathHistoryEntry) => Promise<boolean>
  onListChildDirectories: (path: string) => Promise<string[]>
  recentPathHistory: AddressPathHistoryEntry[]
  favoriteFolders: FavoriteFolderEntry[]
  isCurrentPathFavorited: boolean
  onOpenFavoriteFolder: (entry: FavoriteFolderEntry) => Promise<boolean>
  onRemoveFavoriteFolder: (entry: FavoriteFolderEntry) => void
  onToggleCurrentPathFavorite: () => void
  onNavigateUp: () => void
  isFlattenView: boolean
  onToggleFlattenView: () => void
  totalCount: number
  imageCount: number
  videoCount: number
  thumbnailSizePreset: ThumbnailSizePreset
  onThumbnailSizePresetChange: (preset: ThumbnailSizePreset) => void
  canOpenTrash: boolean
  onOpenTrash: () => void
}

function segmentKey(path: string): string {
  return path || '__root__'
}

function buildCopyPathText(rootLabel: string, relativePath: string): string {
  return relativePath ? `${rootLabel}/${relativePath}` : rootLabel
}

function suggestionSourceLabel(source: AddressSuggestionSource): string {
  if (source === 'directory') return '目录'
  if (source === 'favorite') return '收藏'
  return '历史'
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function toLower(value: string): string {
  return value.toLocaleLowerCase()
}

interface DraftPathSuggestionContext {
  basePath: string
  prefix: string
  normalizedInput: string
  hasTrailingSlash: boolean
}

function parseDraftPathSuggestionContext(path: string): DraftPathSuggestionContext {
  const hasTrailingSlash = path.endsWith('/')
  const segments = path.split('/').filter(Boolean)
  if (hasTrailingSlash) {
    return {
      basePath: segments.join('/'),
      prefix: '',
      normalizedInput: normalizeRelativePath(path),
      hasTrailingSlash,
    }
  }
  if (segments.length === 0) {
    return {
      basePath: '',
      prefix: '',
      normalizedInput: '',
      hasTrailingSlash,
    }
  }

  const prefix = segments[segments.length - 1] ?? ''
  return {
    basePath: segments.slice(0, -1).join('/'),
    prefix,
    normalizedInput: normalizeRelativePath(path),
    hasTrailingSlash,
  }
}

function buildAddressSuggestionDisplayPath(
  suggestion: AddressSuggestionItem,
  currentRootId: string | null | undefined,
  currentRootLabel: string
): string {
  const isCrossRoot = (
    suggestion.rootId
    && currentRootId
    && suggestion.rootId !== currentRootId
  )
  if (!isCrossRoot) {
    return suggestion.path || currentRootLabel
  }

  const targetRootLabel = suggestion.rootName || currentRootLabel
  return suggestion.path ? `${targetRootLabel}/${suggestion.path}` : targetRootLabel
}

type AddressSuggestionSource = 'directory' | 'favorite' | 'history'

interface AddressSuggestionItem {
  path: string
  source: AddressSuggestionSource
  rootId: string | null
  rootName: string
  favoriteEntry: FavoriteFolderEntry | null
  historyEntry: AddressPathHistoryEntry | null
}

type AddressSuggestionStatus = 'idle' | 'loading' | 'ready' | 'error'

const MAX_ADDRESS_SUGGESTION_ITEMS = 12

export function ExplorerToolbar({
  filter,
  onFilterChange,
  rootId,
  rootName,
  currentPath,
  onNavigateToPath,
  onNavigateHistoryEntry,
  onListChildDirectories,
  recentPathHistory,
  favoriteFolders,
  isCurrentPathFavorited,
  onOpenFavoriteFolder,
  onRemoveFavoriteFolder,
  onToggleCurrentPathFavorite,
  onNavigateUp,
  isFlattenView,
  onToggleFlattenView,
  totalCount,
  imageCount,
  videoCount,
  thumbnailSizePreset,
  onThumbnailSizePresetChange,
  canOpenTrash,
  onOpenTrash,
}: ExplorerToolbarProps) {
  const [addressBarMode, setAddressBarMode] = useState<AddressBarMode>('breadcrumb')
  const [draftPath, setDraftPath] = useState(currentPath)
  const [editError, setEditError] = useState<string | null>(null)
  const [openSegmentPath, setOpenSegmentPath] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false)
  const [isNavigatingByAddressBar, setIsNavigatingByAddressBar] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [segmentDropdownStateByPath, setSegmentDropdownStateByPath] = useState<Record<string, SegmentDropdownState>>({})
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestionItem[]>([])
  const [addressSuggestionStatus, setAddressSuggestionStatus] = useState<AddressSuggestionStatus>('idle')
  const [addressSuggestionError, setAddressSuggestionError] = useState<string | null>(null)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)

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
  const sortedFavorites = useMemo(() => {
    return [...favoriteFolders].sort((left, right) => right.favoritedAt - left.favoritedAt)
  }, [favoriteFolders])

  const addressBarRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionRequestSeqRef = useRef(0)

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
    setIsFavoritesOpen(false)
  }, [currentPath])

  useEffect(() => {
    const handleGlobalPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (addressBarRef.current?.contains(target)) return
      setOpenSegmentPath(null)
      setIsHistoryOpen(false)
      setIsFavoritesOpen(false)
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

  const loadAddressSuggestions = useCallback(async (draftValue: string): Promise<void> => {
    const requestSeq = ++suggestionRequestSeqRef.current
    const context = parseDraftPathSuggestionContext(draftValue)
    const { basePath, prefix, normalizedInput, hasTrailingSlash } = context

    setAddressSuggestionStatus('loading')
    setAddressSuggestionError(null)

    const prefixLower = toLower(prefix)
    const normalizedInputLower = toLower(normalizedInput)

    const matchPathByInput = (candidatePath: string): boolean => {
      const normalizedCandidatePath = normalizeRelativePath(candidatePath)
      if (!normalizedInputLower) return true
      if (!toLower(normalizedCandidatePath).startsWith(normalizedInputLower)) return false
      if (hasTrailingSlash && normalizedCandidatePath === normalizedInput) return false
      return true
    }

    try {
      const childDirectories = await onListChildDirectories(basePath)
      if (requestSeq !== suggestionRequestSeqRef.current) return

      const directorySuggestions = childDirectories
        .filter((name) => !prefixLower || toLower(name).startsWith(prefixLower))
        .map<AddressSuggestionItem>((name) => ({
          path: basePath ? `${basePath}/${name}` : name,
          source: 'directory',
          rootId: rootId ?? null,
          rootName: rootLabel,
          favoriteEntry: null,
          historyEntry: null,
        }))

      const favoriteSuggestions = sortedFavorites
        .filter((item) => matchPathByInput(item.path))
        .map<AddressSuggestionItem>((item) => ({
          path: normalizeRelativePath(item.path),
          source: 'favorite',
          rootId: item.rootId,
          rootName: item.rootName || rootLabel,
          favoriteEntry: item,
          historyEntry: null,
        }))

      const historySuggestions = sortedHistory
        .filter((item) => matchPathByInput(item.path))
        .map<AddressSuggestionItem>((item) => ({
          path: normalizeRelativePath(item.path),
          source: 'history',
          rootId: item.rootId,
          rootName: item.rootName || rootLabel,
          favoriteEntry: null,
          historyEntry: item,
        }))

      const dedupedSuggestions: AddressSuggestionItem[] = []
      const seenPathSet = new Set<string>()
      for (const candidate of [...directorySuggestions, ...favoriteSuggestions, ...historySuggestions]) {
        const normalizedCandidatePath = normalizeRelativePath(candidate.path)
        if (!normalizedCandidatePath && normalizedInput) continue
        const key = `${candidate.rootId || '__current__'}:${normalizedCandidatePath}`
        if (seenPathSet.has(key)) continue
        seenPathSet.add(key)
        dedupedSuggestions.push({
          ...candidate,
          path: normalizedCandidatePath,
        })
        if (dedupedSuggestions.length >= MAX_ADDRESS_SUGGESTION_ITEMS) break
      }

      setAddressSuggestions(dedupedSuggestions)
      setAddressSuggestionStatus('ready')
      setAddressSuggestionError(null)
      setActiveSuggestionIndex(-1)
    } catch (error) {
      if (requestSeq !== suggestionRequestSeqRef.current) return
      const message = error instanceof Error ? error.message : '读取补全候选失败'
      setAddressSuggestions([])
      setAddressSuggestionStatus('error')
      setAddressSuggestionError(message)
      setActiveSuggestionIndex(-1)
    }
  }, [onListChildDirectories, rootId, rootLabel, sortedFavorites, sortedHistory])

  useEffect(() => {
    if (addressBarMode !== 'edit') {
      setAddressSuggestionStatus('idle')
      setAddressSuggestionError(null)
      setAddressSuggestions([])
      setActiveSuggestionIndex(-1)
      return
    }
    void loadAddressSuggestions(draftPath)
  }, [addressBarMode, draftPath, loadAddressSuggestions])

  const enterEditMode = () => {
    setAddressBarMode('edit')
    setDraftPath(currentPath)
    setEditError(null)
    setOpenSegmentPath(null)
    setIsHistoryOpen(false)
    setIsFavoritesOpen(false)
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
    setIsFavoritesOpen(false)
    await loadSegmentDirectories(path)
  }

  const handleSegmentNavigate = async (segmentPath: string, childName: string) => {
    const nextPath = segmentPath ? `${segmentPath}/${childName}` : childName
    const ok = await navigateByAddressBar(nextPath)
    if (!ok) return
    setAddressBarMode('breadcrumb')
    setOpenSegmentPath(null)
  }

  const submitAddressPath = async (path: string): Promise<void> => {
    const ok = await navigateByAddressBar(path)
    if (!ok) {
      setEditError('路径无效或不可访问')
      return
    }
    setAddressBarMode('breadcrumb')
    setAddressSuggestionStatus('idle')
    setAddressSuggestionError(null)
    setAddressSuggestions([])
    setActiveSuggestionIndex(-1)
  }

  const submitAddressSuggestion = async (suggestion: AddressSuggestionItem): Promise<void> => {
    if (suggestion.source === 'favorite' && suggestion.favoriteEntry) {
      const ok = await onOpenFavoriteFolder(suggestion.favoriteEntry)
      if (!ok) {
        setEditError('路径无效或不可访问')
        return
      }
      setAddressBarMode('breadcrumb')
      setAddressSuggestionStatus('idle')
      setAddressSuggestionError(null)
      setAddressSuggestions([])
      setActiveSuggestionIndex(-1)
      return
    }

    if (suggestion.source === 'history' && suggestion.historyEntry) {
      const ok = await onNavigateHistoryEntry(suggestion.historyEntry)
      if (!ok) {
        setEditError('路径无效或不可访问')
        return
      }
      setAddressBarMode('breadcrumb')
      setAddressSuggestionStatus('idle')
      setAddressSuggestionError(null)
      setAddressSuggestions([])
      setActiveSuggestionIndex(-1)
      return
    }

    await submitAddressPath(suggestion.path)
  }

  const handleSubmitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const hasActiveSuggestion = activeSuggestionIndex >= 0 && activeSuggestionIndex < addressSuggestions.length
    const targetSuggestion = hasActiveSuggestion ? addressSuggestions[activeSuggestionIndex] : null
    if (targetSuggestion) {
      await submitAddressSuggestion(targetSuggestion)
      return
    }
    await submitAddressPath(draftPath)
  }

  const handleToggleHistory = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setOpenSegmentPath(null)
    setIsFavoritesOpen(false)
    setIsHistoryOpen((previous) => !previous)
  }

  const handleNavigateHistoryPath = async (entry: AddressPathHistoryEntry) => {
    const ok = await onNavigateHistoryEntry(entry)
    if (!ok) return
    setAddressBarMode('breadcrumb')
    setIsHistoryOpen(false)
  }

  const handleToggleFavorites = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setOpenSegmentPath(null)
    setIsHistoryOpen(false)
    setIsFavoritesOpen((previous) => !previous)
  }

  const handleOpenFavoriteFolder = async (entry: FavoriteFolderEntry) => {
    const ok = await onOpenFavoriteFolder(entry)
    if (!ok) return
    setAddressBarMode('breadcrumb')
    setIsFavoritesOpen(false)
  }

  const handleRemoveFavoriteFolder = (event: ReactMouseEvent<HTMLButtonElement>, entry: FavoriteFolderEntry) => {
    event.stopPropagation()
    onRemoveFavoriteFolder(entry)
  }

  const handleToggleCurrentFavorite = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggleCurrentPathFavorite()
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

  const shouldShowAddressSuggestionPanel = addressBarMode === 'edit' && (
    addressSuggestionStatus === 'ready'
    || addressSuggestionStatus === 'loading'
    || addressSuggestionStatus === 'error'
    || addressSuggestions.length > 0
  )

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
                  setActiveSuggestionIndex(-1)
                  if (editError) {
                    setEditError(null)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEditMode()
                    return
                  }
                  if (event.key === 'ArrowDown') {
                    if (addressSuggestions.length === 0) return
                    event.preventDefault()
                    setActiveSuggestionIndex((previous) => {
                      if (previous < 0) return 0
                      return (previous + 1) % addressSuggestions.length
                    })
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    if (addressSuggestions.length === 0) return
                    event.preventDefault()
                    setActiveSuggestionIndex((previous) => {
                      if (previous < 0) return addressSuggestions.length - 1
                      return (previous - 1 + addressSuggestions.length) % addressSuggestions.length
                    })
                    return
                  }
                  if (event.key === 'Tab') {
                    if (addressSuggestions.length === 0) return
                    event.preventDefault()
                    const targetIndex = activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0
                    const target = addressSuggestions[targetIndex]
                    if (!target) return
                    setDraftPath(target.path)
                    setActiveSuggestionIndex(targetIndex)
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
            <Button
              onClick={handleToggleCurrentFavorite}
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={isCurrentPathFavorited ? '取消收藏当前目录' : '收藏当前目录'}
            >
              <Star
                className={`h-3.5 w-3.5 ${isCurrentPathFavorited ? 'fill-current text-amber-500' : ''}`}
              />
            </Button>

            <div className="relative">
              <Button
                onClick={handleToggleFavorites}
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="收藏夹"
              >
                <Star className="h-3.5 w-3.5" />
              </Button>
              {isFavoritesOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 w-80 rounded-md border border-border bg-background p-1 shadow-md"
                  onClick={(event) => event.stopPropagation()}
                >
                  {sortedFavorites.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无收藏目录</div>
                  ) : (
                    <div className="max-h-64 overflow-auto">
                      {sortedFavorites.map((item) => {
                        const displayPath = buildCopyPathText(item.rootName || rootLabel, item.path)
                        return (
                          <div
                            key={`${item.rootId}:${item.path}`}
                            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                void handleOpenFavoriteFolder(item)
                              }}
                              className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-sm"
                              title={displayPath}
                            >
                              {displayPath}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => handleRemoveFavoriteFolder(event, item)}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                              title="移除收藏"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

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
                        const displayPath = buildCopyPathText(item.rootName || rootLabel, item.path)
                        return (
                          <button
                            key={`${item.rootId}:${item.path}:${item.visitedAt}`}
                            type="button"
                            onClick={() => {
                              void handleNavigateHistoryPath(item)
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
        {shouldShowAddressSuggestionPanel && (
          <div
            className="absolute left-0 top-full z-30 mt-1 w-full rounded-md border border-border bg-background p-1 shadow-md"
            onClick={(event) => event.stopPropagation()}
          >
            {addressSuggestionStatus === 'loading' && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">补全加载中...</div>
            )}
            {addressSuggestionStatus === 'error' && (
              <div className="px-2 py-1.5 text-xs text-destructive" title={addressSuggestionError ?? undefined}>
                读取补全失败
              </div>
            )}
            {addressSuggestionStatus === 'ready' && addressSuggestions.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">无匹配路径</div>
            )}
            {addressSuggestionStatus === 'ready' && addressSuggestions.length > 0 && (
              <div className="max-h-64 overflow-auto">
                {addressSuggestions.map((item, index) => (
                  <button
                    key={`${item.source}:${item.rootId || '__current__'}:${item.path}`}
                    type="button"
                    className={`block w-full rounded px-2 py-1.5 text-left ${
                      index === activeSuggestionIndex ? 'bg-accent' : 'hover:bg-accent'
                    }`}
                    onMouseEnter={() => setActiveSuggestionIndex(index)}
                    onClick={() => {
                      void submitAddressSuggestion(item)
                    }}
                    title={buildAddressSuggestionDisplayPath(item, rootId, rootLabel)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {buildAddressSuggestionDisplayPath(item, rootId, rootLabel)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {suggestionSourceLabel(item.source)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {editError && (
          <div className="absolute left-0 top-full mt-1 text-xs text-destructive">{editError}</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={onOpenTrash}
          variant="ghost"
          size="md"
          className="flex items-center gap-1"
          disabled={!canOpenTrash}
          title={canOpenTrash ? '进入回收站' : '回收站为空或不可用'}
        >
          <Trash2 className="w-4 h-4" />
          <span>回收站</span>
        </Button>
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
