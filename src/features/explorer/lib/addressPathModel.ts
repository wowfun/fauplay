import type { AddressPathHistoryEntry, FavoriteFolderEntry } from '../../../types/index.ts'

export type AddressSuggestionSource = 'directory' | 'favorite' | 'history'

export interface DraftPathSuggestionContext {
  basePath: string
  prefix: string
  normalizedInput: string
  hasTrailingSlash: boolean
}

export interface AddressSuggestionItem {
  path: string
  source: AddressSuggestionSource
  rootId: string | null
  rootName: string
  favoriteEntry: FavoriteFolderEntry | null
  historyEntry: AddressPathHistoryEntry | null
}

export interface BuildAddressSuggestionsParams {
  context: DraftPathSuggestionContext
  childDirectories: string[]
  favoriteFolders: FavoriteFolderEntry[]
  recentPathHistory: AddressPathHistoryEntry[]
  currentRootId: string | null | undefined
  currentRootLabel: string
  maxItems: number
}

export function segmentKey(path: string): string {
  return path || '__root__'
}

export function buildRootPathDisplayText(rootLabel: string, relativePath: string): string {
  return relativePath ? `${rootLabel}/${relativePath}` : rootLabel
}

export function getAddressSuggestionSourceLabel(source: AddressSuggestionSource): string {
  if (source === 'directory') return '目录'
  if (source === 'favorite') return '收藏'
  return '历史'
}

export function normalizeAddressRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

export function parseDraftPathSuggestionContext(path: string): DraftPathSuggestionContext {
  const hasTrailingSlash = path.endsWith('/')
  const segments = path.split('/').filter(Boolean)
  if (hasTrailingSlash) {
    return {
      basePath: segments.join('/'),
      prefix: '',
      normalizedInput: normalizeAddressRelativePath(path),
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
    normalizedInput: normalizeAddressRelativePath(path),
    hasTrailingSlash,
  }
}

export function buildAddressSuggestions({
  context,
  childDirectories,
  favoriteFolders,
  recentPathHistory,
  currentRootId,
  currentRootLabel,
  maxItems,
}: BuildAddressSuggestionsParams): AddressSuggestionItem[] {
  const prefixLower = toLower(context.prefix)
  const normalizedInputLower = toLower(context.normalizedInput)

  const matchPathByInput = (candidatePath: string): boolean => {
    const normalizedCandidatePath = normalizeAddressRelativePath(candidatePath)
    if (!normalizedInputLower) return true
    if (!toLower(normalizedCandidatePath).startsWith(normalizedInputLower)) return false
    if (context.hasTrailingSlash && normalizedCandidatePath === context.normalizedInput) return false
    return true
  }

  const directorySuggestions = childDirectories
    .filter((name) => !prefixLower || toLower(name).startsWith(prefixLower))
    .map<AddressSuggestionItem>((name) => ({
      path: context.basePath ? `${context.basePath}/${name}` : name,
      source: 'directory',
      rootId: currentRootId ?? null,
      rootName: currentRootLabel,
      favoriteEntry: null,
      historyEntry: null,
    }))

  const favoriteSuggestions = favoriteFolders
    .filter((item) => matchPathByInput(item.path))
    .map<AddressSuggestionItem>((item) => ({
      path: normalizeAddressRelativePath(item.path),
      source: 'favorite',
      rootId: item.rootId,
      rootName: item.rootName || currentRootLabel,
      favoriteEntry: item,
      historyEntry: null,
    }))

  const historySuggestions = recentPathHistory
    .filter((item) => matchPathByInput(item.path))
    .map<AddressSuggestionItem>((item) => ({
      path: normalizeAddressRelativePath(item.path),
      source: 'history',
      rootId: item.rootId,
      rootName: item.rootName || currentRootLabel,
      favoriteEntry: null,
      historyEntry: item,
    }))

  const dedupedSuggestions: AddressSuggestionItem[] = []
  const seenPathSet = new Set<string>()
  for (const candidate of [...directorySuggestions, ...favoriteSuggestions, ...historySuggestions]) {
    const normalizedCandidatePath = normalizeAddressRelativePath(candidate.path)
    if (!normalizedCandidatePath && context.normalizedInput) continue
    const key = `${candidate.rootId || '__current__'}:${normalizedCandidatePath}`
    if (seenPathSet.has(key)) continue
    seenPathSet.add(key)
    dedupedSuggestions.push({
      ...candidate,
      path: normalizedCandidatePath,
    })
    if (dedupedSuggestions.length >= maxItems) break
  }

  return dedupedSuggestions
}

export function buildAddressSuggestionDisplayPath(
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

function toLower(value: string): string {
  return value.toLocaleLowerCase()
}
