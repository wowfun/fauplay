import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FavoriteFolderEntry } from '@/types'
import {
  removeFavoriteFolder as removeFavoriteFolderEntry,
  resolveCurrentFavoriteFolderState,
  toggleFavoriteFolder,
  type FavoriteFolderModelOptions,
} from '@/features/explorer/lib/favoriteFolderModel'
import {
  getFavoriteFolderStorage,
  loadFavoriteFoldersFromStorage,
  saveFavoriteFoldersToStorage,
} from '@/features/explorer/lib/favoriteFolderStore'

export interface UseFavoriteFolderControllerParams extends FavoriteFolderModelOptions {
  rootId: string | null
  rootName: string
  currentPath: string
  virtualTrashPath: string
  storageKey: string
}

export function useFavoriteFolderController({
  rootId,
  rootName,
  currentPath,
  virtualTrashPath,
  storageKey,
  maxItems,
  rootLabelFallback,
}: UseFavoriteFolderControllerParams) {
  const modelOptions = useMemo(() => ({
    maxItems,
    rootLabelFallback,
  }), [maxItems, rootLabelFallback])
  const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolderEntry[]>(() => (
    loadFavoriteFoldersFromStorage({
      storage: getFavoriteFolderStorage(),
      storageKey,
      options: modelOptions,
    })
  ))

  useEffect(() => {
    saveFavoriteFoldersToStorage({
      storage: getFavoriteFolderStorage(),
      storageKey,
      entries: favoriteFolders,
    })
  }, [favoriteFolders, storageKey])

  const currentFavoriteFolderState = resolveCurrentFavoriteFolderState({
    entries: favoriteFolders,
    rootId,
    rootName,
    path: currentPath,
    virtualTrashPath,
    ...modelOptions,
  })

  useEffect(() => {
    if (currentFavoriteFolderState.entries === favoriteFolders) return
    setFavoriteFolders(currentFavoriteFolderState.entries)
  }, [currentFavoriteFolderState.entries, favoriteFolders])

  const removeFavoriteFolder = useCallback((entry: FavoriteFolderEntry): void => {
    setFavoriteFolders((previous) => removeFavoriteFolderEntry(previous, entry))
  }, [])

  const toggleCurrentFolderFavorite = useCallback((): void => {
    if (!rootId) return
    setFavoriteFolders((previous) => (
      toggleFavoriteFolder(previous, {
        rootId,
        rootName: rootName || rootLabelFallback,
        path: currentPath,
        favoritedAt: Date.now(),
        virtualTrashPath,
        ...modelOptions,
      })
    ))
  }, [currentPath, modelOptions, rootId, rootLabelFallback, rootName, virtualTrashPath])

  return {
    favoriteFolders: currentFavoriteFolderState.entries,
    isCurrentPathFavorited: currentFavoriteFolderState.isCurrentPathFavorited,
    removeFavoriteFolder,
    toggleCurrentFolderFavorite,
  }
}
