import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Copy,
  Star,
} from 'lucide-react'
import type {
  AddressPathHistoryEntry,
  FavoriteFolderEntry,
} from '@/types'
import {
  buildAddressBreadcrumbItems,
  resolveAddressCopyButtonView,
  resolveAddressDraftChangeIntent,
  resolveAddressSegmentDropdownToggleIntent,
  shouldShowAddressSuggestionPanel,
  sortAddressFavoriteFolders,
  sortAddressPathHistory,
  type AddressCopyState,
} from '@/features/explorer/lib/addressPathModel'
import {
  type ExplorerToolbarDisclosureAction,
  type ExplorerToolbarDisclosureState,
} from '@/features/explorer/lib/explorerToolbarDisclosureModel'
import { useExplorerToolbarAddressSuggestions } from '@/features/explorer/hooks/useExplorerToolbarAddressSuggestions'
import { useExplorerToolbarSegmentDropdowns } from '@/features/explorer/hooks/useExplorerToolbarSegmentDropdowns'
import { useExplorerToolbarAddressNavigation } from '@/features/explorer/hooks/useExplorerToolbarAddressNavigation'
import { useExplorerToolbarAddressEditKeyboard } from '@/features/explorer/hooks/useExplorerToolbarAddressEditKeyboard'
import {
  AddressHistoryDropdown,
  AddressSuggestionPanel,
  FavoriteFoldersDropdown,
  SegmentDirectoryDropdown,
} from '@/features/explorer/components/ExplorerToolbarAddressMenus'
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
  const [copyState, setCopyState] = useState<AddressCopyState>('idle')
  const {
    addressBarMode,
    draftPath,
    editError,
    openSegmentPath,
    isHistoryOpen,
    isFavoritesOpen,
  } = disclosureState

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
  const copyButtonView = resolveAddressCopyButtonView({
    rootLabel,
    currentPath,
    copyState,
  })

  const addressBarRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const setDraftPathValue = useCallback((nextDraftPath: string) => {
    onDisclosureAction({ type: 'set-draft-path', draftPath: nextDraftPath })
  }, [onDisclosureAction])

  const setEditErrorValue = useCallback((nextEditError: string | null) => {
    onDisclosureAction({ type: 'set-edit-error', editError: nextEditError })
  }, [onDisclosureAction])

  const {
    addressSuggestionSession,
    setActiveSuggestionIndex,
    resetAddressSuggestions,
  } = useExplorerToolbarAddressSuggestions({
    addressBarMode,
    draftPath,
    onListChildDirectories,
    rootId,
    rootLabel,
    sortedFavorites,
    sortedHistory,
    maxItems: MAX_ADDRESS_SUGGESTION_ITEMS,
  })
  const {
    readSegmentDropdownState,
    loadSegmentDirectories,
  } = useExplorerToolbarSegmentDropdowns({
    onListChildDirectories,
  })
  const {
    isNavigatingByAddressBar,
    navigateByAddressBar,
    submitAddressEdit,
    submitAddressSuggestion,
    navigateSegmentChild,
    navigateHistoryEntry,
    openFavoriteFolder,
  } = useExplorerToolbarAddressNavigation({
    onNavigateToPath,
    onNavigateHistoryEntry,
    onOpenFavoriteFolder,
    onDisclosureAction,
    onEditErrorChange: setEditErrorValue,
    resetAddressSuggestions,
  })
  const {
    status: addressSuggestionStatus,
    items: addressSuggestions,
    errorMessage: addressSuggestionError,
    activeIndex: activeSuggestionIndex,
  } = addressSuggestionSession

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

  const enterEditMode = () => {
    onDisclosureAction({ type: 'enter-edit' })
  }

  const cancelEditMode = () => {
    onDisclosureAction({ type: 'cancel-edit' })
  }

  const handleToggleSegmentDropdown = async (path: string) => {
    const intent = resolveAddressSegmentDropdownToggleIntent({
      openSegmentPath,
      path,
    })
    onDisclosureAction({ type: 'toggle-segment', path: intent.path })
    if (intent.shouldLoadDirectories) {
      await loadSegmentDirectories(intent.path)
    }
  }

  const handleSubmitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitAddressEdit({
      activeIndex: activeSuggestionIndex,
      suggestions: addressSuggestions,
      draftPath,
    })
  }

  const handleToggleHistory = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDisclosureAction({ type: 'toggle-history' })
  }

  const handleToggleFavorites = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDisclosureAction({ type: 'toggle-favorites' })
  }

  const handleToggleCurrentFavorite = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggleCurrentPathFavorite()
  }

  const handleCopyPath = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard write not supported')
      }
      await navigator.clipboard.writeText(copyButtonView.copyText)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const handleAddressEditKeyDown = useExplorerToolbarAddressEditKeyboard({
    activeSuggestionIndex,
    suggestions: addressSuggestions,
    onCancelEdit: cancelEditMode,
    onDraftPathChange: setDraftPathValue,
    onActiveSuggestionIndexChange: setActiveSuggestionIndex,
  })

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
                  const intent = resolveAddressDraftChangeIntent({
                    draftPath: event.target.value,
                    hasEditError: Boolean(editError),
                  })
                  setDraftPathValue(intent.draftPath)
                  setActiveSuggestionIndex(intent.activeSuggestionIndex)
                  if (intent.editError !== undefined) {
                    setEditErrorValue(intent.editError)
                  }
                }}
                onKeyDown={(event) => {
                  handleAddressEditKeyDown(event)
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
                  <SegmentDirectoryDropdown
                    isOpen={openSegmentPath === item.path}
                    state={readSegmentDropdownState(item.path)}
                    onNavigateChild={(childName) => {
                      void navigateSegmentChild(item.path, childName)
                    }}
                  />
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
              <FavoriteFoldersDropdown
                isOpen={isFavoritesOpen}
                items={sortedFavorites}
                rootLabel={rootLabel}
                onOpenFavoriteFolder={openFavoriteFolder}
                onRemoveFavoriteFolder={onRemoveFavoriteFolder}
              />
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
              <AddressHistoryDropdown
                isOpen={isHistoryOpen}
                items={sortedHistory}
                rootLabel={rootLabel}
                onNavigateHistoryPath={navigateHistoryEntry}
              />
            </div>

            <Button
              onClick={handleCopyPath}
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={copyButtonView.title}
            >
              {copyButtonView.icon === 'check'
                ? <Check className="h-3.5 w-3.5" />
                : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        <AddressSuggestionPanel
          isVisible={shouldShowAddressSuggestionPanelValue}
          status={addressSuggestionStatus}
          errorMessage={addressSuggestionError}
          suggestions={addressSuggestions}
          activeIndex={activeSuggestionIndex}
          currentRootId={rootId}
          rootLabel={rootLabel}
          onActiveIndexChange={setActiveSuggestionIndex}
          onSubmitSuggestion={submitAddressSuggestion}
        />
        {editError && (
          <div className="absolute left-0 top-full mt-1 text-xs text-destructive">{editError}</div>
        )}
      </div>
    </>
  )
}
