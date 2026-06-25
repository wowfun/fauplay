import { X } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type {
  AddressPathHistoryEntry,
  FavoriteFolderEntry,
} from '@/types'
import {
  buildAddressSuggestionDisplayPath,
  buildRootPathDisplayText,
  getAddressSuggestionSourceLabel,
  type AddressSuggestionItem,
  type AddressSuggestionStatus,
} from '@/features/explorer/lib/addressPathModel'
import type { SegmentDropdownState } from '@/features/explorer/lib/explorerToolbarAddressBarModel'

interface SegmentDirectoryDropdownProps {
  isOpen: boolean
  state: SegmentDropdownState
  onNavigateChild: (childName: string) => void
}

interface FavoriteFoldersDropdownProps {
  isOpen: boolean
  items: FavoriteFolderEntry[]
  rootLabel: string
  onOpenFavoriteFolder: (entry: FavoriteFolderEntry) => void | Promise<unknown>
  onRemoveFavoriteFolder: (entry: FavoriteFolderEntry) => void
}

interface AddressHistoryDropdownProps {
  isOpen: boolean
  items: AddressPathHistoryEntry[]
  rootLabel: string
  onNavigateHistoryPath: (entry: AddressPathHistoryEntry) => void | Promise<unknown>
}

interface AddressSuggestionPanelProps {
  isVisible: boolean
  status: AddressSuggestionStatus
  errorMessage: string | null
  suggestions: AddressSuggestionItem[]
  activeIndex: number
  currentRootId?: string | null
  rootLabel: string
  onActiveIndexChange: (activeIndex: number) => void
  onSubmitSuggestion: (suggestion: AddressSuggestionItem) => void | Promise<unknown>
}

export function SegmentDirectoryDropdown({
  isOpen,
  state,
  onNavigateChild,
}: SegmentDirectoryDropdownProps) {
  if (!isOpen) return null

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
              onClick={() => onNavigateChild(item)}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function FavoriteFoldersDropdown({
  isOpen,
  items,
  rootLabel,
  onOpenFavoriteFolder,
  onRemoveFavoriteFolder,
}: FavoriteFoldersDropdownProps) {
  if (!isOpen) return null

  return (
    <div
      className="absolute right-0 top-full z-30 mt-1 w-80 rounded-md border border-border bg-background p-1 shadow-md"
      onClick={(event) => event.stopPropagation()}
    >
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无收藏目录</div>
      ) : (
        <div className="max-h-64 overflow-auto">
          {items.map((item) => {
            const displayPath = buildRootPathDisplayText(item.rootName || rootLabel, item.path)
            return (
              <div
                key={`${item.rootId}:${item.path}`}
                className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => {
                    void onOpenFavoriteFolder(item)
                  }}
                  className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-sm"
                  title={displayPath}
                >
                  {displayPath}
                </button>
                <button
                  type="button"
                  onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation()
                    onRemoveFavoriteFolder(item)
                  }}
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
  )
}

export function AddressHistoryDropdown({
  isOpen,
  items,
  rootLabel,
  onNavigateHistoryPath,
}: AddressHistoryDropdownProps) {
  if (!isOpen) return null

  return (
    <div
      className="absolute right-0 top-full z-30 mt-1 w-72 rounded-md border border-border bg-background p-1 shadow-md"
      onClick={(event) => event.stopPropagation()}
    >
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无历史路径</div>
      ) : (
        <div className="max-h-64 overflow-auto">
          {items.map((item) => {
            const displayPath = buildRootPathDisplayText(item.rootName || rootLabel, item.path)
            return (
              <button
                key={`${item.rootId}:${item.path}:${item.visitedAt}`}
                type="button"
                onClick={() => {
                  void onNavigateHistoryPath(item)
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
  )
}

export function AddressSuggestionPanel({
  isVisible,
  status,
  errorMessage,
  suggestions,
  activeIndex,
  currentRootId,
  rootLabel,
  onActiveIndexChange,
  onSubmitSuggestion,
}: AddressSuggestionPanelProps) {
  if (!isVisible) return null

  return (
    <div
      className="absolute left-0 top-full z-30 mt-1 w-full rounded-md border border-border bg-background p-1 shadow-md"
      onClick={(event) => event.stopPropagation()}
    >
      {status === 'loading' && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">补全加载中...</div>
      )}
      {status === 'error' && (
        <div className="px-2 py-1.5 text-xs text-destructive" title={errorMessage ?? undefined}>
          读取补全失败
        </div>
      )}
      {status === 'ready' && suggestions.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">无匹配路径</div>
      )}
      {status === 'ready' && suggestions.length > 0 && (
        <div className="max-h-64 overflow-auto">
          {suggestions.map((item, index) => (
            <button
              key={`${item.source}:${item.rootId || '__current__'}:${item.path}`}
              type="button"
              className={`block w-full rounded px-2 py-1.5 text-left ${
                index === activeIndex ? 'bg-accent' : 'hover:bg-accent'
              }`}
              onMouseEnter={() => onActiveIndexChange(index)}
              onClick={() => {
                void onSubmitSuggestion(item)
              }}
              title={buildAddressSuggestionDisplayPath(item, currentRootId, rootLabel)}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {buildAddressSuggestionDisplayPath(item, currentRootId, rootLabel)}
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
  )
}
