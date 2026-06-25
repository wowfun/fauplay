import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Info,
  LogOut,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  type AddressPathHistoryEntry,
  type AnnotationFilterTagOption,
  type FavoriteFolderEntry,
  type FilterState,
  type ThumbnailSizePreset,
} from '@/types'
import type { ShortcutHelpEntry } from '@/features/explorer/hooks/useShortcutHelpEntries'
import { ExplorerToolbarAddressBar } from '@/features/explorer/components/ExplorerToolbarAddressBar'
import { ToolbarShortcutHelpPanel } from '@/features/explorer/components/ToolbarShortcutHelpPanel'
import { ExplorerToolbarListingControls } from '@/features/explorer/components/ExplorerToolbarListingControls'
import {
  createExplorerToolbarDisclosureState,
  resolveExplorerToolbarDisclosureState,
  type ExplorerToolbarDisclosureAction,
} from '@/features/explorer/lib/explorerToolbarDisclosureModel'
import { Button } from '@/ui/Button'

interface ExplorerToolbarProps {
  accessProvider: 'local-browser' | 'remote-readonly'
  toolbarKind?: 'wide' | 'compact'
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  rootId?: string | null
  rootName: string
  currentPath: string
  onSwitchWorkspace?: () => void
  onForgetRemoteDevice?: () => void
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
  showAnnotationFilterControls: boolean
  annotationFilterTagOptions: AnnotationFilterTagOption[]
  onOpenAnnotationFilterPanel: () => void
  thumbnailSizePreset: ThumbnailSizePreset
  onThumbnailSizePresetChange: (preset: ThumbnailSizePreset) => void
  canOpenTrash: boolean
  onOpenTrash: () => void
  canOpenPeople: boolean
  onOpenPeople: () => void
  shortcutHelpEntries: ShortcutHelpEntry[]
}

export function ExplorerToolbar({
  accessProvider,
  toolbarKind = 'wide',
  filter,
  onFilterChange,
  rootId,
  rootName,
  currentPath,
  onSwitchWorkspace,
  onForgetRemoteDevice,
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
  showAnnotationFilterControls,
  annotationFilterTagOptions,
  onOpenAnnotationFilterPanel,
  thumbnailSizePreset,
  onThumbnailSizePresetChange,
  canOpenTrash,
  onOpenTrash,
  canOpenPeople,
  onOpenPeople,
  shortcutHelpEntries,
}: ExplorerToolbarProps) {
  const [disclosureState, setDisclosureState] = useState(() => createExplorerToolbarDisclosureState(currentPath))
  const { isHelpOpen } = disclosureState
  const helpPanelRef = useRef<HTMLDivElement>(null)

  const updateDisclosureState = useCallback((action: ExplorerToolbarDisclosureAction) => {
    setDisclosureState((previous) => resolveExplorerToolbarDisclosureState({
      state: previous,
      currentPath,
      action,
    }))
  }, [currentPath])

  useEffect(() => {
    updateDisclosureState({ type: 'current-path-changed' })
  }, [updateDisclosureState])

  useEffect(() => {
    const handleGlobalPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (helpPanelRef.current?.contains(target)) return
      updateDisclosureState({ type: 'close-help' })
    }

    window.addEventListener('mousedown', handleGlobalPointerDown)
    return () => window.removeEventListener('mousedown', handleGlobalPointerDown)
  }, [updateDisclosureState])

  useEffect(() => {
    if (!isHelpOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      updateDisclosureState({ type: 'close-help' })
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [isHelpOpen, updateDisclosureState])

  const handleToggleHelp = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    updateDisclosureState({ type: 'toggle-help' })
  }

  return (
    <div className={toolbarKind === 'compact'
      ? 'flex flex-wrap items-start gap-2 border-b border-border p-3'
      : 'flex items-center gap-4 border-b border-border p-4'}
    >
      <ExplorerToolbarAddressBar
        toolbarKind={toolbarKind}
        disclosureState={disclosureState}
        onDisclosureAction={updateDisclosureState}
        rootId={rootId}
        rootName={rootName}
        currentPath={currentPath}
        onNavigateToPath={onNavigateToPath}
        onNavigateHistoryEntry={onNavigateHistoryEntry}
        onListChildDirectories={onListChildDirectories}
        recentPathHistory={recentPathHistory}
        favoriteFolders={favoriteFolders}
        isCurrentPathFavorited={isCurrentPathFavorited}
        onOpenFavoriteFolder={onOpenFavoriteFolder}
        onRemoveFavoriteFolder={onRemoveFavoriteFolder}
        onToggleCurrentPathFavorite={onToggleCurrentPathFavorite}
        onNavigateUp={onNavigateUp}
      />

      <div className={toolbarKind === 'compact' ? 'flex flex-wrap items-center gap-2' : 'flex items-center gap-2'}>
        {onSwitchWorkspace && (
          <Button
            onClick={onSwitchWorkspace}
            variant="outline"
            size="md"
            className="flex items-center gap-1"
            title={accessProvider === 'remote-readonly' ? '断开远程并返回启动页，不忘记此设备' : '切换工作区'}
          >
            <LogOut className="w-4 h-4" />
            <span>{accessProvider === 'remote-readonly' ? '断开/切换' : '切换'}</span>
          </Button>
        )}
        {accessProvider === 'remote-readonly' && onForgetRemoteDevice && (
          <Button
            onClick={onForgetRemoteDevice}
            variant="ghost"
            size="md"
            className="flex items-center gap-1"
            title="撤销当前浏览器上的持久登录态"
          >
            <X className="w-4 h-4" />
            <span>忘记设备</span>
          </Button>
        )}
        <Button
          onClick={onOpenPeople}
          variant="ghost"
          size="md"
          className="flex items-center gap-1"
          disabled={!canOpenPeople}
          title={canOpenPeople ? '打开人物列表' : '人物功能不可用'}
        >
          <Users className="w-4 h-4" />
          <span>人物</span>
        </Button>
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
        <div ref={helpPanelRef} className="relative">
          <Button
            onClick={handleToggleHelp}
            variant={isHelpOpen ? 'outline' : 'ghost'}
            size="md"
            className="flex items-center gap-1"
            title="查看当前快捷键"
          >
            <Info className="w-4 h-4" />
            <span>帮助</span>
          </Button>
          {isHelpOpen && (
            <div onClick={(event) => event.stopPropagation()}>
              <ToolbarShortcutHelpPanel entries={shortcutHelpEntries} />
            </div>
          )}
        </div>
      </div>

      <ExplorerToolbarListingControls
        toolbarKind={toolbarKind}
        filter={filter}
        onFilterChange={onFilterChange}
        totalCount={totalCount}
        imageCount={imageCount}
        videoCount={videoCount}
        showAnnotationFilterControls={showAnnotationFilterControls}
        annotationFilterTagOptions={annotationFilterTagOptions}
        onOpenAnnotationFilterPanel={onOpenAnnotationFilterPanel}
        thumbnailSizePreset={thumbnailSizePreset}
        onThumbnailSizePresetChange={onThumbnailSizePresetChange}
        isFlattenView={isFlattenView}
        onToggleFlattenView={onToggleFlattenView}
      />
    </div>
  )
}
