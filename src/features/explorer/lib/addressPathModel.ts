import type { AddressPathHistoryEntry, FavoriteFolderEntry } from '../../../types/index.ts'

export type AddressSuggestionSource = 'directory' | 'favorite' | 'history'
export type AddressBarMode = 'breadcrumb' | 'edit'
export type AddressSuggestionStatus = 'idle' | 'loading' | 'ready' | 'error'
export type AddressSuggestionNavigationDirection = 'next' | 'previous'
export type AddressEditKeyboardAction = 'cancel' | 'move-next' | 'move-previous' | 'complete'
export type AddressCopyState = 'idle' | 'copied' | 'failed'

export type AddressEditKeyboardIntent =
  | { kind: 'none' }
  | { kind: 'cancel-edit' }
  | { kind: 'set-active-suggestion-index'; index: number }
  | { kind: 'complete-suggestion'; index: number }

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

export interface AddressBreadcrumbItem {
  label: string
  path: string
}

export interface ResolveAddressEditKeyboardIntentParams {
  action: AddressEditKeyboardAction
  activeIndex: number
  suggestionCount: number
}

export interface ResolveAddressDraftChangeIntentParams {
  draftPath: string
  hasEditError: boolean
}

export interface AddressDraftChangeIntent {
  draftPath: string
  activeSuggestionIndex: number
  editError?: string | null
}

export interface ResolveAddressSegmentDropdownToggleIntentParams {
  openSegmentPath: string | null
  path: string
}

export interface AddressSegmentDropdownToggleIntent {
  path: string
  shouldLoadDirectories: boolean
}

export interface ResolveAddressCopyButtonViewParams {
  rootLabel: string
  currentPath: string
  copyState: AddressCopyState
}

export interface AddressCopyButtonView {
  copyText: string
  title: string
  icon: 'copy' | 'check'
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

export function buildAddressBreadcrumbItems(rootLabel: string, currentPath: string): AddressBreadcrumbItem[] {
  const resolvedRootLabel = rootLabel || '根目录'
  const pathSegments = normalizeAddressRelativePath(currentPath).split('/').filter(Boolean)
  return [
    { label: resolvedRootLabel, path: '' },
    ...pathSegments.map((segment, index) => ({
      label: segment,
      path: pathSegments.slice(0, index + 1).join('/'),
    })),
  ]
}

export function sortAddressPathHistory(entries: AddressPathHistoryEntry[]): AddressPathHistoryEntry[] {
  return [...entries].sort((left, right) => right.visitedAt - left.visitedAt)
}

export function sortAddressFavoriteFolders(entries: FavoriteFolderEntry[]): FavoriteFolderEntry[] {
  return [...entries].sort((left, right) => right.favoritedAt - left.favoritedAt)
}

export function createAddressChildPath(basePath: string, childName: string): string {
  const normalizedBasePath = normalizeAddressRelativePath(basePath)
  const normalizedChildName = normalizeAddressRelativePath(childName)
  return normalizedBasePath ? `${normalizedBasePath}/${normalizedChildName}` : normalizedChildName
}

export function moveAddressSuggestionIndex(
  currentIndex: number,
  suggestionCount: number,
  direction: AddressSuggestionNavigationDirection,
): number {
  if (suggestionCount <= 0) return currentIndex
  if (direction === 'next') {
    if (currentIndex < 0) return 0
    return (currentIndex + 1) % suggestionCount
  }
  if (currentIndex < 0) return suggestionCount - 1
  return (currentIndex - 1 + suggestionCount) % suggestionCount
}

export function resolveAddressSuggestionCompletionIndex(
  activeIndex: number,
  suggestionCount: number,
): number | null {
  if (suggestionCount <= 0) return null
  if (activeIndex < 0) return 0
  if (activeIndex >= suggestionCount) return null
  return activeIndex
}

export function shouldShowAddressSuggestionPanel(
  addressBarMode: AddressBarMode,
  addressSuggestionStatus: AddressSuggestionStatus,
  suggestionCount: number,
): boolean {
  if (addressBarMode !== 'edit') return false
  return (
    addressSuggestionStatus === 'ready'
    || addressSuggestionStatus === 'loading'
    || addressSuggestionStatus === 'error'
    || suggestionCount > 0
  )
}

export function resolveAddressEditKeyboardIntent({
  action,
  activeIndex,
  suggestionCount,
}: ResolveAddressEditKeyboardIntentParams): AddressEditKeyboardIntent {
  if (action === 'cancel') return { kind: 'cancel-edit' }

  if (suggestionCount <= 0) return { kind: 'none' }

  if (action === 'move-next') {
    return {
      kind: 'set-active-suggestion-index',
      index: moveAddressSuggestionIndex(activeIndex, suggestionCount, 'next'),
    }
  }

  if (action === 'move-previous') {
    return {
      kind: 'set-active-suggestion-index',
      index: moveAddressSuggestionIndex(activeIndex, suggestionCount, 'previous'),
    }
  }

  const completionIndex = resolveAddressSuggestionCompletionIndex(activeIndex, suggestionCount)
  return completionIndex === null
    ? { kind: 'none' }
    : { kind: 'complete-suggestion', index: completionIndex }
}

export function resolveAddressDraftChangeIntent({
  draftPath,
  hasEditError,
}: ResolveAddressDraftChangeIntentParams): AddressDraftChangeIntent {
  return {
    draftPath,
    activeSuggestionIndex: -1,
    editError: hasEditError ? null : undefined,
  }
}

export function resolveAddressSegmentDropdownToggleIntent({
  openSegmentPath,
  path,
}: ResolveAddressSegmentDropdownToggleIntentParams): AddressSegmentDropdownToggleIntent {
  return {
    path,
    shouldLoadDirectories: openSegmentPath !== path,
  }
}

export function resolveAddressCopyButtonView({
  rootLabel,
  currentPath,
  copyState,
}: ResolveAddressCopyButtonViewParams): AddressCopyButtonView {
  const title = copyState === 'copied'
    ? '已复制'
    : copyState === 'failed'
      ? '复制失败'
      : '复制当前路径'

  return {
    copyText: buildRootPathDisplayText(rootLabel, currentPath),
    title,
    icon: copyState === 'copied' ? 'check' : 'copy',
  }
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
