import { useCallback, useState } from 'react'
import type { AddressPathHistoryEntry, FavoriteFolderEntry } from '@/types'
import {
  createAddressChildPath,
  type AddressSuggestionItem,
} from '@/features/explorer/lib/addressPathModel'
import type { ExplorerToolbarDisclosureAction } from '@/features/explorer/lib/explorerToolbarDisclosureModel'
import {
  resolveAddressSuggestionNavigationIntent,
  resolveAddressSuggestionSubmitTarget,
} from '@/features/explorer/lib/explorerToolbarAddressBarModel'

export interface SubmitAddressEditParams {
  activeIndex: number
  suggestions: AddressSuggestionItem[]
  draftPath: string
}

export interface UseExplorerToolbarAddressNavigationParams {
  onNavigateToPath: (path: string) => Promise<boolean>
  onNavigateHistoryEntry: (entry: AddressPathHistoryEntry) => Promise<boolean>
  onOpenFavoriteFolder: (entry: FavoriteFolderEntry) => Promise<boolean>
  onDisclosureAction: (action: ExplorerToolbarDisclosureAction) => void
  onEditErrorChange: (editError: string | null) => void
  resetAddressSuggestions: () => void
}

const ADDRESS_NAVIGATION_FAILURE_MESSAGE = '路径无效或不可访问'

export function useExplorerToolbarAddressNavigation({
  onNavigateToPath,
  onNavigateHistoryEntry,
  onOpenFavoriteFolder,
  onDisclosureAction,
  onEditErrorChange,
  resetAddressSuggestions,
}: UseExplorerToolbarAddressNavigationParams) {
  const [isNavigatingByAddressBar, setIsNavigatingByAddressBar] = useState(false)

  const navigateByAddressBar = useCallback(async (path: string): Promise<boolean> => {
    setIsNavigatingByAddressBar(true)
    try {
      const ok = await onNavigateToPath(path)
      if (ok) {
        onEditErrorChange(null)
      }
      return ok
    } finally {
      setIsNavigatingByAddressBar(false)
    }
  }, [onEditErrorChange, onNavigateToPath])

  const submitAddressPath = useCallback(async (path: string): Promise<boolean> => {
    const ok = await navigateByAddressBar(path)
    if (!ok) {
      onEditErrorChange(ADDRESS_NAVIGATION_FAILURE_MESSAGE)
      return false
    }
    onDisclosureAction({ type: 'cancel-edit' })
    resetAddressSuggestions()
    return true
  }, [navigateByAddressBar, onDisclosureAction, onEditErrorChange, resetAddressSuggestions])

  const submitAddressSuggestion = useCallback(async (suggestion: AddressSuggestionItem): Promise<boolean> => {
    const intent = resolveAddressSuggestionNavigationIntent(suggestion)

    if (intent.kind === 'favorite') {
      const ok = await onOpenFavoriteFolder(intent.entry)
      if (!ok) {
        onEditErrorChange(ADDRESS_NAVIGATION_FAILURE_MESSAGE)
        return false
      }
      onDisclosureAction({ type: 'favorite-navigation-committed' })
      resetAddressSuggestions()
      return true
    }

    if (intent.kind === 'history') {
      const ok = await onNavigateHistoryEntry(intent.entry)
      if (!ok) {
        onEditErrorChange(ADDRESS_NAVIGATION_FAILURE_MESSAGE)
        return false
      }
      onDisclosureAction({ type: 'history-navigation-committed' })
      resetAddressSuggestions()
      return true
    }

    return submitAddressPath(intent.path)
  }, [
    onDisclosureAction,
    onEditErrorChange,
    onNavigateHistoryEntry,
    onOpenFavoriteFolder,
    resetAddressSuggestions,
    submitAddressPath,
  ])

  const submitAddressEdit = useCallback(async ({
    activeIndex,
    suggestions,
    draftPath,
  }: SubmitAddressEditParams): Promise<boolean> => {
    const submitTarget = resolveAddressSuggestionSubmitTarget({
      activeIndex,
      suggestions,
      draftPath,
    })
    if (submitTarget.kind === 'suggestion') {
      return submitAddressSuggestion(submitTarget.suggestion)
    }
    return submitAddressPath(submitTarget.path)
  }, [submitAddressPath, submitAddressSuggestion])

  const navigateSegmentChild = useCallback(async (
    segmentPath: string,
    childName: string,
  ): Promise<boolean> => {
    const ok = await navigateByAddressBar(createAddressChildPath(segmentPath, childName))
    if (!ok) return false
    onDisclosureAction({ type: 'segment-navigation-committed' })
    return true
  }, [navigateByAddressBar, onDisclosureAction])

  const navigateHistoryEntry = useCallback(async (entry: AddressPathHistoryEntry): Promise<boolean> => {
    const ok = await onNavigateHistoryEntry(entry)
    if (!ok) return false
    onDisclosureAction({ type: 'history-navigation-committed' })
    return true
  }, [onDisclosureAction, onNavigateHistoryEntry])

  const openFavoriteFolder = useCallback(async (entry: FavoriteFolderEntry): Promise<boolean> => {
    const ok = await onOpenFavoriteFolder(entry)
    if (!ok) return false
    onDisclosureAction({ type: 'favorite-navigation-committed' })
    return true
  }, [onDisclosureAction, onOpenFavoriteFolder])

  return {
    isNavigatingByAddressBar,
    navigateByAddressBar,
    submitAddressEdit,
    submitAddressSuggestion,
    navigateSegmentChild,
    navigateHistoryEntry,
    openFavoriteFolder,
  }
}
