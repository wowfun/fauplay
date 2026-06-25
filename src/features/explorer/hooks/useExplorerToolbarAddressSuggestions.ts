import { useCallback, useEffect, useRef, useState } from 'react'
import type { AddressPathHistoryEntry, FavoriteFolderEntry } from '@/types'
import type { ExplorerToolbarAddressBarMode } from '@/features/explorer/lib/explorerToolbarDisclosureModel'
import {
  createIdleAddressSuggestionSessionState,
  resolveAddressSuggestionActiveIndexState,
  resolveAddressSuggestionLoadErrorState,
  resolveAddressSuggestionLoadStartState,
  resolveAddressSuggestionLoadSuccessState,
  resolveAddressSuggestionLookupPath,
  toAddressTaskErrorMessage,
  type AddressSuggestionActiveIndexUpdate,
} from '@/features/explorer/lib/explorerToolbarAddressBarModel'

export interface UseExplorerToolbarAddressSuggestionsParams {
  addressBarMode: ExplorerToolbarAddressBarMode
  draftPath: string
  onListChildDirectories: (path: string) => Promise<string[]>
  rootId?: string | null
  rootLabel: string
  sortedFavorites: FavoriteFolderEntry[]
  sortedHistory: AddressPathHistoryEntry[]
  maxItems: number
}

export function useExplorerToolbarAddressSuggestions({
  addressBarMode,
  draftPath,
  onListChildDirectories,
  rootId,
  rootLabel,
  sortedFavorites,
  sortedHistory,
  maxItems,
}: UseExplorerToolbarAddressSuggestionsParams) {
  const [addressSuggestionSession, setAddressSuggestionSession] = useState(createIdleAddressSuggestionSessionState)
  const suggestionRequestSeqRef = useRef(0)

  const resetAddressSuggestions = useCallback(() => {
    setAddressSuggestionSession(createIdleAddressSuggestionSessionState())
  }, [])

  const setActiveSuggestionIndex = useCallback((nextActiveIndex: AddressSuggestionActiveIndexUpdate) => {
    setAddressSuggestionSession((previous) => (
      resolveAddressSuggestionActiveIndexState(previous, nextActiveIndex)
    ))
  }, [])

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
        maxItems,
      }))
    } catch (error) {
      if (requestSeq !== suggestionRequestSeqRef.current) return
      setAddressSuggestionSession(resolveAddressSuggestionLoadErrorState(
        toAddressTaskErrorMessage(error, '读取补全候选失败'),
      ))
    }
  }, [maxItems, onListChildDirectories, rootId, rootLabel, sortedFavorites, sortedHistory])

  useEffect(() => {
    if (addressBarMode !== 'edit') {
      resetAddressSuggestions()
      return
    }
    void loadAddressSuggestions(draftPath)
  }, [addressBarMode, draftPath, loadAddressSuggestions, resetAddressSuggestions])

  return {
    addressSuggestionSession,
    setActiveSuggestionIndex,
    resetAddressSuggestions,
  }
}
