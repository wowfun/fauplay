import type { FavoriteFolderEntry, FileItem } from '../../../types/index.ts'
import { isFavoriteFolderActive } from './favoriteFolderModel.ts'

export interface RemoteFileSystemRootEntry {
  id: string
  label: string
}

export interface RemoteFileSystemFavoriteEntry {
  rootId: string
  path: string
  favoritedAtMs: number
}

export interface RemoteFavoriteFolderEntriesParams {
  roots: RemoteFileSystemRootEntry[]
  items: RemoteFileSystemFavoriteEntry[]
  rootLabelFallback: string
  toUiRootId: (rootId: string) => string
}

export interface ResolveRemoteListingRequestPlanParams {
  configRootId: string
  targetPath: string
  flattenView: boolean
}

export type RemoteListingRequestPlan =
  | { kind: 'none' }
  | {
    kind: 'list'
    rootId: string
    path: string
    flattenView: boolean
  }

export interface ResolveRemoteFavoriteFolderMutationPlanParams {
  uiRootId: string | null | undefined
  configRootId: string | null | undefined
  currentPath: string
  favoriteFolders: FavoriteFolderEntry[]
  virtualTrashPath: string
}

export type RemoteFavoriteFolderMutationPlan =
  | { kind: 'none' }
  | {
    kind: 'remove' | 'upsert'
    rootId: string
    path: string
  }

interface RemoteListingItemCandidate {
  name?: unknown
  path?: unknown
  kind?: unknown
  isEmpty?: unknown
  size?: unknown
  lastModifiedMs?: unknown
  mimeType?: unknown
  previewKind?: unknown
  displayPath?: unknown
}

export function normalizeRemoteRootRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

export function resolveRemoteListingRequestPlan({
  configRootId,
  targetPath,
  flattenView,
}: ResolveRemoteListingRequestPlanParams): RemoteListingRequestPlan {
  const rootId = configRootId.trim()
  if (!rootId) return { kind: 'none' }
  return {
    kind: 'list',
    rootId,
    path: normalizeRemoteRootRelativePath(targetPath),
    flattenView,
  }
}

export function resolveRemoteFavoriteFolderMutationPlan({
  uiRootId,
  configRootId,
  currentPath,
  favoriteFolders,
  virtualTrashPath,
}: ResolveRemoteFavoriteFolderMutationPlanParams): RemoteFavoriteFolderMutationPlan {
  const normalizedUiRootId = uiRootId?.trim() ?? ''
  const rootId = configRootId?.trim() ?? ''
  if (!normalizedUiRootId || !rootId) return { kind: 'none' }

  const path = normalizeRemoteRootRelativePath(currentPath)
  if (path === normalizeRemoteRootRelativePath(virtualTrashPath)) return { kind: 'none' }

  return {
    kind: isFavoriteFolderActive(favoriteFolders, {
      rootId: normalizedUiRootId,
      path,
      virtualTrashPath,
    }) ? 'remove' : 'upsert',
    rootId,
    path,
  }
}

export function createRemoteChildDirectoryPath(currentPath: string, dirName: string): string {
  const normalizedCurrentPath = normalizeRemoteRootRelativePath(currentPath)
  const normalizedDirName = normalizeRemoteRootRelativePath(dirName)
  return normalizedCurrentPath ? `${normalizedCurrentPath}/${normalizedDirName}` : normalizedDirName
}

export function resolveRemoteParentPath(currentPath: string): string | null {
  const normalizedPath = normalizeRemoteRootRelativePath(currentPath)
  if (!normalizedPath) return null
  return normalizedPath.split('/').slice(0, -1).join('/')
}

export function buildRemoteRootEntryMap(
  roots: RemoteFileSystemRootEntry[],
): Map<string, RemoteFileSystemRootEntry> {
  return new Map(roots.map((root) => [root.id, root]))
}

export function parseRemoteListingItems(payload: unknown, configRootId: string): FileItem[] {
  if (!payload || typeof payload !== 'object') return []
  const payloadItems = (payload as { items?: unknown }).items
  const rawItems = Array.isArray(payloadItems)
    ? payloadItems
    : []

  return rawItems.flatMap((item) => parseRemoteListingItem(item, configRootId))
}

export function toRemoteChildDirectoryNames(payload: unknown, configRootId: string): string[] {
  return parseRemoteListingItems(payload, configRootId)
    .filter((item) => item.kind === 'directory')
    .map((item) => item.name)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))
}

export function toRemoteFavoriteFolderEntries({
  roots,
  items,
  rootLabelFallback,
  toUiRootId,
}: RemoteFavoriteFolderEntriesParams): FavoriteFolderEntry[] {
  const rootEntryById = buildRemoteRootEntryMap(roots)
  return items.flatMap((item) => {
    const rootEntry = rootEntryById.get(item.rootId)
    if (!rootEntry) return []
    return [{
      rootId: toUiRootId(item.rootId),
      rootName: rootEntry.label || rootLabelFallback,
      path: normalizeRemoteRootRelativePath(item.path),
      favoritedAt: item.favoritedAtMs,
    }]
  })
}

function parseRemoteListingItem(item: unknown, configRootId: string): FileItem[] {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return []
  const candidate = item as RemoteListingItemCandidate
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const filePath = typeof candidate.path === 'string' ? normalizeRemoteRootRelativePath(candidate.path) : ''
  const kind = candidate.kind === 'directory' ? 'directory' : candidate.kind === 'file' ? 'file' : null
  if (!name || !filePath || !kind) return []

  const lastModifiedMs = Number.isFinite(Number(candidate.lastModifiedMs))
    ? Number(candidate.lastModifiedMs)
    : undefined

  return [{
    name,
    path: filePath,
    kind,
    remoteRootId: configRootId,
    isEmpty: typeof candidate.isEmpty === 'boolean' ? candidate.isEmpty : undefined,
    size: Number.isFinite(Number(candidate.size)) ? Number(candidate.size) : undefined,
    lastModifiedMs,
    lastModified: typeof lastModifiedMs === 'number' ? new Date(lastModifiedMs) : undefined,
    mimeType: typeof candidate.mimeType === 'string' ? candidate.mimeType : undefined,
    previewKind: candidate.previewKind as FileItem['previewKind'],
    displayPath: typeof candidate.displayPath === 'string' ? candidate.displayPath : filePath,
  }]
}
