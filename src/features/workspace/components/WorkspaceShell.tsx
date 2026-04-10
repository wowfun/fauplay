import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import type { FaceRecord } from '@/features/faces/types'
import { FILE_GRID_CARD_SIZE_BY_PRESET, TARGET_GRID_COLUMNS_AT_512_PRESET, requiredGridWidthForColumns } from '@/features/explorer/constants/gridLayout'
import { usePreviewTraversal } from '@/features/preview/hooks/usePreviewTraversal'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
import { useShortcutHelpEntries } from '@/features/explorer/hooks/useShortcutHelpEntries'
import { ExplorerWorkspaceLayout } from '@/layouts/ExplorerWorkspaceLayout'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import {
  buildDuplicateSelectionForGroup,
  buildDuplicateSelectionForProjection,
  type DuplicateSelectionRule,
  groupDuplicateProjectionFiles,
  isDuplicateProjection,
  replaceDuplicateGroupSelection,
} from '@/features/workspace/lib/duplicateSelection'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import { getFilePreviewKind, isMediaPreviewKind } from '@/lib/filePreview'
import { getDirectoryItemCount, isImageFile, isVideoFile } from '@/lib/fileSystem'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import { toToolScopedProjectionId } from '@/lib/projection'
import {
  type DeleteUndoBatch,
  type DeleteUndoPreviewSnapshot,
  type DeleteUndoRestoreItem,
  type DeleteUndoSnapshot,
  normalizeAbsolutePath,
  normalizeRelativePath as normalizeUndoRelativePath,
  remapFileItemAfterRestore,
  remapPathForRoot,
} from '@/features/workspace/lib/deleteUndo'
import {
  getAnnotationDisplayStoreVersion,
  getFileAnnotationUpdatedAt,
  getFileAnnotationTagKeys,
  getRootAnnotationFilterTagOptions,
  isAnnotationFilterUiGateResolved,
  isAnnotationFilterUiVisible,
  preloadAnnotationDisplaySnapshot,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'
import { getBoundRootPath } from '@/lib/reveal'
import {
  ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
  type AddressPathHistoryEntry,
  type AnnotationFilterTagOption,
  type FavoriteFolderEntry,
  type FileItem,
  type FilterState,
  type ResultPanelDisplayMode,
  type ResultProjection,
  type ThumbnailSizePreset,
} from '@/types'
import { callGatewayHttp, type GatewayCapabilitiesSnapshot, type GatewayToolDescriptor } from '@/lib/gateway'

const MIN_PANE_WIDTH_RATIO = 0.15
const MAX_PANE_WIDTH_RATIO = 0.75
const DEFAULT_PANE_WIDTH_RATIO = 0.375
const PREVIEW_PANE_WIDTH_RATIO_STORAGE_KEY = 'fauplay:preview-pane-width-ratio'
const ADDRESS_PATH_HISTORY_STORAGE_KEY = 'fauplay:address-path-history'
const WORKSPACE_FILTER_STATE_BY_ROOT_STORAGE_KEY = 'fauplay:workspace-filter-state:roots:v1'
const MAX_ADDRESS_PATH_HISTORY_ITEMS = 20
const GATEWAY_CAPABILITY_REFRESH_INTERVAL_MS = 15000
const TRASH_ROUTE_PATH = '@trash'
const LEGACY_TRASH_RELATIVE_PATH = '.trash'
const DEFAULT_RESULT_PANEL_HEIGHT_PX = 280
const MIN_RESULT_PANEL_HEIGHT_PX = 180
const DELETE_UNDO_NOTICE_TIMEOUT_MS = 6000
const FACE_SOURCE_PROJECTION_ID = 'people:selected-face-sources'

let previewPanelModulesPreloaded = false

type WorkspaceActiveSurface =
  | { kind: 'directory' }
  | { kind: 'projection'; tabId: string }

interface WorkspaceShellProps {
  rootHandle: FileSystemDirectoryHandle
  rootId: string
  favoriteFolders: FavoriteFolderEntry[]
  isCurrentPathFavorited: boolean
  files: FileItem[]
  currentPath: string
  isFlattenView: boolean
  isLoading: boolean
  error: string | null
  selectDirectory: () => Promise<void>
  openFavoriteFolder: (entry: FavoriteFolderEntry) => Promise<boolean>
  removeFavoriteFolder: (entry: FavoriteFolderEntry) => void
  toggleCurrentFolderFavorite: () => void
  openHistoryEntry: (entry: AddressPathHistoryEntry) => Promise<boolean>
  navigateToPath: (
    targetPath: string,
    options?: { resetFlattenView?: boolean }
  ) => Promise<boolean>
  navigateToDirectory: (dirName: string) => Promise<void>
  navigateUp: () => Promise<void>
  listChildDirectories: (targetPath: string) => Promise<string[]>
  setFlattenView: (flattenView: boolean) => Promise<void>
  filterFiles: (files: FileItem[], filter: FilterState) => FileItem[]
}

type DeleteUndoNoticeTone = 'default' | 'error'

interface DeleteUndoNoticeState {
  id: string
  message: string
  tone: DeleteUndoNoticeTone
}

interface RestoreRecycleResponseItem {
  ok?: boolean
  nextAbsolutePath?: string
  reasonCode?: string
  error?: string
}

interface RestoreRecycleResponse {
  ok?: boolean
  total?: number
  restored?: number
  failed?: number
  items?: RestoreRecycleResponseItem[]
}

interface PendingDeleteUndoRestoreState {
  snapshot: DeleteUndoSnapshot
}

interface PersistedWorkspaceFilterState {
  search: string
  type: FilterState['type']
  hideEmptyFolders: boolean
  sortBy: FilterState['sortBy']
  sortOrder: FilterState['sortOrder']
  annotationIncludeMatchMode: FilterState['annotationIncludeMatchMode']
  annotationIncludeTagKeys: string[]
  annotationExcludeTagKeys: string[]
}

type PersistedWorkspaceFilterStateByRoot = Record<string, PersistedWorkspaceFilterState>

const defaultFilter: FilterState = {
  search: '',
  type: 'all',
  hideEmptyFolders: true,
  sortBy: 'name',
  sortOrder: 'asc',
  annotationFilterMode: 'all',
  annotationIncludeMatchMode: 'or',
  annotationIncludeTagKeys: [],
  annotationExcludeTagKeys: [],
}

interface PersistedPreviewPaneWidthState {
  ratio: number
  isManual: boolean
}

function clampPaneWidthRatio(value: number): number {
  return Math.min(MAX_PANE_WIDTH_RATIO, Math.max(MIN_PANE_WIDTH_RATIO, value))
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneFileItem(file: FileItem | null): FileItem | null {
  if (!file) return null
  return {
    ...file,
    lastModified: file.lastModified ? new Date(file.lastModified) : undefined,
  }
}

function cloneResultProjection(projection: ResultProjection): ResultProjection {
  return {
    ...projection,
    files: projection.files.map((file) => cloneFileItem(file) ?? file),
  }
}

function cloneFilterState(filter: FilterState): FilterState {
  return {
    ...filter,
    annotationIncludeTagKeys: [...filter.annotationIncludeTagKeys],
    annotationExcludeTagKeys: [...filter.annotationExcludeTagKeys],
  }
}

function createDefaultFilterState(): FilterState {
  return cloneFilterState(defaultFilter)
}

function createDefaultPersistedWorkspaceFilterState(): PersistedWorkspaceFilterState {
  return {
    search: defaultFilter.search,
    type: defaultFilter.type,
    hideEmptyFolders: defaultFilter.hideEmptyFolders,
    sortBy: defaultFilter.sortBy,
    sortOrder: defaultFilter.sortOrder,
    annotationIncludeMatchMode: defaultFilter.annotationIncludeMatchMode,
    annotationIncludeTagKeys: [],
    annotationExcludeTagKeys: [],
  }
}

function normalizePersistedTagKeys(value: unknown): { tagKeys: string[]; mutated: boolean } {
  if (!Array.isArray(value)) {
    return {
      tagKeys: [],
      mutated: true,
    }
  }

  const seen = new Set<string>()
  const tagKeys: string[] = []
  let mutated = false
  for (const item of value) {
    if (typeof item !== 'string') {
      mutated = true
      continue
    }

    const normalized = item.trim()
    if (!normalized) {
      mutated = true
      continue
    }
    if (normalized !== item) {
      mutated = true
    }
    if (seen.has(normalized)) {
      mutated = true
      continue
    }
    seen.add(normalized)
    tagKeys.push(normalized)
  }

  if (tagKeys.length !== value.length) {
    mutated = true
  }

  return {
    tagKeys,
    mutated,
  }
}

function normalizePersistedWorkspaceFilterState(
  value: unknown
): { state: PersistedWorkspaceFilterState; mutated: boolean } {
  const defaults = createDefaultPersistedWorkspaceFilterState()
  if (!isRecord(value)) {
    return {
      state: defaults,
      mutated: true,
    }
  }

  let mutated = false
  let search = defaults.search
  if (typeof value.search === 'string') {
    search = value.search
  } else {
    mutated = true
  }

  let type = defaults.type
  if (value.type === 'all' || value.type === 'image' || value.type === 'video') {
    type = value.type
  } else {
    mutated = true
  }

  let hideEmptyFolders = defaults.hideEmptyFolders
  if (typeof value.hideEmptyFolders === 'boolean') {
    hideEmptyFolders = value.hideEmptyFolders
  } else {
    mutated = true
  }

  let sortBy = defaults.sortBy
  if (
    value.sortBy === 'name'
    || value.sortBy === 'date'
    || value.sortBy === 'size'
    || value.sortBy === 'annotationTime'
  ) {
    sortBy = value.sortBy
  } else {
    mutated = true
  }

  let sortOrder = defaults.sortOrder
  if (value.sortOrder === 'asc' || value.sortOrder === 'desc') {
    sortOrder = value.sortOrder
  } else {
    mutated = true
  }

  let annotationIncludeMatchMode = defaults.annotationIncludeMatchMode
  if (value.annotationIncludeMatchMode === 'or' || value.annotationIncludeMatchMode === 'and') {
    annotationIncludeMatchMode = value.annotationIncludeMatchMode
  } else {
    mutated = true
  }

  const includeTagKeys = normalizePersistedTagKeys(value.annotationIncludeTagKeys)
  const excludeTagKeys = normalizePersistedTagKeys(value.annotationExcludeTagKeys)
  mutated = mutated || includeTagKeys.mutated || excludeTagKeys.mutated

  return {
    state: {
      search,
      type,
      hideEmptyFolders,
      sortBy,
      sortOrder,
      annotationIncludeMatchMode,
      annotationIncludeTagKeys: includeTagKeys.tagKeys,
      annotationExcludeTagKeys: excludeTagKeys.tagKeys,
    },
    mutated,
  }
}

function hydratePersistedWorkspaceFilterState(state: PersistedWorkspaceFilterState): FilterState {
  const annotationIncludeTagKeys = [...state.annotationIncludeTagKeys]
  const annotationExcludeTagKeys = [...state.annotationExcludeTagKeys]
  return {
    search: state.search,
    type: state.type,
    hideEmptyFolders: state.hideEmptyFolders,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
    annotationFilterMode: annotationIncludeTagKeys.length > 0 || annotationExcludeTagKeys.length > 0 ? 'boolean' : 'all',
    annotationIncludeMatchMode: state.annotationIncludeMatchMode,
    annotationIncludeTagKeys,
    annotationExcludeTagKeys,
  }
}

function serializePersistedWorkspaceFilterState(filter: FilterState): PersistedWorkspaceFilterState {
  return {
    search: filter.search,
    type: filter.type,
    hideEmptyFolders: filter.hideEmptyFolders,
    sortBy: filter.sortBy,
    sortOrder: filter.sortOrder,
    annotationIncludeMatchMode: filter.annotationIncludeMatchMode,
    annotationIncludeTagKeys: [...filter.annotationIncludeTagKeys],
    annotationExcludeTagKeys: [...filter.annotationExcludeTagKeys],
  }
}

function savePersistedWorkspaceFilterStateByRoot(states: PersistedWorkspaceFilterStateByRoot): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(WORKSPACE_FILTER_STATE_BY_ROOT_STORAGE_KEY, JSON.stringify(states))
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

function parsePersistedWorkspaceFilterStateByRoot(raw: string | null): {
  states: PersistedWorkspaceFilterStateByRoot
  shouldRewrite: boolean
} {
  if (!raw) {
    return {
      states: {},
      shouldRewrite: false,
    }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return {
        states: {},
        shouldRewrite: true,
      }
    }

    const states: PersistedWorkspaceFilterStateByRoot = {}
    let shouldRewrite = false
    for (const [rootId, value] of Object.entries(parsed)) {
      if (!rootId) {
        shouldRewrite = true
        continue
      }

      const normalized = normalizePersistedWorkspaceFilterState(value)
      states[rootId] = normalized.state
      shouldRewrite = shouldRewrite || normalized.mutated
    }

    return {
      states,
      shouldRewrite,
    }
  } catch {
    return {
      states: {},
      shouldRewrite: true,
    }
  }
}

function loadPersistedWorkspaceFilterStateByRoot(): PersistedWorkspaceFilterStateByRoot {
  if (typeof window === 'undefined') return {}

  try {
    const parsed = parsePersistedWorkspaceFilterStateByRoot(
      window.localStorage.getItem(WORKSPACE_FILTER_STATE_BY_ROOT_STORAGE_KEY)
    )
    if (parsed.shouldRewrite) {
      savePersistedWorkspaceFilterStateByRoot(parsed.states)
    }
    return parsed.states
  } catch {
    return {}
  }
}

function loadPersistedWorkspaceFilterStateForRoot(
  rootId: string | null | undefined,
  states: PersistedWorkspaceFilterStateByRoot
): FilterState {
  if (!rootId) {
    return createDefaultFilterState()
  }

  const persisted = states[rootId]
  return persisted ? hydratePersistedWorkspaceFilterState(persisted) : createDefaultFilterState()
}

function cloneStringArrayRecord(record: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, [...value]])
  )
}

