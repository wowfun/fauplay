import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Copy,
  Star,
  X,
} from 'lucide-react'
import type {
  AddressPathHistoryEntry,
  FavoriteFolderEntry,
} from '@/types'
import {
  type AddressSuggestionItem,
  buildAddressBreadcrumbItems,
  buildAddressSuggestionDisplayPath,
  buildRootPathDisplayText,
  createAddressChildPath,
  getAddressSuggestionSourceLabel,
  moveAddressSuggestionIndex,
  resolveAddressSuggestionCompletionIndex,
  shouldShowAddressSuggestionPanel,
  sortAddressFavoriteFolders,
  sortAddressPathHistory,
} from '@/features/explorer/lib/addressPathModel'
import {
  type ExplorerToolbarDisclosureAction,
  type ExplorerToolbarDisclosureState,
} from '@/features/explorer/lib/explorerToolbarDisclosureModel'
import {
  createIdleAddressSuggestionSessionState,
  getSegmentDropdownState,
  resolveAddressSuggestionLoadErrorState,
  resolveAddressSuggestionLoadStartState,
  resolveAddressSuggestionLoadSuccessState,
  resolveAddressSuggestionLookupPath,
  resolveSegmentDropdownLoadErrorState,
  resolveSegmentDropdownLoadStartState,
  resolveSegmentDropdownLoadSuccessState,
  toAddressTaskErrorMessage,
  type SegmentDropdownStateByPath,
} from '@/features/explorer/lib/explorerToolbarAddressBarModel'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'

interface ExplorerToolbarAddressBarProps {
  toolbarKind: 'wide' | 'compact'
  disclosureState: ExplorerToolbarDisclosureState
  onDisclosureAction: (action: ExplorerToolbarDisclosureAction) => void
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
}

const MAX_ADDRESS_SUGGESTION_ITEMS = 12

