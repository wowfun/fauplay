import type { FavoriteFolderEntry } from '../../../types/index.ts'
import {
  type FavoriteFolderModelOptions,
  parseFavoriteFolders,
} from './favoriteFolderModel.ts'

export const FAVORITE_FOLDERS_STORAGE_KEY = 'fauplay:favorite-folders'

export interface FavoriteFolderStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LoadFavoriteFoldersFromStorageParams {
  storage: FavoriteFolderStorage | null
  storageKey: string
  options: FavoriteFolderModelOptions
}

export interface SaveFavoriteFoldersToStorageParams {
  storage: FavoriteFolderStorage | null
  storageKey: string
  entries: FavoriteFolderEntry[]
}

export function getFavoriteFolderStorage(): FavoriteFolderStorage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export function loadFavoriteFoldersFromStorage({
  storage,
  storageKey,
  options,
}: LoadFavoriteFoldersFromStorageParams): FavoriteFolderEntry[] {
  if (!storage) return []
  try {
    const parsed = parseFavoriteFolders(storage.getItem(storageKey), options)
    if (parsed.shouldRewrite) {
      saveFavoriteFoldersToStorage({
        storage,
        storageKey,
        entries: parsed.entries,
      })
    }
    return parsed.entries
  } catch {
    return []
  }
}

export function saveFavoriteFoldersToStorage({
  storage,
  storageKey,
  entries,
}: SaveFavoriteFoldersToStorageParams): void {
  if (!storage) return
  try {
    storage.setItem(storageKey, JSON.stringify(entries))
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}