function cloneNullableStringRecord(record: Record<string, string | null>): Record<string, string | null> {
  return { ...record }
}

function cloneDuplicateSelectionRuleRecord(
  record: Record<string, DuplicateSelectionRule | null>
): Record<string, DuplicateSelectionRule | null> {
  return { ...record }
}

function countDeleteUndoItems(items: DeleteUndoRestoreItem[]): number {
  return items.length
}

function createDeleteUndoId(prefix: string): string {
  return `${prefix}:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function pathRefersToDeletedAbsolutePath(
  value: string | null | undefined,
  rootPath: string | null,
  deletedAbsolutePathSet: Set<string>
): boolean {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  if (!normalizedValue) {
    return false
  }

  if (normalizedValue.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(normalizedValue)) {
    return deletedAbsolutePathSet.has(normalizeAbsolutePath(normalizedValue))
  }

  if (!rootPath) {
    return false
  }

  return deletedAbsolutePathSet.has(
    normalizeAbsolutePath(`${normalizeAbsolutePath(rootPath)}/${normalizeUndoRelativePath(normalizedValue)}`)
  )
}

function loadPersistedPreviewPaneWidthState(): PersistedPreviewPaneWidthState {
  if (typeof window === 'undefined') {
    return {
      ratio: DEFAULT_PANE_WIDTH_RATIO,
      isManual: false,
    }
  }

  try {
    const raw = window.localStorage.getItem(PREVIEW_PANE_WIDTH_RATIO_STORAGE_KEY)
    if (raw === null) {
      return {
        ratio: DEFAULT_PANE_WIDTH_RATIO,
        isManual: false,
      }
    }

    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      return {
        ratio: DEFAULT_PANE_WIDTH_RATIO,
        isManual: false,
      }
    }

    return {
      ratio: clampPaneWidthRatio(parsed),
      isManual: true,
    }
  } catch {
    return {
      ratio: DEFAULT_PANE_WIDTH_RATIO,
      isManual: false,
    }
  }
}

function savePersistedPreviewPaneWidthRatio(value: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PREVIEW_PANE_WIDTH_RATIO_STORAGE_KEY, String(clampPaneWidthRatio(value)))
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

function getMaxResultPanelHeightPx(): number {
  if (typeof window === 'undefined') {
    return 640
  }
  return Math.max(MIN_RESULT_PANEL_HEIGHT_PX, window.innerHeight - 220)
}

function clampResultPanelHeightPx(value: number): number {
  return Math.min(getMaxResultPanelHeightPx(), Math.max(MIN_RESULT_PANEL_HEIGHT_PX, value))
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:[\\/]/.test(path)
}

function normalizeCurrentRootFaceSourcePath(assetPath: string | null | undefined): string | null {
  const rawPath = assetPath?.trim()
  if (!rawPath) return null

  const slashPath = rawPath.replace(/\\/g, '/')
  if (isAbsolutePathLike(slashPath)) {
    return null
  }

  const pathParts = slashPath.split('/').filter(Boolean)
  if (pathParts.length === 0 || pathParts.some((part) => part === '..')) {
    return null
  }
  return pathParts.join('/')
}

function normalizeAbsoluteFaceSourcePath(assetPath: string | null | undefined): string | null {
  const rawPath = assetPath?.trim()
  if (!rawPath) return null

  const slashPath = rawPath.replace(/\\/g, '/')
  if (!isAbsolutePathLike(slashPath)) return null
  return slashPath
}

function joinAbsolutePath(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizedRoot ? `${normalizedRoot}/${relativePath}` : relativePath
}

function getRelativeParentPath(relativePath: string): string {
  return relativePath.split('/').slice(0, -1).join('/')
}

function getRelativeFileName(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath
}

function resolveProjectionPreferredPath(projection: ResultProjection | null, preferredPath: string | null | undefined): string | null {
  if (!projection) return null
  const normalizedPreferredPath = normalizeRelativePath(preferredPath || '')
  if (
    normalizedPreferredPath
    && projection.files.some((file) => normalizeRelativePath(file.path) === normalizedPreferredPath)
  ) {
    return normalizedPreferredPath
  }
  return projection.files[0]?.path ?? null
}

function isAnnotationFilterAtDefault(filter: FilterState): boolean {
  return (
    filter.annotationFilterMode === 'all'
    && filter.annotationIncludeMatchMode === 'or'
    && filter.annotationIncludeTagKeys.length === 0
    && filter.annotationExcludeTagKeys.length === 0
  )
}

function isAnnotationBooleanFilterActive(filter: FilterState): boolean {
  return filter.annotationIncludeTagKeys.length > 0 || filter.annotationExcludeTagKeys.length > 0
}

function withSyncedAnnotationFilterMode(filter: FilterState): FilterState {
  const nextMode: FilterState['annotationFilterMode'] = isAnnotationBooleanFilterActive(filter) ? 'boolean' : 'all'
  if (filter.annotationFilterMode === nextMode) {
    return filter
  }
  return {
    ...filter,
    annotationFilterMode: nextMode,
  }
}

function fileMatchesAnnotationTag(tagSet: Set<string>, tagKey: string): boolean {
  if (tagKey === ANNOTATION_FILTER_UNANNOTATED_TAG_KEY) {
    return tagSet.size === 0
  }
  return tagSet.has(tagKey)
}

function matchesBooleanAnnotationFilter(filter: FilterState, fileTagKeys: string[]): boolean {
  const includeTagKeys = filter.annotationIncludeTagKeys
  const excludeTagKeys = filter.annotationExcludeTagKeys
  if (includeTagKeys.length === 0 && excludeTagKeys.length === 0) {
    return true
  }

  const tagSet = new Set(fileTagKeys)
  const includeMatched = includeTagKeys.length === 0
    ? true
    : filter.annotationIncludeMatchMode === 'and'
      ? includeTagKeys.every((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))
      : includeTagKeys.some((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))

  if (!includeMatched) return false

  return !excludeTagKeys.some((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))
}

function compareByNameWithSortOrder(left: FileItem, right: FileItem, sortOrder: FilterState['sortOrder']): number {
  const cmp = left.name.localeCompare(right.name)
  return sortOrder === 'asc' ? cmp : -cmp
}

function sortFilesByAnnotationTime(
  files: FileItem[],
  rootId: string,
  sortOrder: FilterState['sortOrder']
): FileItem[] {
  const next = [...files]
  next.sort((left, right) => {
    if (left.kind === 'directory' && right.kind === 'file') return -1
    if (left.kind === 'file' && right.kind === 'directory') return 1
    if (left.kind === 'directory' && right.kind === 'directory') {
      return compareByNameWithSortOrder(left, right, sortOrder)
    }

    const leftUpdatedAt = getFileAnnotationUpdatedAt(rootId, left.path)
    const rightUpdatedAt = getFileAnnotationUpdatedAt(rootId, right.path)
    const leftAnnotated = leftUpdatedAt !== null
    const rightAnnotated = rightUpdatedAt !== null

    // Unannotated items always stay at the bottom regardless of sort order.
    if (leftAnnotated !== rightAnnotated) {
      return leftAnnotated ? -1 : 1
    }
    if (!leftAnnotated && !rightAnnotated) {
      return compareByNameWithSortOrder(left, right, sortOrder)
    }

    if (leftUpdatedAt !== rightUpdatedAt) {
      const cmp = (leftUpdatedAt ?? 0) - (rightUpdatedAt ?? 0)
      return sortOrder === 'asc' ? cmp : -cmp
    }
    return compareByNameWithSortOrder(left, right, sortOrder)
  })
  return next
}

function dedupeAddressPathHistory(entries: AddressPathHistoryEntry[]): AddressPathHistoryEntry[] {
  const latestEntryByKey = new Map<string, AddressPathHistoryEntry>()

  for (const item of entries) {
    if (!item.rootId) continue
    const normalizedPath = normalizeRelativePath(item.path)
    const visitedAt = Number.isFinite(item.visitedAt) ? item.visitedAt : 0
    const key = `${item.rootId}:${normalizedPath}`
    const existing = latestEntryByKey.get(key)
    if (!existing || visitedAt > existing.visitedAt) {
      latestEntryByKey.set(key, {
        rootId: item.rootId,
        rootName: item.rootName || '根目录',
        path: normalizedPath,
        visitedAt,
      })
    }
  }

  return [...latestEntryByKey.values()]
    .sort((left, right) => right.visitedAt - left.visitedAt)
    .slice(0, MAX_ADDRESS_PATH_HISTORY_ITEMS)
}

interface ParsedAddressPathHistory {
  entries: AddressPathHistoryEntry[]
  shouldRewrite: boolean
}

function parseAddressPathHistory(raw: string | null): ParsedAddressPathHistory {
  if (!raw) return { entries: [], shouldRewrite: false }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return { entries: [], shouldRewrite: true }

    let hasLegacyEntry = false
    let hasInvalidEntry = false

    const validEntries = parsed
      .filter((item): item is AddressPathHistoryEntry => {
        if (!item || typeof item !== 'object') {
          hasInvalidEntry = true
          return false
        }

        const candidate = item as Partial<AddressPathHistoryEntry>
        const hasPathShape = typeof candidate.path === 'string' && typeof candidate.visitedAt === 'number'
        if (!hasPathShape) {
          hasInvalidEntry = true
          return false
        }

        if (typeof candidate.rootId !== 'string' || typeof candidate.rootName !== 'string') {
          hasLegacyEntry = true
          return false
        }

        return true
      })

    const dedupedEntries = dedupeAddressPathHistory(validEntries)
    const shouldRewrite = hasLegacyEntry || hasInvalidEntry || dedupedEntries.length !== validEntries.length
    if (hasLegacyEntry) {
      return { entries: [], shouldRewrite: true }
    }

    return { entries: dedupedEntries, shouldRewrite }
  } catch {
    return { entries: [], shouldRewrite: true }
  }
}

function loadAddressPathHistory(): AddressPathHistoryEntry[] {
  if (typeof window === 'undefined') return []
  const parsed = parseAddressPathHistory(window.localStorage.getItem(ADDRESS_PATH_HISTORY_STORAGE_KEY))
  if (parsed.shouldRewrite) {
    saveAddressPathHistory(parsed.entries)
  }
  return parsed.entries
}

function saveAddressPathHistory(history: AddressPathHistoryEntry[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ADDRESS_PATH_HISTORY_STORAGE_KEY, JSON.stringify(history))
}

function upsertAddressPathHistory(
  previous: AddressPathHistoryEntry[],
  nextEntry: Pick<AddressPathHistoryEntry, 'rootId' | 'rootName' | 'path'>
): AddressPathHistoryEntry[] {
  const normalizedPath = normalizeRelativePath(nextEntry.path)
  const now = Date.now()
  return dedupeAddressPathHistory([{
    rootId: nextEntry.rootId,
    rootName: nextEntry.rootName,
    path: normalizedPath,
    visitedAt: now,
  }, ...previous])
}

function preloadPreviewModules(): void {
  if (previewPanelModulesPreloaded) return
  previewPanelModulesPreloaded = true

  const preloaders = [
    () => import('@/features/preview/components/FilePreviewPanel'),
    () => import('@/features/preview/components/FilePreviewCanvas'),
    () => import('@/features/preview/components/PreviewHeaderBar'),
    () => import('@/features/preview/components/PreviewControlGroup'),
    () => import('@/features/preview/components/PreviewTitleRow'),
    () => import('@/features/preview/components/MediaPlaybackControls'),
    () => import('@/features/preview/components/FilePreviewViewport'),
    () => import('@/features/preview/components/PreviewFeedbackOverlay'),
  ]

  for (const load of preloaders) {
    void load().catch(() => {})
  }
}

export function WorkspaceShell({
  rootHandle,
  rootId,
  favoriteFolders,
  isCurrentPathFavorited,
  files,
  currentPath,
  isFlattenView,
  isLoading,
  error,
  selectDirectory,
  openFavoriteFolder,
  removeFavoriteFolder,
  toggleCurrentFolderFavorite,
  openHistoryEntry,
  navigateToPath,
  navigateToDirectory,
  navigateUp,
  listChildDirectories,
  setFlattenView,
  filterFiles,
}: WorkspaceShellProps) {
  const keyboardShortcuts = useKeyboardShortcuts()
  const annotationDisplayStoreVersion = useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )
  const persistedWorkspaceFilterStateByRootRef = useRef<PersistedWorkspaceFilterStateByRoot>(
    loadPersistedWorkspaceFilterStateByRoot()
  )
  const hydratedFilterRootIdRef = useRef<string | null>(rootId)
  const skipNextFilterPersistRef = useRef(true)
  const initialPreviewPaneWidthStateRef = useRef<PersistedPreviewPaneWidthState>(loadPersistedPreviewPaneWidthState())
  const [filter, setFilter] = useState<FilterState>(() => (
    loadPersistedWorkspaceFilterStateForRoot(rootId, persistedWorkspaceFilterStateByRootRef.current)
  ))
  const [thumbnailSizePreset, setThumbnailSizePreset] = useState<ThumbnailSizePreset>('auto')
  const [paneWidthRatio, setPaneWidthRatio] = useState(initialPreviewPaneWidthStateRef.current.ratio)
  const [directorySelectedPaths, setDirectorySelectedPaths] = useState<string[]>([])
  const [recentPathHistory, setRecentPathHistory] = useState<AddressPathHistoryEntry[]>(() => loadAddressPathHistory())
  const [pluginTools, setPluginTools] = useState<GatewayToolDescriptor[]>([])
  const [projectionTabs, setProjectionTabs] = useState<ResultProjection[]>([])
  const [activeProjectionTabId, setActiveProjectionTabId] = useState<string | null>(null)
  const [activeSurface, setActiveSurface] = useState<WorkspaceActiveSurface>({ kind: 'directory' })
  const [projectionSelectedPathsById, setProjectionSelectedPathsById] = useState<Record<string, string[]>>({})
  const [duplicateSelectionRuleByProjectionId, setDuplicateSelectionRuleByProjectionId] = useState<Record<string, DuplicateSelectionRule | null>>({})
  const [directoryFocusedPath, setDirectoryFocusedPath] = useState<string | null>(null)
  const [projectionFocusedPathById, setProjectionFocusedPathById] = useState<Record<string, string | null>>({})
  const [isResultPanelOpen, setIsResultPanelOpen] = useState(false)
  const [resultPanelDisplayMode, setResultPanelDisplayMode] = useState<ResultPanelDisplayMode>('normal')
  const [resultPanelHeightPx, setResultPanelHeightPx] = useState(DEFAULT_RESULT_PANEL_HEIGHT_PX)
  const [deleteUndoBatches, setDeleteUndoBatches] = useState<DeleteUndoBatch[]>([])
  const [isUndoingDelete, setIsUndoingDelete] = useState(false)
  const [deleteUndoNotice, setDeleteUndoNotice] = useState<DeleteUndoNoticeState | null>(null)
  const [pendingDeleteUndoRestore, setPendingDeleteUndoRestore] = useState<PendingDeleteUndoRestoreState | null>(null)
  const [hasTrashEntries, setHasTrashEntries] = useState(false)
  const [showPeoplePanel, setShowPeoplePanel] = useState(false)
  const [peoplePanelPreferredPersonId, setPeoplePanelPreferredPersonId] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const isPaneWidthManualRef = useRef(initialPreviewPaneWidthStateRef.current.isManual)
  const directoryFileGridRef = useRef<FileBrowserGridHandle>(null)
  const projectionFileGridRef = useRef<FileBrowserGridHandle>(null)
  const lastNormalResultPanelHeightRef = useRef(DEFAULT_RESULT_PANEL_HEIGHT_PX)
  const lastProjectionTabIdRef = useRef<string | null>(null)
  const deletedProjectionAbsolutePathSetRef = useRef<Set<string>>(new Set())
  const handleFilterChange = useCallback((nextFilter: FilterState) => {
    setDirectorySelectedPaths([])
    setFilter(withSyncedAnnotationFilterMode(nextFilter))
  }, [])
  const isAnnotationFilterGateResolved = isAnnotationFilterUiGateResolved(rootId)
  const showAnnotationFilterControls = isAnnotationFilterUiVisible(rootId)
  const annotationFilterTagOptions = useMemo<AnnotationFilterTagOption[]>(() => {
    // Depend on external store version so tag options refresh with latest gateway tag snapshot.
    void annotationDisplayStoreVersion
    if (!showAnnotationFilterControls) return []
    const rootTagOptions = getRootAnnotationFilterTagOptions(rootId)
    return [
      {
        tagKey: ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
        key: '',
        value: '未标注',
        sources: [],
        hasMetaAnnotation: false,
        representativeSource: '',
      },
      ...rootTagOptions,
    ]
  }, [annotationDisplayStoreVersion, rootId, showAnnotationFilterControls])

  useEffect(() => {
    if (hydratedFilterRootIdRef.current === rootId) return
    hydratedFilterRootIdRef.current = null
    skipNextFilterPersistRef.current = true
    setFilter(loadPersistedWorkspaceFilterStateForRoot(rootId, persistedWorkspaceFilterStateByRootRef.current))
    hydratedFilterRootIdRef.current = rootId
  }, [rootId])

  useEffect(() => {
    if (!rootId) return
    if (hydratedFilterRootIdRef.current !== rootId) return
    if (skipNextFilterPersistRef.current) {
      skipNextFilterPersistRef.current = false
      return
    }

    const nextState = serializePersistedWorkspaceFilterState(filter)
    persistedWorkspaceFilterStateByRootRef.current = {
      ...persistedWorkspaceFilterStateByRootRef.current,
      [rootId]: nextState,
    }
    savePersistedWorkspaceFilterStateByRoot(persistedWorkspaceFilterStateByRootRef.current)
  }, [filter, rootId])

  const filteredFiles = useMemo(() => {
    // Depend on external store version so file filtering reflects latest gateway tag snapshot.
    void annotationDisplayStoreVersion
    let nextFilteredFiles = filterFiles(files, filter)
    if (isAnnotationBooleanFilterActive(filter)) {
      nextFilteredFiles = nextFilteredFiles.filter((file) => {
        if (file.kind !== 'file') return true
        const fileTagKeys = getFileAnnotationTagKeys(rootId, file.path)
        return matchesBooleanAnnotationFilter(filter, fileTagKeys)
      })
    }

    if (filter.sortBy === 'annotationTime') {
      return sortFilesByAnnotationTime(nextFilteredFiles, rootId, filter.sortOrder)
    }

    return nextFilteredFiles
  }, [annotationDisplayStoreVersion, files, filter, filterFiles, rootId])
  const activeProjectionTab = useMemo(
    () => projectionTabs.find((projection) => projection.id === activeProjectionTabId) ?? projectionTabs[0] ?? null,
    [activeProjectionTabId, projectionTabs]
  )
  const activeSurfaceProjection = useMemo(() => {
    if (activeSurface.kind !== 'projection') return null
    return projectionTabs.find((projection) => projection.id === activeSurface.tabId) ?? null
  }, [activeSurface, projectionTabs])
  const activeSurfaceFiles = useMemo(
    () => activeSurfaceProjection?.files ?? filteredFiles,
    [activeSurfaceProjection, filteredFiles]
  )
  const isDirectorySurfaceActive = activeSurface.kind === 'directory'
  const projectionGridSelectedPaths = useMemo(
    () => (activeProjectionTab?.id ? projectionSelectedPathsById[activeProjectionTab.id] ?? [] : []),
    [activeProjectionTab?.id, projectionSelectedPathsById]
  )
  const activeDuplicateSelectionRule = useMemo(
    () => (activeProjectionTab?.id ? duplicateSelectionRuleByProjectionId[activeProjectionTab.id] ?? null : null),
    [activeProjectionTab?.id, duplicateSelectionRuleByProjectionId]
  )
  const activeSurfaceSelectedPaths = useMemo(
    () => (activeSurface.kind === 'projection'
      ? projectionSelectedPathsById[activeSurface.tabId] ?? []
      : directorySelectedPaths),
    [activeSurface, directorySelectedPaths, projectionSelectedPathsById]
  )

  const totalCount = useMemo(() => filteredFiles.length, [filteredFiles])
  const imageCount = useMemo(
    () => filteredFiles.filter((file) => file.kind === 'file' && isImageFile(file.name)).length,
    [filteredFiles]
  )
  const videoCount = useMemo(
    () => filteredFiles.filter((file) => file.kind === 'file' && isVideoFile(file.name)).length,
    [filteredFiles]
  )
  const selectedGridItems = useMemo(() => {
    if (activeSurfaceSelectedPaths.length === 0) return []
    const selectedPathSet = new Set(activeSurfaceSelectedPaths)
    return activeSurfaceFiles.filter((file) => selectedPathSet.has(file.path))
  }, [activeSurfaceFiles, activeSurfaceSelectedPaths])
  const selectedGridMetaFile = useMemo(() => {
    if (selectedGridItems.length !== 1) return null
    return selectedGridItems[0]?.kind === 'file' ? selectedGridItems[0] : null
  }, [selectedGridItems])
  const activeSurfaceFileItems = useMemo(
    () => activeSurfaceFiles.filter((file): file is FileItem => file.kind === 'file'),
    [activeSurfaceFiles]
  )
  const {
    selectedFile,
    previewFile,
    showPreviewPane,
    previewAutoPlayOnOpen,
    autoPlayEnabled,
    autoPlayIntervalSec,
    videoSeekStepSec,
    videoPlaybackRate,
    faceBboxVisible,
    playbackOrder,
    hasOpenPreview,
    hasActiveMediaPreview,
    showFileInPane,
    openFileInModal,
    closePreviewModal,
    closePreviewPane,
    openFullscreenFromPane,
    toggleAutoPlay,
    togglePlaybackOrder,
    setAutoPlayInterval,
    setVideoSeekStep,
    setVideoPlaybackRate,
    cycleVideoPlaybackRate,
    toggleFaceBboxVisible,
    navigateMediaFromPane,
    navigateMediaFromModal,
    handleAutoPlayVideoEnded,
    handleAutoPlayVideoPlaybackError,
    alignPreviewToPath,
  } = usePreviewTraversal({ filteredFiles: activeSurfaceFiles })
  const hasActiveVideoPreview = useMemo(() => {
    const activePreviewFile = previewFile ?? (showPreviewPane ? selectedFile : null)
    if (!activePreviewFile || activePreviewFile.kind !== 'file') {
      return false
    }
    return getFilePreviewKind(activePreviewFile.name) === 'video'
  }, [previewFile, selectedFile, showPreviewPane])
  const activePreviewFileForTagShortcuts = useMemo(
    () => previewFile ?? (showPreviewPane ? selectedFile : null),
    [previewFile, selectedFile, showPreviewPane]
  )
  const canRunPreviewTagShortcuts = useMemo(() => (
    activePreviewFileForTagShortcuts?.kind === 'file'
    && !activePreviewFileForTagShortcuts.path.startsWith('/')
    && activePreviewFileForTagShortcuts.sourceType !== 'root_trash'
    && activePreviewFileForTagShortcuts.sourceType !== 'global_recycle'
    && pluginTools.some((tool) => tool.name === 'local.data' && tool.scopes.includes('file'))
  ), [activePreviewFileForTagShortcuts, pluginTools])
  const canSoftDeleteActivePreview = useMemo(() => (
    activePreviewFileForTagShortcuts?.kind === 'file'
    && activePreviewFileForTagShortcuts.sourceType !== 'root_trash'
    && activePreviewFileForTagShortcuts.sourceType !== 'global_recycle'
    && pluginTools.some((tool) => tool.name === 'fs.softDelete' && tool.scopes.includes('file'))
  ), [activePreviewFileForTagShortcuts, pluginTools])
  const { getMatchingPreviewTagShortcut } = useResolvedPreviewTagShortcuts({
    rootId,
    relativePath: activePreviewFileForTagShortcuts?.kind === 'file' ? activePreviewFileForTagShortcuts.path : null,
    enabled: canRunPreviewTagShortcuts,
  })
  const shortcutHelpEntries = useShortcutHelpEntries({
    rootId,
    currentPath,
    canUndoDelete: deleteUndoBatches.length > 0,
    visibleItemCount: activeSurfaceFiles.length,
    selectedGridCount: selectedGridItems.length,
    hasOpenPreview,
    hasActivePreviewFile: Boolean(
      activePreviewFileForTagShortcuts && activePreviewFileForTagShortcuts.kind === 'file'
    ),
    hasActiveMediaPreview,
    hasActiveVideoPreview,
    canManagePreviewTags: canRunPreviewTagShortcuts,
    canSoftDeletePreview: canSoftDeleteActivePreview,
  })

  const getActivePreviewVideoElement = useCallback((): HTMLVideoElement | null => {
    const preferredSurface = previewFile ? 'lightbox' : 'panel'
    const preferredSelector = `video[data-preview-video="true"][data-preview-video-surface="${preferredSurface}"]`
    return (
      document.querySelector<HTMLVideoElement>(preferredSelector)
      ?? document.querySelector<HTMLVideoElement>('video[data-preview-video="true"]')
    )
  }, [previewFile])

  const applyVideoPlaybackRateToElement = useCallback((videoElement: HTMLVideoElement, rate: number): void => {
    videoElement.defaultPlaybackRate = rate
    videoElement.playbackRate = rate
  }, [])

  const applyVideoPlaybackRateToActivePreviewVideo = useCallback((rate: number): boolean => {
    const videoElement = getActivePreviewVideoElement()
    if (!videoElement) {
      return false
    }
    applyVideoPlaybackRateToElement(videoElement, rate)
    return true
  }, [applyVideoPlaybackRateToElement, getActivePreviewVideoElement])

  const toggleActivePreviewVideoPlayback = useCallback((): boolean => {
    const videoElement = getActivePreviewVideoElement()
    if (!videoElement) {
      return false
    }
    if (videoElement.paused || videoElement.ended) {
      const playPromise = videoElement.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        void playPromise.catch(() => {})
      }
      return true
    }

    videoElement.pause()
    return true
  }, [getActivePreviewVideoElement])

  const seekActivePreviewVideo = useCallback((direction: 'backward' | 'forward'): boolean => {
    const videoElement = getActivePreviewVideoElement()
    if (!videoElement) return false

    const baseCurrentTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0
    const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : Number.POSITIVE_INFINITY
    const delta = direction === 'backward' ? -videoSeekStepSec : videoSeekStepSec
    const nextTime = Math.min(duration, Math.max(0, baseCurrentTime + delta))
    videoElement.currentTime = nextTime
    return true
  }, [getActivePreviewVideoElement, videoSeekStepSec])

  const handleDirectoryClick = useCallback((dirName: string) => {
    setActiveSurface({ kind: 'directory' })
    void navigateToDirectory(dirName)
  }, [navigateToDirectory])

  const handleDirectoryFileClick = useCallback((file: FileItem) => {
    setActiveSurface({ kind: 'directory' })
    if (file.kind === 'directory') {
      void navigateToDirectory(file.name)
    } else {
      setDirectoryFocusedPath(file.path)
      preloadPreviewModules()
      showFileInPane(file)
    }
  }, [navigateToDirectory, showFileInPane])

  const handleDirectoryFileDoubleClick = useCallback((file: FileItem) => {
    if (file.kind === 'file') {
      setActiveSurface({ kind: 'directory' })
      setDirectoryFocusedPath(file.path)
      openFileInModal(file)
    }
  }, [openFileInModal])

  const handleProjectionFileClick = useCallback((file: FileItem) => {
    const tabId = activeProjectionTab?.id
    if (!tabId) return
    setActiveProjectionTabId(tabId)
    lastProjectionTabIdRef.current = tabId
    setActiveSurface({ kind: 'projection', tabId })
    if (file.kind === 'directory') {
      return
    }
    setProjectionFocusedPathById((previous) => (
      previous[tabId] === file.path
        ? previous
        : {
          ...previous,
          [tabId]: file.path,
        }
    ))
    preloadPreviewModules()
    showFileInPane(file)
  }, [activeProjectionTab?.id, showFileInPane])

  const handleProjectionFileDoubleClick = useCallback((file: FileItem) => {
    const tabId = activeProjectionTab?.id
    if (!tabId || file.kind !== 'file') return
    setActiveProjectionTabId(tabId)
    lastProjectionTabIdRef.current = tabId
    setActiveSurface({ kind: 'projection', tabId })
    setProjectionFocusedPathById((previous) => (
      previous[tabId] === file.path
        ? previous
        : {
          ...previous,
          [tabId]: file.path,
        }
    ))
    openFileInModal(file)
  }, [activeProjectionTab?.id, openFileInModal])

  const handleNavigateToPath = useCallback((path: string) => {
    return navigateToPath(path, { resetFlattenView: true })
  }, [navigateToPath])
  const handleNavigateHistoryEntry = useCallback((entry: AddressPathHistoryEntry) => {
    return openHistoryEntry(entry)
  }, [openHistoryEntry])

  const refreshAnnotationSnapshot = useCallback(async () => {
    if (!rootId) return
    await preloadAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      force: true,
    })
  }, [rootHandle, rootId])

  const handleOpenAnnotationFilterPanel = useCallback(() => {
    void refreshAnnotationSnapshot()
  }, [refreshAnnotationSnapshot])

  const alignPreviewToProjection = useCallback((projection: ResultProjection | null, preferredPath?: string | null) => {
    alignPreviewToPath(resolveProjectionPreferredPath(projection, preferredPath))
  }, [alignPreviewToPath])

  const showDeleteUndoNoticeMessage = useCallback((message: string, tone: DeleteUndoNoticeTone = 'default') => {
    setDeleteUndoNotice({
      id: createDeleteUndoId('delete-undo-notice'),
      message,
      tone,
    })
  }, [])

  const captureDeleteUndoPreviewSnapshot = useCallback((): DeleteUndoPreviewSnapshot => ({
    showPreviewPane,
    selectedFile: cloneFileItem(selectedFile),
    previewFile: cloneFileItem(previewFile),
  }), [previewFile, selectedFile, showPreviewPane])

  const captureDeleteUndoSnapshot = useCallback((): DeleteUndoSnapshot | null => {
    if (!rootId) {
      return null
    }

    return {
      historyEntry: {
        rootId,
        rootName: rootHandle.name || '根目录',
        path: currentPath,
        visitedAt: Date.now(),
      },
      rootPath: getBoundRootPath(rootId),
      currentPath,
      filter: cloneFilterState(filter),
      isFlattenView,
      activeSurface: activeSurface.kind === 'projection'
        ? { kind: 'projection', tabId: activeSurface.tabId }
        : { kind: 'directory' },
      directorySelectedPaths: [...directorySelectedPaths],
      directoryFocusedPath,
      isResultPanelOpen,
      resultPanelDisplayMode,
      resultPanelHeightPx,
      lastNormalResultPanelHeightPx: lastNormalResultPanelHeightRef.current,
      projectionTabs: projectionTabs.map((projection) => cloneResultProjection(projection)),
      activeProjectionTabId,
      projectionSelectedPathsById: cloneStringArrayRecord(projectionSelectedPathsById),
      projectionFocusedPathById: cloneNullableStringRecord(projectionFocusedPathById),
      duplicateSelectionRuleByProjectionId: cloneDuplicateSelectionRuleRecord(duplicateSelectionRuleByProjectionId),
      preview: captureDeleteUndoPreviewSnapshot(),
    }
  }, [
    activeProjectionTabId,
    activeSurface,
    captureDeleteUndoPreviewSnapshot,
    currentPath,
    directoryFocusedPath,
    directorySelectedPaths,
    duplicateSelectionRuleByProjectionId,
    filter,
    isFlattenView,
    isResultPanelOpen,
    projectionFocusedPathById,
    projectionSelectedPathsById,
    projectionTabs,
    resultPanelDisplayMode,
    resultPanelHeightPx,
    rootHandle.name,
    rootId,
  ])

  const buildDeleteUndoBatch = useCallback((
    restoreItems: DeleteUndoRestoreItem[] | undefined,
    snapshot: DeleteUndoSnapshot | null
  ): DeleteUndoBatch | null => {
    if (!snapshot || !Array.isArray(restoreItems) || restoreItems.length === 0) {
      return null
    }

    return {
      id: createDeleteUndoId('delete-undo-batch'),
      createdAt: Date.now(),
      deletedCount: countDeleteUndoItems(restoreItems),
      restoreItems,
      snapshot,
    }
  }, [])

  const pushDeleteUndoBatch = useCallback((batch: DeleteUndoBatch | null) => {
    if (!batch) {
      return
    }

    setDeleteUndoBatches((previous) => [batch, ...previous])
    showDeleteUndoNoticeMessage(`已删除 ${batch.deletedCount} 项`, 'default')
  }, [showDeleteUndoNoticeMessage])

  const buildRestoredSnapshot = useCallback((
    snapshot: DeleteUndoSnapshot,
    restoredAbsolutePathByOriginalAbsolutePath: Map<string, string>,
    failedOriginalAbsolutePathSet: Set<string>
  ): DeleteUndoSnapshot => {
    const projectionPathRemapById = new Map<string, Map<string, string>>()
    const remappedProjectionTabs = snapshot.projectionTabs
      .map((projection) => {
        const pathMap = new Map<string, string>()
        const remappedFiles = projection.files
          .map((file) => {
            const remappedFile = remapFileItemAfterRestore(
              file,
              file.sourceRootPath ?? snapshot.rootPath,
              restoredAbsolutePathByOriginalAbsolutePath
            )
            pathMap.set(file.path, remappedFile.path)
            return remappedFile
          })
          .filter((file) => {
            const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
            return !absolutePath || !failedOriginalAbsolutePathSet.has(normalizeAbsolutePath(absolutePath))
          })

        projectionPathRemapById.set(projection.id, pathMap)

        return {
          ...projection,
          files: remappedFiles,
        }
      })
      .filter((projection) => projection.files.length > 0)

    const remapProjectionPath = (tabId: string, path: string | null | undefined): string | null => {
      const normalizedPath = typeof path === 'string' ? path.trim() : ''
      if (!normalizedPath) {
        return null
      }
      const nextPath = projectionPathRemapById.get(tabId)?.get(normalizedPath)
      return nextPath ?? normalizedPath
    }

    const nextProjectionSelectedPathsById: Record<string, string[]> = {}
    const nextProjectionFocusedPathById: Record<string, string | null> = {}
    for (const projection of remappedProjectionTabs) {
      const visiblePathSet = new Set(projection.files.map((file) => file.path))
      const nextSelectedPaths = (snapshot.projectionSelectedPathsById[projection.id] ?? [])
        .map((path) => remapProjectionPath(projection.id, path))
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
        .filter((path) => visiblePathSet.has(path))
      if (nextSelectedPaths.length > 0) {
        nextProjectionSelectedPathsById[projection.id] = nextSelectedPaths
      }
      const nextFocusedPath = remapProjectionPath(
        projection.id,
        snapshot.projectionFocusedPathById[projection.id] ?? null
      )
      if (nextFocusedPath && visiblePathSet.has(nextFocusedPath)) {
        nextProjectionFocusedPathById[projection.id] = nextFocusedPath
      }
    }

    const nextDirectorySelectedPaths = snapshot.directorySelectedPaths
      .map((path) => remapPathForRoot(path, snapshot.rootPath, restoredAbsolutePathByOriginalAbsolutePath))
      .filter((path): path is string => Boolean(path))
      .filter((path) => !pathRefersToDeletedAbsolutePath(path, snapshot.rootPath, failedOriginalAbsolutePathSet))

    const nextDirectoryFocusedPath = (() => {
      const remappedPath = remapPathForRoot(
        snapshot.directoryFocusedPath,
        snapshot.rootPath,
        restoredAbsolutePathByOriginalAbsolutePath
      )
      if (pathRefersToDeletedAbsolutePath(remappedPath, snapshot.rootPath, failedOriginalAbsolutePathSet)) {
        return null
      }
      return remappedPath
    })()

    const remappedSelectedPreviewFile = snapshot.preview.selectedFile
      ? remapFileItemAfterRestore(
        snapshot.preview.selectedFile,
        snapshot.preview.selectedFile.sourceRootPath ?? snapshot.rootPath,
        restoredAbsolutePathByOriginalAbsolutePath
      )
      : null
    const remappedPreviewFile = snapshot.preview.previewFile
      ? remapFileItemAfterRestore(
        snapshot.preview.previewFile,
        snapshot.preview.previewFile.sourceRootPath ?? snapshot.rootPath,
        restoredAbsolutePathByOriginalAbsolutePath
      )
      : null

    const nextSelectedPreviewFile = (
      remappedSelectedPreviewFile
      && !pathRefersToDeletedAbsolutePath(
        remappedSelectedPreviewFile.absolutePath ?? remappedSelectedPreviewFile.path,
        remappedSelectedPreviewFile.sourceRootPath ?? snapshot.rootPath,
        failedOriginalAbsolutePathSet
      )
    )
      ? remappedSelectedPreviewFile
      : null
    const nextPreviewFile = (
      remappedPreviewFile
      && !pathRefersToDeletedAbsolutePath(
        remappedPreviewFile.absolutePath ?? remappedPreviewFile.path,
        remappedPreviewFile.sourceRootPath ?? snapshot.rootPath,
        failedOriginalAbsolutePathSet
      )
    )
      ? remappedPreviewFile
      : null

    const visibleTabIdSet = new Set(remappedProjectionTabs.map((projection) => projection.id))
    const nextActiveProjectionTabId = (
      snapshot.activeProjectionTabId
      && visibleTabIdSet.has(snapshot.activeProjectionTabId)
    )
      ? snapshot.activeProjectionTabId
      : (remappedProjectionTabs[0]?.id ?? null)
    const nextActiveSurface = (
      snapshot.activeSurface.kind === 'projection'
      && nextActiveProjectionTabId
    )
      ? { kind: 'projection' as const, tabId: nextActiveProjectionTabId }
      : { kind: 'directory' as const }

    return {
      ...snapshot,
      directorySelectedPaths: nextDirectorySelectedPaths,
      directoryFocusedPath: nextDirectoryFocusedPath,
      isResultPanelOpen: snapshot.isResultPanelOpen && remappedProjectionTabs.length > 0,
      projectionTabs: remappedProjectionTabs,
      activeProjectionTabId: nextActiveProjectionTabId,
      projectionSelectedPathsById: nextProjectionSelectedPathsById,
      projectionFocusedPathById: nextProjectionFocusedPathById,
      activeSurface: nextActiveSurface,
      preview: {
        showPreviewPane: snapshot.preview.showPreviewPane && nextSelectedPreviewFile?.kind === 'file',
        selectedFile: nextSelectedPreviewFile,
        previewFile: nextPreviewFile,
      },
    }
  }, [])

  const restoreDeleteUndoPreviewSnapshot = useCallback((previewSnapshot: DeleteUndoPreviewSnapshot) => {
    if (previewSnapshot.showPreviewPane && previewSnapshot.selectedFile?.kind === 'file') {
      showFileInPane(previewSnapshot.selectedFile)
    } else {
      closePreviewPane()
    }

    if (previewSnapshot.previewFile?.kind === 'file') {
      openFileInModal(previewSnapshot.previewFile)
    } else {
      closePreviewModal()
    }
  }, [closePreviewModal, closePreviewPane, openFileInModal, showFileInPane])

  const applyDeleteUndoSnapshot = useCallback(async (snapshot: DeleteUndoSnapshot) => {
    setFilter(cloneFilterState(snapshot.filter))

    if (isFlattenView !== snapshot.isFlattenView) {
      await setFlattenView(snapshot.isFlattenView)
    }

    lastNormalResultPanelHeightRef.current = snapshot.lastNormalResultPanelHeightPx
    setResultPanelHeightPx(snapshot.resultPanelHeightPx)
    setResultPanelDisplayMode(snapshot.resultPanelDisplayMode)
    setProjectionTabs(snapshot.projectionTabs.map((projection) => cloneResultProjection(projection)))
    setActiveProjectionTabId(snapshot.activeProjectionTabId)
    lastProjectionTabIdRef.current = snapshot.activeProjectionTabId
    setProjectionSelectedPathsById(cloneStringArrayRecord(snapshot.projectionSelectedPathsById))
    setDuplicateSelectionRuleByProjectionId(cloneDuplicateSelectionRuleRecord(snapshot.duplicateSelectionRuleByProjectionId))
    setProjectionFocusedPathById(cloneNullableStringRecord(snapshot.projectionFocusedPathById))
    setDirectorySelectedPaths([...snapshot.directorySelectedPaths])
    setDirectoryFocusedPath(snapshot.directoryFocusedPath)
    setIsResultPanelOpen(snapshot.isResultPanelOpen)
    setActiveSurface(
      snapshot.activeSurface.kind === 'projection' && snapshot.activeProjectionTabId
        ? { kind: 'projection', tabId: snapshot.activeProjectionTabId }
        : { kind: 'directory' }
    )

    restoreDeleteUndoPreviewSnapshot(snapshot.preview)
    await refreshAnnotationSnapshot()
  }, [
    isFlattenView,
    refreshAnnotationSnapshot,
    restoreDeleteUndoPreviewSnapshot,
    setFlattenView,
  ])

  const setProjectionSelectedPathsForTab = useCallback((tabId: string, selectedPaths: string[]) => {
    setProjectionSelectedPathsById((previous) => {
      const currentSelectedPaths = previous[tabId] ?? []
      if (areStringArraysEqual(currentSelectedPaths, selectedPaths)) {
        return previous
      }
      if (selectedPaths.length === 0) {
        if (!(tabId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[tabId]
        return next
      }
      return {
        ...previous,
        [tabId]: selectedPaths,
      }
    })
  }, [])

  const setDuplicateSelectionRuleForTab = useCallback((tabId: string, rule: DuplicateSelectionRule | null) => {
    setDuplicateSelectionRuleByProjectionId((previous) => {
      const currentRule = previous[tabId] ?? null
      if (currentRule === rule) {
        return previous
      }
      if (rule === null) {
        if (!(tabId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[tabId]
        return next
      }
      return {
        ...previous,
        [tabId]: rule,
      }
    })
  }, [])

  const activateProjectionSurface = useCallback((tabId: string, projection: ResultProjection | null) => {
    if (!projection) {
      return
    }
    setIsResultPanelOpen(true)
    setActiveProjectionTabId(tabId)
    lastProjectionTabIdRef.current = tabId
    setActiveSurface({ kind: 'projection', tabId })
    alignPreviewToProjection(projection, projectionFocusedPathById[tabId])
  }, [alignPreviewToProjection, projectionFocusedPathById])

  const activateProjectionSurfaceWithoutPreviewAlignment = useCallback((tabId: string) => {
    if (!isResultPanelOpen) {
      setIsResultPanelOpen(true)
    }
    if (activeProjectionTabId !== tabId) {
      setActiveProjectionTabId(tabId)
    }
    if (lastProjectionTabIdRef.current !== tabId) {
      lastProjectionTabIdRef.current = tabId
    }
    if (activeSurface.kind !== 'projection' || activeSurface.tabId !== tabId) {
      setActiveSurface({ kind: 'projection', tabId })
    }
  }, [activeProjectionTabId, activeSurface, isResultPanelOpen])

  const sanitizeProjectionAgainstDeletedFiles = useCallback((projection: ResultProjection): ResultProjection | null => {
    const deletedAbsolutePathSet = deletedProjectionAbsolutePathSetRef.current
    if (deletedAbsolutePathSet.size === 0) {
      return projection
    }

    const nextFiles = projection.files.filter((file) => {
      const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
      return !absolutePath || !deletedAbsolutePathSet.has(absolutePath)
    })
    if (nextFiles.length === 0) {
      return null
    }
    if (nextFiles.length === projection.files.length) {
      return projection
    }
    return {
      ...projection,
      files: nextFiles,
    }
  }, [])

  const handleActivateProjection = useCallback((projection: ResultProjection) => {
    const sanitizedProjection = sanitizeProjectionAgainstDeletedFiles(projection)
    if (!sanitizedProjection) {
      return
    }
    setProjectionTabs((previous) => {
      const existingIndex = previous.findIndex((item) => item.id === sanitizedProjection.id)
      if (existingIndex < 0) {
        return [...previous, sanitizedProjection]
      }
      const next = [...previous]
      next[existingIndex] = sanitizedProjection
      return next
    })
    activateProjectionSurface(sanitizedProjection.id, sanitizedProjection)
  }, [activateProjectionSurface, sanitizeProjectionAgainstDeletedFiles])

  const handleActivateProjectionTab = useCallback((tabId: string) => {
    const targetProjection = projectionTabs.find((projection) => projection.id === tabId)
    activateProjectionSurface(tabId, targetProjection ?? null)
  }, [activateProjectionSurface, projectionTabs])

  const handleOpenResultPanel = useCallback(() => {
    const fallbackTabId = activeProjectionTab?.id ?? lastProjectionTabIdRef.current ?? projectionTabs[0]?.id ?? null
    if (!fallbackTabId) return
    const targetProjection = projectionTabs.find((projection) => projection.id === fallbackTabId) ?? null
    activateProjectionSurface(fallbackTabId, targetProjection)
  }, [activeProjectionTab?.id, activateProjectionSurface, projectionTabs])

  const handleCloseResultPanel = useCallback(() => {
    setIsResultPanelOpen(false)
    setActiveSurface({ kind: 'directory' })
    alignPreviewToPath(directoryFocusedPath)
  }, [alignPreviewToPath, directoryFocusedPath])

  const handleToggleResultPanelMaximized = useCallback(() => {
    const fallbackTabId = activeProjectionTab?.id ?? projectionTabs[0]?.id ?? null
    if (fallbackTabId) {
      const targetProjection = projectionTabs.find((projection) => projection.id === fallbackTabId) ?? null
      setActiveProjectionTabId(fallbackTabId)
      lastProjectionTabIdRef.current = fallbackTabId
      setActiveSurface({ kind: 'projection', tabId: fallbackTabId })
      alignPreviewToProjection(targetProjection, projectionFocusedPathById[fallbackTabId])
    }
    setResultPanelDisplayMode((previous) => {
      if (previous === 'maximized') {
        setResultPanelHeightPx(lastNormalResultPanelHeightRef.current)
        return 'normal'
      }
      return 'maximized'
    })
  }, [activeProjectionTab?.id, alignPreviewToProjection, projectionFocusedPathById, projectionTabs])

  const handleResultPanelResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (resultPanelDisplayMode !== 'normal') return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = resultPanelHeightPx

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = clampResultPanelHeightPx(startHeight + (startY - moveEvent.clientY))
      lastNormalResultPanelHeightRef.current = nextHeight
      setResultPanelHeightPx(nextHeight)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [resultPanelDisplayMode, resultPanelHeightPx])

  const handleCloseProjectionTab = useCallback((tabId: string) => {
    const closingIndex = projectionTabs.findIndex((projection) => projection.id === tabId)
    const remainingTabs = projectionTabs.filter((projection) => projection.id !== tabId)
    const nextActiveTabId = (() => {
      if (remainingTabs.length === 0) return null
      if (closingIndex < 0) return remainingTabs[0]?.id ?? null
      return remainingTabs[closingIndex]?.id ?? remainingTabs[closingIndex - 1]?.id ?? remainingTabs[0]?.id ?? null
    })()

    setProjectionTabs(remainingTabs)
    setProjectionSelectedPathsById((previous) => {
      if (!(tabId in previous)) return previous
      const next = { ...previous }
      delete next[tabId]
      return next
    })
    setDuplicateSelectionRuleByProjectionId((previous) => {
      if (!(tabId in previous)) return previous
      const next = { ...previous }
      delete next[tabId]
      return next
    })
    setProjectionFocusedPathById((previous) => {
      if (!(tabId in previous)) return previous
      const next = { ...previous }
      delete next[tabId]
      return next
    })

    if (lastProjectionTabIdRef.current === tabId) {
      lastProjectionTabIdRef.current = nextActiveTabId
    }

    setActiveProjectionTabId(nextActiveTabId)
    if (!nextActiveTabId) {
      setIsResultPanelOpen(false)
      setActiveSurface({ kind: 'directory' })
      alignPreviewToPath(directoryFocusedPath)
      return
    }

    if (activeSurface.kind === 'projection' && activeSurface.tabId === tabId) {
      const nextProjection = remainingTabs.find((projection) => projection.id === nextActiveTabId) ?? null
      setActiveSurface({ kind: 'projection', tabId: nextActiveTabId })
      alignPreviewToProjection(nextProjection, projectionFocusedPathById[nextActiveTabId])
    }
  }, [activeSurface, alignPreviewToPath, alignPreviewToProjection, directoryFocusedPath, projectionFocusedPathById, projectionTabs])

  const handleDismissProjectionTool = useCallback((toolName: string) => {
    handleCloseProjectionTab(toToolScopedProjectionId(toolName))
  }, [handleCloseProjectionTab])

  const handleProjectionGridSelectionChange = useCallback((selectedPaths: string[]) => {
    if (!activeProjectionTabId) return
    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTabId)
    setProjectionSelectedPathsForTab(activeProjectionTabId, selectedPaths)
  }, [activeProjectionTabId, activateProjectionSurfaceWithoutPreviewAlignment, setProjectionSelectedPathsForTab])

  const handleApplyDuplicateSelectionRule = useCallback((rule: DuplicateSelectionRule) => {
    if (!activeProjectionTab || !isDuplicateProjection(activeProjectionTab)) {
      return
    }
    const nextSelectedPaths = buildDuplicateSelectionForProjection(activeProjectionTab.files, rule)
    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTab.id)
    setProjectionSelectedPathsForTab(activeProjectionTab.id, nextSelectedPaths)
    setDuplicateSelectionRuleForTab(activeProjectionTab.id, rule)
  }, [
    activateProjectionSurfaceWithoutPreviewAlignment,
    activeProjectionTab,
    setDuplicateSelectionRuleForTab,
    setProjectionSelectedPathsForTab,
  ])

  const handleClearDuplicateSelection = useCallback(() => {
    if (!activeProjectionTab || !isDuplicateProjection(activeProjectionTab)) {
      return
    }
    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTab.id)
    setProjectionSelectedPathsForTab(activeProjectionTab.id, [])
    setDuplicateSelectionRuleForTab(activeProjectionTab.id, null)
  }, [
    activateProjectionSurfaceWithoutPreviewAlignment,
    activeProjectionTab,
    setDuplicateSelectionRuleForTab,
    setProjectionSelectedPathsForTab,
  ])

  const handleReapplyDuplicateGroup = useCallback((groupId: string) => {
    if (!activeProjectionTab || !isDuplicateProjection(activeProjectionTab) || !activeDuplicateSelectionRule) {
      return
    }

    const targetGroup = groupDuplicateProjectionFiles(activeProjectionTab.files).find((group) => group.groupId === groupId)
    if (!targetGroup) {
      return
    }

    const currentSelectedPaths = projectionSelectedPathsById[activeProjectionTab.id] ?? []
    const nextSelectedPaths = replaceDuplicateGroupSelection(
      activeProjectionTab.files,
      currentSelectedPaths,
      groupId,
      buildDuplicateSelectionForGroup(targetGroup.items, activeDuplicateSelectionRule)
    )

    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTab.id)
    setProjectionSelectedPathsForTab(activeProjectionTab.id, nextSelectedPaths)
  }, [
    activateProjectionSurfaceWithoutPreviewAlignment,
    activeDuplicateSelectionRule,
    activeProjectionTab,
    projectionSelectedPathsById,
    setProjectionSelectedPathsForTab,
  ])

  const handleClearDuplicateGroup = useCallback((groupId: string) => {
    if (!activeProjectionTab || !isDuplicateProjection(activeProjectionTab)) {
      return
    }

    const currentSelectedPaths = projectionSelectedPathsById[activeProjectionTab.id] ?? []
    const nextSelectedPaths = replaceDuplicateGroupSelection(
      activeProjectionTab.files,
      currentSelectedPaths,
      groupId,
      []
    )

    activateProjectionSurfaceWithoutPreviewAlignment(activeProjectionTab.id)
    setProjectionSelectedPathsForTab(activeProjectionTab.id, nextSelectedPaths)
  }, [
    activateProjectionSurfaceWithoutPreviewAlignment,
    activeProjectionTab,
    projectionSelectedPathsById,
    setProjectionSelectedPathsForTab,
  ])

  const pruneDeletedFilesFromProjectionTabs = useCallback((params: {
    deletedAbsolutePaths?: string[]
    deletedProjectionPaths?: string[]
    projectionTabId?: string | null
  }) => {
    if (projectionTabs.length === 0) {
      return
    }

    const deletedAbsolutePathSet = new Set(
      (params.deletedAbsolutePaths ?? [])
        .map((item) => item.trim())
        .filter(Boolean)
    )
    for (const absolutePath of deletedAbsolutePathSet) {
      deletedProjectionAbsolutePathSetRef.current.add(absolutePath)
    }
    const deletedProjectionPathSet = new Set(
      (params.deletedProjectionPaths ?? [])
        .map((item) => normalizeRelativePath(item))
        .filter(Boolean)
    )
    if (deletedAbsolutePathSet.size === 0 && deletedProjectionPathSet.size === 0) {
      return
    }

    let didChange = false
    const nextTabs = projectionTabs
      .map((projection) => {
        const isTargetProjection = projection.id === params.projectionTabId
        const nextFiles = projection.files.filter((file) => {
          const absolutePath = typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''
          const filePath = normalizeRelativePath(file.path)
          if (absolutePath && deletedAbsolutePathSet.has(absolutePath)) {
            return false
          }
          if (isTargetProjection && filePath && deletedProjectionPathSet.has(filePath)) {
            return false
          }
          return true
        })
        if (nextFiles.length !== projection.files.length) {
          didChange = true
        }
        return nextFiles.length === projection.files.length
          ? projection
          : {
            ...projection,
            files: nextFiles,
          }
      })
      .filter((projection) => projection.files.length > 0)

    if (!didChange && nextTabs.length === projectionTabs.length) {
      return
    }

    const nextTabIdSet = new Set(nextTabs.map((projection) => projection.id))
    setProjectionTabs(nextTabs)
    setProjectionSelectedPathsById((previous) => {
      const next: Record<string, string[]> = {}
      for (const projection of nextTabs) {
        const visiblePathSet = new Set(projection.files.map((file) => file.path))
        const nextSelectedPaths = (previous[projection.id] ?? []).filter((path) => visiblePathSet.has(path))
        if (nextSelectedPaths.length > 0) {
          next[projection.id] = nextSelectedPaths
        }
      }
      return next
    })
    setDuplicateSelectionRuleByProjectionId((previous) => {
      const next: Record<string, DuplicateSelectionRule | null> = {}
      for (const [tabId, rule] of Object.entries(previous)) {
        if (nextTabIdSet.has(tabId)) {
          next[tabId] = rule
        }
      }
      return next
    })
    setProjectionFocusedPathById((previous) => {
      const next: Record<string, string | null> = {}
      for (const projection of nextTabs) {
        const currentFocusedPath = previous[projection.id] ?? null
        const visiblePathSet = new Set(projection.files.map((file) => file.path))
        if (currentFocusedPath && visiblePathSet.has(currentFocusedPath)) {
          next[projection.id] = currentFocusedPath
        }
      }
      return next
    })

    const nextActiveTabId = (() => {
      if (nextTabs.length === 0) return null
      if (activeProjectionTabId && nextTabIdSet.has(activeProjectionTabId)) {
        return activeProjectionTabId
      }
      return nextTabs[0]?.id ?? null
    })()

    setActiveProjectionTabId(nextActiveTabId)
    if (!nextActiveTabId) {
      lastProjectionTabIdRef.current = null
      setIsResultPanelOpen(false)
      setActiveSurface({ kind: 'directory' })
      return
    }

    if (activeSurface.kind === 'projection' && !nextTabIdSet.has(activeSurface.tabId)) {
      setActiveSurface({ kind: 'projection', tabId: nextActiveTabId })
    }
    if (lastProjectionTabIdRef.current && !nextTabIdSet.has(lastProjectionTabIdRef.current)) {
      lastProjectionTabIdRef.current = nextActiveTabId
    }
  }, [activeProjectionTabId, activeSurface, projectionTabs])

  const createDeleteUndoBatchFromParams = useCallback((
    params: WorkspaceMutationCommitParams | PreviewMutationCommitParams | undefined
  ): DeleteUndoBatch | null => {
    if (params?.mutationToolName !== 'fs.softDelete') {
      return null
    }
    return buildDeleteUndoBatch(params.undoRestoreItems, captureDeleteUndoSnapshot())
  }, [buildDeleteUndoBatch, captureDeleteUndoSnapshot])

  const handleWorkspaceMutationCommitted = useCallback(async (params?: WorkspaceMutationCommitParams) => {
    const deleteUndoBatch = createDeleteUndoBatchFromParams(params)
    if (
      params?.mutationToolName === 'fs.softDelete'
      && (
        (Array.isArray(params.deletedAbsolutePaths) && params.deletedAbsolutePaths.length > 0)
        || (Array.isArray(params.deletedProjectionPaths) && params.deletedProjectionPaths.length > 0)
      )
    ) {
      pruneDeletedFilesFromProjectionTabs({
        deletedAbsolutePaths: params.deletedAbsolutePaths,
        deletedProjectionPaths: params.deletedProjectionPaths,
        projectionTabId: params.projectionTabId,
      })
    }
    await navigateToPath(currentPath)
    await refreshAnnotationSnapshot()
    pushDeleteUndoBatch(deleteUndoBatch)
  }, [
    createDeleteUndoBatchFromParams,
    currentPath,
    navigateToPath,
    pruneDeletedFilesFromProjectionTabs,
    pushDeleteUndoBatch,
    refreshAnnotationSnapshot,
  ])

  const resolveNextFileAfterDelete = useCallback((deletedRelativePath: string): FileItem | null => {
    const normalizedDeletedPath = normalizeRelativePath(deletedRelativePath)
    if (!normalizedDeletedPath || activeSurfaceFileItems.length <= 1) return null

    const deletedIndex = activeSurfaceFileItems.findIndex((file) => (
      normalizeRelativePath(file.path) === normalizedDeletedPath
    ))
    if (deletedIndex < 0) return null

    const nextIndex = (deletedIndex + 1) % activeSurfaceFileItems.length
    const nextFile = activeSurfaceFileItems[nextIndex]
    if (!nextFile) return null
    if (normalizeRelativePath(nextFile.path) === normalizedDeletedPath) return null
    return nextFile
  }, [activeSurfaceFileItems])

  const handlePreviewMutationCommitted = useCallback(async (params?: PreviewMutationCommitParams) => {
    const deleteUndoBatch = createDeleteUndoBatchFromParams(params)
    const preferredPreviewPath = normalizeRelativePath(params?.preferredPreviewPath || '')
    if (preferredPreviewPath) {
      alignPreviewToPath(preferredPreviewPath)
      await navigateToPath(currentPath)
      await refreshAnnotationSnapshot()
      pushDeleteUndoBatch(deleteUndoBatch)
      return
    }

    if (params?.mutationToolName === 'fs.softDelete') {
      const activePreviewFile = previewFile ?? selectedFile
      const fallbackProjectionTabId = params.projectionTabId
        ?? (activeSurface.kind === 'projection' ? activeSurface.tabId : null)
      const fallbackDeletedProjectionPaths = (
        Array.isArray(params.deletedProjectionPaths) && params.deletedProjectionPaths.length > 0
      )
        ? params.deletedProjectionPaths
        : (
          fallbackProjectionTabId && activePreviewFile?.kind === 'file'
            ? [activePreviewFile.path]
            : []
        )
      const fallbackDeletedAbsolutePaths = (
        Array.isArray(params.deletedAbsolutePaths) && params.deletedAbsolutePaths.length > 0
      )
        ? params.deletedAbsolutePaths
        : (
          activePreviewFile?.kind === 'file' && typeof activePreviewFile.absolutePath === 'string' && activePreviewFile.absolutePath.trim()
            ? [activePreviewFile.absolutePath.trim()]
            : []
        )
      if (fallbackDeletedAbsolutePaths.length > 0 || fallbackDeletedProjectionPaths.length > 0) {
        pruneDeletedFilesFromProjectionTabs({
          deletedAbsolutePaths: fallbackDeletedAbsolutePaths,
          deletedProjectionPaths: fallbackDeletedProjectionPaths,
          projectionTabId: fallbackProjectionTabId,
        })
      }

      const deletedRelativePath = normalizeRelativePath(params.deletedRelativePath || '')
      const activePreviewPath = activePreviewFile?.kind === 'file'
        ? normalizeRelativePath(activePreviewFile.path)
        : ''

      if (
        deletedRelativePath
        && activePreviewFile?.kind === 'file'
        && activePreviewPath === deletedRelativePath
      ) {
        const previewKind = getFilePreviewKind(activePreviewFile.name)
        if (isMediaPreviewKind(previewKind)) {
          if (previewFile) {
            navigateMediaFromModal('next')
          } else {
            navigateMediaFromPane('next')
          }
        } else {
          const nextFile = resolveNextFileAfterDelete(deletedRelativePath)
          if (nextFile) {
            showFileInPane(nextFile)
          }
        }
      }
    }

    await navigateToPath(currentPath)
    await refreshAnnotationSnapshot()
    pushDeleteUndoBatch(deleteUndoBatch)
  }, [
    activeSurface,
    alignPreviewToPath,
    createDeleteUndoBatchFromParams,
    currentPath,
    navigateMediaFromModal,
    navigateMediaFromPane,
    navigateToPath,
    previewFile,
    pushDeleteUndoBatch,
    pruneDeletedFilesFromProjectionTabs,
    refreshAnnotationSnapshot,
    resolveNextFileAfterDelete,
    selectedFile,
    showFileInPane,
  ])

  const handleUndoDelete = useCallback(async () => {
    const batch = deleteUndoBatches[0]
    if (!batch || isUndoingDelete) {
      return
    }

    setIsUndoingDelete(true)

    try {
      const response = await callGatewayHttp<RestoreRecycleResponse>('/v1/recycle/items/restore', {
        items: batch.restoreItems,
      }, 120000)
      const responseItems = Array.isArray(response.items) ? response.items : []
      const restoredAbsolutePathByOriginalAbsolutePath = new Map<string, string>()
      const failedRestoreItems: DeleteUndoRestoreItem[] = []

      batch.restoreItems.forEach((restoreItem, index) => {
        const responseItem = responseItems[index]
        const nextAbsolutePath = typeof responseItem?.nextAbsolutePath === 'string'
          ? responseItem.nextAbsolutePath.trim()
          : ''
        if (responseItem?.ok === true && nextAbsolutePath) {
          const normalizedNextAbsolutePath = normalizeAbsolutePath(nextAbsolutePath)
          restoredAbsolutePathByOriginalAbsolutePath.set(
            normalizeAbsolutePath(restoreItem.originalAbsolutePath),
            normalizedNextAbsolutePath
          )
          return
        }
        failedRestoreItems.push(restoreItem)
      })

      const failedOriginalAbsolutePathSet = new Set(
        failedRestoreItems.map((item) => normalizeAbsolutePath(item.originalAbsolutePath))
      )
      const restoredCount = restoredAbsolutePathByOriginalAbsolutePath.size
      const remainingUndoBatches = deleteUndoBatches.slice(1)
      const retrySnapshot = buildRestoredSnapshot(
        batch.snapshot,
        restoredAbsolutePathByOriginalAbsolutePath,
        new Set()
      )
      const restoredSnapshot = buildRestoredSnapshot(
        batch.snapshot,
        restoredAbsolutePathByOriginalAbsolutePath,
        failedOriginalAbsolutePathSet
      )
      const failedRetryBatch = failedRestoreItems.length > 0
        ? {
          id: createDeleteUndoId('delete-undo-batch'),
          createdAt: Date.now(),
          deletedCount: failedRestoreItems.length,
          restoreItems: failedRestoreItems,
          snapshot: retrySnapshot,
        }
        : null

      if (failedRetryBatch) {
        setDeleteUndoBatches([failedRetryBatch, ...remainingUndoBatches])
      } else {
        setDeleteUndoBatches(remainingUndoBatches)
      }

      if (restoredCount === 0) {
        showDeleteUndoNoticeMessage('撤销删除失败，请重试', 'error')
        setIsUndoingDelete(false)
        return
      }

      for (const restoredAbsolutePath of restoredAbsolutePathByOriginalAbsolutePath.values()) {
        deletedProjectionAbsolutePathSetRef.current.delete(normalizeAbsolutePath(restoredAbsolutePath))
      }

      const shouldNavigateBack = (
        rootId !== restoredSnapshot.historyEntry.rootId
        || normalizeRelativePath(currentPath) !== normalizeRelativePath(restoredSnapshot.historyEntry.path)
      )
      if (shouldNavigateBack) {
        const reopened = await openHistoryEntry(restoredSnapshot.historyEntry)
        if (!reopened) {
          showDeleteUndoNoticeMessage(
            failedRetryBatch
              ? `已恢复 ${restoredCount} 项，但仍有 ${failedRetryBatch.deletedCount} 项待重试，且无法自动跳回原目录`
              : `已恢复 ${restoredCount} 项，但无法自动跳回原目录`,
            'error'
          )
          setIsUndoingDelete(false)
          return
        }
      }

      setPendingDeleteUndoRestore({ snapshot: restoredSnapshot })
      if (failedRetryBatch) {
        showDeleteUndoNoticeMessage(
          `已恢复 ${restoredCount} 项，仍有 ${failedRetryBatch.deletedCount} 项撤销失败`,
          'error'
        )
      } else {
        setDeleteUndoNotice(null)
      }
    } catch (error) {
      showDeleteUndoNoticeMessage(
        error instanceof Error ? error.message : '撤销删除失败',
        'error'
      )
      setIsUndoingDelete(false)
    }
  }, [
    buildRestoredSnapshot,
    currentPath,
    deleteUndoBatches,
    isUndoingDelete,
    openHistoryEntry,
    rootId,
    showDeleteUndoNoticeMessage,
  ])

  const handleOpenTrash = useCallback(() => {
    if (!hasTrashEntries) return
    void navigateToPath(TRASH_ROUTE_PATH, { resetFlattenView: true })
  }, [hasTrashEntries, navigateToPath])

  const canOpenPeople = useMemo(() => (
    pluginTools.some((tool) => tool.name === 'vision.face' && tool.scopes.includes('workspace'))
  ), [pluginTools])

  const handleOpenPeople = useCallback(() => {
    if (!canOpenPeople) return
    setPeoplePanelPreferredPersonId(null)
    setShowPeoplePanel(true)
  }, [canOpenPeople])

  const handleOpenPeopleForPerson = useCallback((personId: string | null) => {
    if (!canOpenPeople) return
    setPeoplePanelPreferredPersonId(personId)
    setShowPeoplePanel(true)
  }, [canOpenPeople])

  const handleClosePeople = useCallback(() => {
    setShowPeoplePanel(false)
  }, [])

  const handleOpenFaceSource = useCallback(async (face: FaceRecord): Promise<boolean> => {
    const sourcePath = normalizeCurrentRootFaceSourcePath(face.assetPath)
    if (!sourcePath) return false

    const sourceFile = (
      activeSurfaceFiles.find((file) => (
        file.kind === 'file' && normalizeRelativePath(file.path) === sourcePath
      ))
      ?? filteredFiles.find((file) => (
        file.kind === 'file' && normalizeRelativePath(file.path) === sourcePath
      ))
      ?? {
        name: getRelativeFileName(sourcePath),
        path: sourcePath,
        kind: 'file' as const,
        sourceRootPath: getBoundRootPath(rootId) ?? undefined,
        sourceRelativePath: sourcePath,
      }
    )

    setActiveSurface({ kind: 'directory' })
    setDirectoryFocusedPath(sourcePath)
    preloadPreviewModules()
    showFileInPane(sourceFile)

    const parentPath = getRelativeParentPath(sourcePath)
    if (normalizeRelativePath(currentPath) === parentPath) {
      return true
    }

    alignPreviewToPath(sourcePath)
    const navigated = await navigateToPath(parentPath, { resetFlattenView: true })
    if (!navigated) return false
    alignPreviewToPath(sourcePath)
    return true
  }, [activeSurfaceFiles, alignPreviewToPath, currentPath, filteredFiles, navigateToPath, rootId, showFileInPane])

  const handleProjectFaceSources = useCallback((selectedFaces: FaceRecord[]): boolean => {
    const boundRootPath = getBoundRootPath(rootId)
    const existingFileByPath = new Map(
      [...activeSurfaceFiles, ...filteredFiles]
        .filter((file) => file.kind === 'file')
        .map((file) => [normalizeRelativePath(file.path), file])
    )
    const fileByKey = new Map<string, FileItem>()

    for (const face of selectedFaces) {
      const relativePath = normalizeCurrentRootFaceSourcePath(face.assetPath)
      if (relativePath) {
        const existingFile = existingFileByPath.get(relativePath)
        const absolutePath = boundRootPath ? joinAbsolutePath(boundRootPath, relativePath) : undefined
        const nextFile: FileItem = existingFile
          ? {
            ...existingFile,
            sourceRootPath: existingFile.sourceRootPath ?? boundRootPath ?? undefined,
            sourceRelativePath: existingFile.sourceRelativePath ?? relativePath,
            absolutePath: existingFile.absolutePath ?? absolutePath,
          }
          : {
            name: getRelativeFileName(relativePath),
            path: relativePath,
            kind: 'file',
            absolutePath,
            displayPath: relativePath,
            previewKind: getFilePreviewKind(relativePath),
            sourceType: 'face_source',
            sourceRootPath: boundRootPath ?? undefined,
            sourceRelativePath: relativePath,
          }

        if (!fileByKey.has(`relative:${relativePath}`)) {
          fileByKey.set(`relative:${relativePath}`, nextFile)
        }
        continue
      }

      const absolutePath = normalizeAbsoluteFaceSourcePath(face.assetPath)
      if (!absolutePath) continue

      if (!fileByKey.has(`absolute:${absolutePath}`)) {
        fileByKey.set(`absolute:${absolutePath}`, {
          name: getRelativeFileName(absolutePath),
          path: absolutePath,
          kind: 'file',
          absolutePath,
          displayPath: absolutePath,
          previewKind: getFilePreviewKind(absolutePath),
          sourceType: 'face_source',
        })
      }
    }

    const projectionFiles = [...fileByKey.values()]
    if (projectionFiles.length === 0) {
      return false
    }

    const projection: ResultProjection = {
      id: FACE_SOURCE_PROJECTION_ID,
      title: `人脸来源 ${projectionFiles.length} 个文件`,
      entry: 'manual',
      ordering: {
        mode: 'listed',
      },
      files: projectionFiles,
    }

    handleActivateProjection(projection)
    setShowPeoplePanel(false)
    return true
  }, [activeSurfaceFiles, filteredFiles, handleActivateProjection, rootId])

  useEffect(() => {
    if (!rootId) return
    setRecentPathHistory((previous) => upsertAddressPathHistory(previous, {
      rootId,
      rootName: rootHandle.name || '根目录',
      path: currentPath,
    }))
  }, [currentPath, rootId, rootHandle.name])

  useEffect(() => {
    saveAddressPathHistory(recentPathHistory)
  }, [recentPathHistory])

  useEffect(() => {
    if (!deleteUndoNotice) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setDeleteUndoNotice((previous) => (
        previous?.id === deleteUndoNotice.id
          ? null
          : previous
      ))
    }, DELETE_UNDO_NOTICE_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [deleteUndoNotice])

  useEffect(() => {
    if (!pendingDeleteUndoRestore) {
      return
    }
    if (rootId !== pendingDeleteUndoRestore.snapshot.historyEntry.rootId) {
      return
    }
    if (
      normalizeRelativePath(currentPath)
      !== normalizeRelativePath(pendingDeleteUndoRestore.snapshot.historyEntry.path)
    ) {
      return
    }

    let cancelled = false
    const snapshot = pendingDeleteUndoRestore.snapshot
    setPendingDeleteUndoRestore(null)

    const applyPendingRestore = async () => {
      try {
        await applyDeleteUndoSnapshot(snapshot)
      } catch (error) {
        if (!cancelled) {
          showDeleteUndoNoticeMessage(
            error instanceof Error ? error.message : '恢复删除前状态失败',
            'error'
          )
        }
      } finally {
        if (!cancelled) {
          setIsUndoingDelete(false)
        }
      }
    }

    void applyPendingRestore()
    return () => {
      cancelled = true
    }
  }, [
    applyDeleteUndoSnapshot,
    currentPath,
    pendingDeleteUndoRestore,
    rootId,
    showDeleteUndoNoticeMessage,
  ])

  useEffect(() => {
    setDirectorySelectedPaths([])
    setDirectoryFocusedPath(null)
  }, [currentPath])

  useEffect(() => {
    setProjectionTabs([])
    setActiveProjectionTabId(null)
    setActiveSurface({ kind: 'directory' })
    setProjectionSelectedPathsById({})
    setDuplicateSelectionRuleByProjectionId({})
    setProjectionFocusedPathById({})
    setDirectorySelectedPaths([])
    setDirectoryFocusedPath(null)
    setIsResultPanelOpen(false)
  }, [rootId])

  useEffect(() => {
    if (resultPanelDisplayMode === 'normal') {
      lastNormalResultPanelHeightRef.current = resultPanelHeightPx
    }
  }, [resultPanelDisplayMode, resultPanelHeightPx])

  useEffect(() => {
    if (resultPanelDisplayMode !== 'normal') return

    const handleResize = () => {
      setResultPanelHeightPx((previous) => clampResultPanelHeightPx(previous))
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [resultPanelDisplayMode])

  useEffect(() => {
    if (projectionTabs.length === 0) {
      if (activeProjectionTabId !== null) {
        setActiveProjectionTabId(null)
      }
      return
    }

    if (!activeProjectionTabId || !projectionTabs.some((projection) => projection.id === activeProjectionTabId)) {
      const fallbackTabId = projectionTabs[0]?.id ?? null
      setActiveProjectionTabId(fallbackTabId)
      lastProjectionTabIdRef.current = fallbackTabId
    }
  }, [activeProjectionTabId, projectionTabs])

  useEffect(() => {
    if (activeSurface.kind !== 'projection') return
    if (projectionTabs.some((projection) => projection.id === activeSurface.tabId)) return
    setActiveSurface({ kind: 'directory' })
    alignPreviewToPath(directoryFocusedPath)
  }, [activeSurface, alignPreviewToPath, directoryFocusedPath, projectionTabs])

  useEffect(() => {
    let disposed = false

    const refreshTrashAvailability = async () => {
      let hasLegacyTrashEntries = false
      try {
        const itemCount = await getDirectoryItemCount(rootHandle, LEGACY_TRASH_RELATIVE_PATH, 1)
        hasLegacyTrashEntries = itemCount > 0
      } catch {
        hasLegacyTrashEntries = false
      }

      try {
        const result = await callGatewayHttp<{ items?: unknown[] }>('/v1/recycle/items/list', {
          includeRootTrash: false,
          includeGlobalRecycle: true,
        }, 120000)
        if (!disposed) {
          const globalRecycleCount = Array.isArray(result.items) ? result.items.length : 0
          setHasTrashEntries(hasLegacyTrashEntries || globalRecycleCount > 0)
        }
      } catch {
        if (!disposed) {
          setHasTrashEntries(hasLegacyTrashEntries)
        }
      }
    }

    void refreshTrashAvailability()
    return () => {
      disposed = true
    }
  }, [files, rootHandle])

  useEffect(() => {
    void preloadAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
    })
  }, [rootHandle, rootId])

  useEffect(() => {
    if (!isAnnotationFilterGateResolved || showAnnotationFilterControls) return
    setFilter((previous) => {
      if (isAnnotationFilterAtDefault(previous)) return previous
      return {
        ...previous,
        annotationFilterMode: 'all',
        annotationIncludeMatchMode: 'or',
        annotationIncludeTagKeys: [],
        annotationExcludeTagKeys: [],
      }
    })
  }, [isAnnotationFilterGateResolved, showAnnotationFilterControls])

  useEffect(() => {
    let disposed = false
    let refreshTimerId: number | null = null
    let loadSnapshot: (() => Promise<GatewayCapabilitiesSnapshot>) | null = null

    const refreshCapabilities = async () => {
      try {
        if (!loadSnapshot) {
          const module = await import('@/lib/gateway')
          loadSnapshot = module.loadGatewayCapabilities
        }
        const snapshot = await loadSnapshot()
        if (disposed) return
        setPluginTools(snapshot.online ? snapshot.tools : [])
      } catch {
        if (!disposed) {
          setPluginTools([])
        }
      }
    }

    void refreshCapabilities()
    refreshTimerId = window.setInterval(() => {
      void refreshCapabilities()
    }, GATEWAY_CAPABILITY_REFRESH_INTERVAL_MS)

    return () => {
      disposed = true
      if (refreshTimerId !== null) {
        window.clearInterval(refreshTimerId)
      }
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      preloadPreviewModules()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (selectedFile?.kind !== 'file') return
    if (activeSurface.kind === 'projection') {
      const activeProjection = projectionTabs.find((projection) => projection.id === activeSurface.tabId) ?? null
      if (!activeProjection || !activeProjection.files.some((file) => file.path === selectedFile.path)) {
        return
      }
      setProjectionFocusedPathById((previous) => (
        previous[activeSurface.tabId] === selectedFile.path
          ? previous
          : {
            ...previous,
            [activeSurface.tabId]: selectedFile.path,
          }
      ))
      return
    }
    setDirectoryFocusedPath((previous) => (previous === selectedFile.path ? previous : selectedFile.path))
  }, [activeSurface, projectionTabs, selectedFile])

  useEffect(() => {
    const activeGridRef = activeSurface.kind === 'projection' ? projectionFileGridRef : directoryFileGridRef
    activeGridRef.current?.syncSelectedPath(selectedFile?.path ?? null, {
      scroll: true,
      focus: false,
    })
  }, [activeSurface, selectedFile])

  useEffect(() => {
    if (!hasActiveVideoPreview) return
    applyVideoPlaybackRateToActivePreviewVideo(videoPlaybackRate)
  }, [applyVideoPlaybackRateToActivePreviewVideo, hasActiveVideoPreview, videoPlaybackRate])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const isTyping = isTypingTarget(event.target)

      if (matchesAnyShortcut(event, keyboardShortcuts.app.openDirectory)) {
        event.preventDefault()
        void selectDirectory()
        return
      }

      if (isTyping) return
      if (matchesAnyShortcut(event, keyboardShortcuts.app.undoDelete)) {
        event.preventDefault()
        void handleUndoDelete()
        return
      }
      const matchedPreviewTagShortcut = getMatchingPreviewTagShortcut(event)

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.toggleVideoPlayPause)) {
        event.preventDefault()
        if (event.repeat) return
        toggleActivePreviewVideoPlayback()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.seekBackward)) {
        event.preventDefault()
        seekActivePreviewVideo('backward')
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.seekForward)) {
        event.preventDefault()
        seekActivePreviewVideo('forward')
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveVideoPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.cycleVideoPlaybackRate)) {
        event.preventDefault()
        if (event.repeat) return
        cycleVideoPlaybackRate()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveMediaPreview && matchesAnyShortcut(event, keyboardShortcuts.preview.toggleAutoPlay)) {
        event.preventDefault()
        toggleAutoPlay()
        return
      }

      if (!matchedPreviewTagShortcut && hasActiveMediaPreview) {
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.togglePlaybackOrder)) {
          event.preventDefault()
          togglePlaybackOrder()
          return
        }
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.prev)) {
          event.preventDefault()
          if (previewFile) {
            navigateMediaFromModal('prev')
          } else {
            navigateMediaFromPane('prev')
          }
          return
        }
        if (matchesAnyShortcut(event, keyboardShortcuts.preview.next)) {
          event.preventDefault()
          if (previewFile) {
            navigateMediaFromModal('next')
          } else {
            navigateMediaFromPane('next')
          }
          return
        }
      }

      if (matchesAnyShortcut(event, keyboardShortcuts.app.navigateUp) && currentPath) {
        event.preventDefault()
        void navigateUp()
        return
      }

      if (!matchedPreviewTagShortcut && matchesAnyShortcut(event, keyboardShortcuts.preview.close)) {
        if (previewFile) {
          event.preventDefault()
          closePreviewModal()
          return
        }
        if (showPreviewPane) {
          event.preventDefault()
          closePreviewPane()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    keyboardShortcuts,
    closePreviewModal,
    closePreviewPane,
    hasActiveMediaPreview,
    hasActiveVideoPreview,
    handleUndoDelete,
    currentPath,
    getMatchingPreviewTagShortcut,
    navigateMediaFromModal,
    navigateMediaFromPane,
    navigateUp,
    previewFile,
    seekActivePreviewVideo,
    selectDirectory,
    showPreviewPane,
    cycleVideoPlaybackRate,
    toggleActivePreviewVideoPlayback,
    toggleAutoPlay,
    togglePlaybackOrder,
  ])

  const getAdaptiveDefaultPaneWidthRatio = useCallback((containerWidth: number) => {
    if (containerWidth <= 0 || thumbnailSizePreset !== '512') {
      return DEFAULT_PANE_WIDTH_RATIO
    }

    const requiredGridWidth = requiredGridWidthForColumns(
      TARGET_GRID_COLUMNS_AT_512_PRESET,
      FILE_GRID_CARD_SIZE_BY_PRESET['512'].width
    )
    const maxPaneRatioForThreeColumns = 1 - requiredGridWidth / containerWidth
    const adaptiveRatio = Math.min(DEFAULT_PANE_WIDTH_RATIO, maxPaneRatioForThreeColumns)

    return Math.min(MAX_PANE_WIDTH_RATIO, Math.max(MIN_PANE_WIDTH_RATIO, adaptiveRatio))
  }, [thumbnailSizePreset])

  useEffect(() => {
    if (!showPreviewPane || isPaneWidthManualRef.current) return

    const applyAdaptiveDefault = () => {
      const containerWidth = contentRef.current?.parentElement?.offsetWidth ?? window.innerWidth
      const nextRatio = getAdaptiveDefaultPaneWidthRatio(containerWidth)
      setPaneWidthRatio((currentRatio) => {
        if (Math.abs(currentRatio - nextRatio) < 0.001) {
          return currentRatio
        }
        return nextRatio
      })
    }

    applyAdaptiveDefault()
    window.addEventListener('resize', applyAdaptiveDefault)
    return () => window.removeEventListener('resize', applyAdaptiveDefault)
  }, [showPreviewPane, getAdaptiveDefaultPaneWidthRatio])

  useEffect(() => {
    if (!isPaneWidthManualRef.current) return
    savePersistedPreviewPaneWidthRatio(paneWidthRatio)
  }, [paneWidthRatio])

  const handlePreviewPaneResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    isPaneWidthManualRef.current = true
    const startX = event.clientX
    const startRatio = paneWidthRatio

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const containerWidth = contentRef.current?.parentElement?.offsetWidth || window.innerWidth
      const delta = (startX - moveEvent.clientX) / containerWidth
      const newRatio = startRatio + delta
      setPaneWidthRatio(clampPaneWidthRatio(newRatio))
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [paneWidthRatio])

  return (
    <ExplorerWorkspaceLayout
      filter={filter}
      onFilterChange={handleFilterChange}
      rootName={rootHandle.name}
      currentPath={currentPath}
      rootId={rootId}
      onNavigateToPath={handleNavigateToPath}
      onNavigateHistoryEntry={handleNavigateHistoryEntry}
      onListChildDirectories={listChildDirectories}
      recentPathHistory={recentPathHistory}
      onNavigateUp={navigateUp}
      isFlattenView={isFlattenView}
      onToggleFlattenView={() => {
        void setFlattenView(!isFlattenView)
      }}
      totalCount={totalCount}
      imageCount={imageCount}
      videoCount={videoCount}
      showAnnotationFilterControls={showAnnotationFilterControls}
      annotationFilterTagOptions={annotationFilterTagOptions}
      onOpenAnnotationFilterPanel={handleOpenAnnotationFilterPanel}
      thumbnailSizePreset={thumbnailSizePreset}
      onThumbnailSizePresetChange={setThumbnailSizePreset}
      canOpenTrash={hasTrashEntries}
      onOpenTrash={handleOpenTrash}
      canOpenPeople={canOpenPeople}
      onOpenPeople={handleOpenPeople}
      shortcutHelpEntries={shortcutHelpEntries}
      onOpenPeopleForPerson={handleOpenPeopleForPerson}
      showPeoplePanel={showPeoplePanel}
      peoplePanelPreferredPersonId={peoplePanelPreferredPersonId}
      onClosePeoplePanel={handleClosePeople}
      onOpenFaceSource={handleOpenFaceSource}
      onProjectFaceSources={handleProjectFaceSources}
      error={error}
      isLoading={isLoading}
      favoriteFolders={favoriteFolders}
      isCurrentPathFavorited={isCurrentPathFavorited}
      onOpenFavoriteFolder={openFavoriteFolder}
      onRemoveFavoriteFolder={removeFavoriteFolder}
      onToggleCurrentPathFavorite={toggleCurrentFolderFavorite}
      directoryFiles={filteredFiles}
      activeSurfaceFiles={activeSurfaceFiles}
      rootHandle={rootHandle}
      directoryFileGridRef={directoryFileGridRef}
      projectionFileGridRef={projectionFileGridRef}
      onDirectoryFileClick={handleDirectoryFileClick}
      onDirectoryFileDoubleClick={handleDirectoryFileDoubleClick}
      onProjectionFileClick={handleProjectionFileClick}
      onProjectionFileDoubleClick={handleProjectionFileDoubleClick}
      onDirectoryClick={handleDirectoryClick}
      onDirectoryGridSelectionChange={setDirectorySelectedPaths}
      directoryGridSelectedPaths={directorySelectedPaths}
      projectionTabs={projectionTabs}
      activeProjectionTabId={activeProjectionTab?.id ?? null}
      onProjectionGridSelectionChange={handleProjectionGridSelectionChange}
      projectionGridSelectedPaths={projectionGridSelectedPaths}
      activeDuplicateSelectionRule={activeDuplicateSelectionRule}
      onApplyDuplicateSelectionRule={handleApplyDuplicateSelectionRule}
      onClearDuplicateSelection={handleClearDuplicateSelection}
      onReapplyDuplicateGroup={handleReapplyDuplicateGroup}
      onClearDuplicateGroup={handleClearDuplicateGroup}
      isDirectorySurfaceActive={isDirectorySurfaceActive}
      isResultPanelOpen={isResultPanelOpen}
      resultPanelDisplayMode={resultPanelDisplayMode}
      resultPanelHeightPx={resultPanelHeightPx}
      onOpenResultPanel={handleOpenResultPanel}
      onCloseResultPanel={handleCloseResultPanel}
      onToggleResultPanelMaximized={handleToggleResultPanelMaximized}
      onResultPanelResizeStart={handleResultPanelResizeStart}
      onActivateProjectionTab={handleActivateProjectionTab}
      onCloseProjectionTab={handleCloseProjectionTab}
      onWorkspaceMutationCommitted={handleWorkspaceMutationCommitted}
      onPreviewMutationCommitted={handlePreviewMutationCommitted}
      showPreviewPane={showPreviewPane}
      hasOpenPreview={hasOpenPreview}
      contentRef={contentRef}
      paneWidthRatio={paneWidthRatio}
      onPreviewPaneResizeStart={handlePreviewPaneResizeStart}
      selectedFile={selectedFile}
      gridSelectedCount={selectedGridItems.length}
      selectedGridMetaFile={selectedGridMetaFile}
      pluginTools={pluginTools}
      onClosePane={closePreviewPane}
      onOpenFullscreenFromPane={openFullscreenFromPane}
      autoPlayEnabled={autoPlayEnabled}
      autoPlayIntervalSec={autoPlayIntervalSec}
      videoSeekStepSec={videoSeekStepSec}
      videoPlaybackRate={videoPlaybackRate}
      faceBboxVisible={faceBboxVisible}
      onToggleAutoPlay={toggleAutoPlay}
      playbackOrder={playbackOrder}
      onTogglePlaybackOrder={togglePlaybackOrder}
      onToggleFaceBboxVisible={toggleFaceBboxVisible}
      onAutoPlayIntervalChange={setAutoPlayInterval}
      onVideoSeekStepChange={setVideoSeekStep}
      onVideoPlaybackRateChange={setVideoPlaybackRate}
      onVideoEnded={handleAutoPlayVideoEnded}
      onVideoPlaybackError={handleAutoPlayVideoPlaybackError}
      previewFile={previewFile}
      previewAutoPlayOnOpen={previewAutoPlayOnOpen}
      onClosePreview={closePreviewModal}
      activeProjection={activeSurfaceProjection}
      onActivateProjection={handleActivateProjection}
      onDismissProjectionTool={handleDismissProjectionTool}
      deleteUndoNoticeMessage={deleteUndoNotice?.message ?? null}
      deleteUndoNoticeTone={deleteUndoNotice?.tone ?? 'default'}
      canUndoDelete={deleteUndoBatches.length > 0}
      isUndoingDelete={isUndoingDelete}
      onUndoDelete={() => {
        void handleUndoDelete()
      }}
    />
  )
}