export function ExplorerToolbarAddressBar({
  toolbarKind,
  disclosureState,
  onDisclosureAction,
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
}: ExplorerToolbarAddressBarProps) {
  const [isNavigatingByAddressBar, setIsNavigatingByAddressBar] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [segmentDropdownStateByPath, setSegmentDropdownStateByPath] = useState<SegmentDropdownStateByPath>({})
  const [addressSuggestionSession, setAddressSuggestionSession] = useState(createIdleAddressSuggestionSessionState)
  const {
    addressBarMode,
    draftPath,
    editError,
    openSegmentPath,
    isHistoryOpen,
    isFavoritesOpen,
  } = disclosureState
  const {
    status: addressSuggestionStatus,
    items: addressSuggestions,
    errorMessage: addressSuggestionError,
    activeIndex: activeSuggestionIndex,
  } = addressSuggestionSession

  const rootLabel = rootName || '根目录'
  const breadcrumbItems = useMemo(
    () => buildAddressBreadcrumbItems(rootLabel, currentPath),
    [currentPath, rootLabel],
  )
  const sortedHistory = useMemo(() => {
    return sortAddressPathHistory(recentPathHistory)
  }, [recentPathHistory])
  const sortedFavorites = useMemo(() => {
    return sortAddressFavoriteFolders(favoriteFolders)
  }, [favoriteFolders])

  const addressBarRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionRequestSeqRef = useRef(0)

  const setDraftPathValue = useCallback((nextDraftPath: string) => {
    onDisclosureAction({ type: 'set-draft-path', draftPath: nextDraftPath })
  }, [onDisclosureAction])

  const setEditErrorValue = useCallback((nextEditError: string | null) => {
    onDisclosureAction({ type: 'set-edit-error', editError: nextEditError })
  }, [onDisclosureAction])

  const setActiveSuggestionIndex = useCallback((nextActiveIndex: number | ((previous: number) => number)) => {
    setAddressSuggestionSession((previous) => ({
      ...previous,
      activeIndex: typeof nextActiveIndex === 'function'
        ? nextActiveIndex(previous.activeIndex)
        : nextActiveIndex,
    }))
  }, [])

  useEffect(() => {
    if (addressBarMode !== 'edit') return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [addressBarMode])

  useEffect(() => {
    const handleGlobalPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (addressBarRef.current?.contains(target)) return
      onDisclosureAction(event.button === 0
        ? { type: 'outside-address-click' }
        : { type: 'close-address-disclosures' })
    }

    window.addEventListener('mousedown', handleGlobalPointerDown)
    return () => window.removeEventListener('mousedown', handleGlobalPointerDown)
  }, [onDisclosureAction])

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 1200)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const loadAddressSuggestions = useCallback(async (draftValue: string): Promise<void> => {
    const requestSeq = ++suggestionRequestSeqRef.current
    const lookupPath = resolveAddressSuggestionLookupPath(draftValue)

    setAddressSuggestionSession(resolveAddressSuggestionLoadStartState())

    try {
      const childDirectories = await onListChildDirectories(lookupPath)
      if (requestSeq !== suggestionRequestSeqRef.current) return

      setAddressSuggestionSession(resolveAddressSuggestionLoadSuccessState({
        draftPath: draftValue,
        childDirectories,
        favoriteFolders: sortedFavorites,
        recentPathHistory: sortedHistory,
        currentRootId: rootId,
        currentRootLabel: rootLabel,
        maxItems: MAX_ADDRESS_SUGGESTION_ITEMS,
      }))
    } catch (error) {
      if (requestSeq !== suggestionRequestSeqRef.current) return
      setAddressSuggestionSession(resolveAddressSuggestionLoadErrorState(
        toAddressTaskErrorMessage(error, '读取补全候选失败'),
      ))
    }
  }, [onListChildDirectories, rootId, rootLabel, sortedFavorites, sortedHistory])

  useEffect(() => {
    if (addressBarMode !== 'edit') {
      setAddressSuggestionSession(createIdleAddressSuggestionSessionState())
      return
    }
    void loadAddressSuggestions(draftPath)
  }, [addressBarMode, draftPath, loadAddressSuggestions])

  const resetAddressSuggestions = () => {
    setAddressSuggestionSession(createIdleAddressSuggestionSessionState())
  }

  const enterEditMode = () => {
    onDisclosureAction({ type: 'enter-edit' })
  }

  const cancelEditMode = () => {
    onDisclosureAction({ type: 'cancel-edit' })
  }

  const navigateByAddressBar = async (path: string): Promise<boolean> => {
    setIsNavigatingByAddressBar(true)
    try {
      const ok = await onNavigateToPath(path)
      if (ok) {
        setEditErrorValue(null)
      }
      return ok
    } finally {
      setIsNavigatingByAddressBar(false)
    }
  }

  const loadSegmentDirectories = async (path: string): Promise<void> => {
    setSegmentDropdownStateByPath((previous) => resolveSegmentDropdownLoadStartState(previous, path))

    try {
      const directories = await onListChildDirectories(path)
      setSegmentDropdownStateByPath((previous) => (
        resolveSegmentDropdownLoadSuccessState(previous, path, directories)
      ))
    } catch (error) {
      setSegmentDropdownStateByPath((previous) => (
        resolveSegmentDropdownLoadErrorState(
          previous,
          path,
          toAddressTaskErrorMessage(error, '读取子目录失败'),
        )
      ))
    }
  }

  const handleToggleSegmentDropdown = async (path: string) => {
    if (openSegmentPath === path) {
      onDisclosureAction({ type: 'toggle-segment', path })
      return
    }

    onDisclosureAction({ type: 'toggle-segment', path })
    await loadSegmentDirectories(path)
  }

  const handleSegmentNavigate = async (segmentPath: string, childName: string) => {
    const nextPath = createAddressChildPath(segmentPath, childName)
    const ok = await navigateByAddressBar(nextPath)
    if (!ok) return
    onDisclosureAction({ type: 'segment-navigation-committed' })
  }

  const submitAddressPath = async (path: string): Promise<void> => {
    const ok = await navigateByAddressBar(path)
    if (!ok) {
      setEditErrorValue('路径无效或不可访问')
      return
    }
    onDisclosureAction({ type: 'cancel-edit' })
    resetAddressSuggestions()
  }

  const submitAddressSuggestion = async (suggestion: AddressSuggestionItem): Promise<void> => {
    if (suggestion.source === 'favorite' && suggestion.favoriteEntry) {
      const ok = await onOpenFavoriteFolder(suggestion.favoriteEntry)
      if (!ok) {
        setEditErrorValue('路径无效或不可访问')
        return
      }
      onDisclosureAction({ type: 'favorite-navigation-committed' })
      resetAddressSuggestions()
      return
    }

    if (suggestion.source === 'history' && suggestion.historyEntry) {
      const ok = await onNavigateHistoryEntry(suggestion.historyEntry)
      if (!ok) {
        setEditErrorValue('路径无效或不可访问')
        return
      }
      onDisclosureAction({ type: 'history-navigation-committed' })
      resetAddressSuggestions()
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
    onDisclosureAction({ type: 'toggle-history' })
  }

  const handleNavigateHistoryPath = async (entry: AddressPathHistoryEntry) => {
    const ok = await onNavigateHistoryEntry(entry)
    if (!ok) return
    onDisclosureAction({ type: 'history-navigation-committed' })
  }

  const handleToggleFavorites = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDisclosureAction({ type: 'toggle-favorites' })
  }

  const handleOpenFavoriteFolder = async (entry: FavoriteFolderEntry) => {
    const ok = await onOpenFavoriteFolder(entry)
    if (!ok) return
    onDisclosureAction({ type: 'favorite-navigation-committed' })
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
    const copyText = buildRootPathDisplayText(rootLabel, currentPath)

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

    const state = getSegmentDropdownState(segmentDropdownStateByPath, path)

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

  const shouldShowAddressSuggestionPanelValue = shouldShowAddressSuggestionPanel(
    addressBarMode,
    addressSuggestionStatus,
    addressSuggestions.length,
  )

  return (
    <>
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

      <div
        ref={addressBarRef}
        className={toolbarKind === 'compact' ? 'relative min-w-0 basis-full' : 'relative min-w-0 flex-1'}
      >
        <div className="flex min-h-9 min-w-0 items-center gap-1 rounded-md border border-border bg-background px-2">
          {addressBarMode === 'edit' ? (
            <form className="flex w-full min-w-0 items-center gap-2" onSubmit={handleSubmitEdit}>
              <Input
                ref={inputRef}
                value={draftPath}
                onChange={(event) => {
                  setDraftPathValue(event.target.value)
                  setActiveSuggestionIndex(-1)
                  if (editError) {
                    setEditErrorValue(null)
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
                    setActiveSuggestionIndex((previous) => (
                      moveAddressSuggestionIndex(previous, addressSuggestions.length, 'next')
                    ))
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    if (addressSuggestions.length === 0) return
                    event.preventDefault()
                    setActiveSuggestionIndex((previous) => (
                      moveAddressSuggestionIndex(previous, addressSuggestions.length, 'previous')
                    ))
                    return
                  }
                  if (event.key === 'Tab') {
                    if (addressSuggestions.length === 0) return
                    event.preventDefault()
                    const targetIndex = resolveAddressSuggestionCompletionIndex(
                      activeSuggestionIndex,
                      addressSuggestions.length,
                    )
                    if (targetIndex === null) return
                    const target = addressSuggestions[targetIndex]
                    if (!target) return
                    setDraftPathValue(target.path)
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
                        const displayPath = buildRootPathDisplayText(item.rootName || rootLabel, item.path)
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
                        const displayPath = buildRootPathDisplayText(item.rootName || rootLabel, item.path)
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
        {shouldShowAddressSuggestionPanelValue && (
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
                        {getAddressSuggestionSourceLabel(item.source)}
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
    </>
  )
}
