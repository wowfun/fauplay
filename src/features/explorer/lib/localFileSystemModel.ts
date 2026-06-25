import type { CachedRootEntry, FileItem } from '../../../types/index.ts'

export interface LocalDirectoryListing {
  directories: FileItem[]
  files: FileItem[]
}

export interface LocalListingItemsOptions {
  basePath: string
  flattened: boolean
}

export interface LocalRootBindingEntry {
  rootId: string
  rootPath: string
}

export interface MergeCachedLocalRootEntriesParams {
  cachedRoots: CachedRootEntry[]
  bindings: LocalRootBindingEntry[]
  rootLabelFallback: string
}

export interface ResolveLocalNavigationTargetParams {
  targetPath: string
  currentFlattened: boolean
  resetFlattened: boolean
  virtualTrashPath: string
}

export interface LocalNavigationTarget {
  path: string
  isVirtualTrash: boolean
  flattened: boolean
}

export function normalizeLocalRootRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

export function readLocalRootNameFromPath(path: string, fallback: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || fallback
}

export function isLocalVirtualTrashPath(path: string, virtualTrashPath: string): boolean {
  return normalizeLocalRootRelativePath(path) === normalizeLocalRootRelativePath(virtualTrashPath)
}

export function createLocalChildDirectoryPath(currentPath: string, dirName: string): string {
  const normalizedCurrentPath = normalizeLocalRootRelativePath(currentPath)
  const normalizedDirName = normalizeLocalRootRelativePath(dirName)
  return normalizedCurrentPath ? `${normalizedCurrentPath}/${normalizedDirName}` : normalizedDirName
}

export function resolveLocalParentPath(currentPath: string, virtualTrashPath: string): string | null {
  const normalizedPath = normalizeLocalRootRelativePath(currentPath)
  if (isLocalVirtualTrashPath(normalizedPath, virtualTrashPath)) return ''
  if (!normalizedPath) return null
  return normalizedPath.split('/').slice(0, -1).join('/')
}

export function resolveLocalNavigationTarget({
  targetPath,
  currentFlattened,
  resetFlattened,
  virtualTrashPath,
}: ResolveLocalNavigationTargetParams): LocalNavigationTarget {
  const path = normalizeLocalRootRelativePath(targetPath)
  const isVirtualTrash = isLocalVirtualTrashPath(path, virtualTrashPath)
  return {
    path,
    isVirtualTrash,
    flattened: isVirtualTrash || resetFlattened ? false : currentFlattened,
  }
}

export function sortLocalChildDirectoryNames(names: string[]): string[] {
  return [...names].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))
}

export function mergeCachedLocalRootEntries({
  cachedRoots,
  bindings,
  rootLabelFallback,
}: MergeCachedLocalRootEntriesParams): CachedRootEntry[] {
  const cachedEntriesByRootId = new Map<string, CachedRootEntry>()

  for (const entry of cachedRoots) {
    cachedEntriesByRootId.set(entry.rootId, {
      ...entry,
      boundRootPath: findLocalRootBindingPath(bindings, entry.rootId) ?? undefined,
    })
  }

  for (const binding of bindings) {
    const existing = cachedEntriesByRootId.get(binding.rootId)
    if (existing) {
      cachedEntriesByRootId.set(binding.rootId, {
        ...existing,
        boundRootPath: binding.rootPath,
      })
      continue
    }

    cachedEntriesByRootId.set(binding.rootId, {
      rootId: binding.rootId,
      rootName: readLocalRootNameFromPath(binding.rootPath, rootLabelFallback),
      lastUsedAt: 0,
      boundRootPath: binding.rootPath,
    })
  }

  return [...cachedEntriesByRootId.values()]
}

export function toLocalListingItems(
  listing: LocalDirectoryListing,
  options: LocalListingItemsOptions,
): FileItem[] {
  const items = options.flattened
    ? listing.files
    : [...listing.directories, ...listing.files]
  return applyLocalListingBasePath(items, options.basePath)
}

export function applyLocalListingBasePath(items: FileItem[], basePath: string): FileItem[] {
  const normalizedBasePath = normalizeLocalRootRelativePath(basePath)
  if (!normalizedBasePath) return items
  return items.map((item) => ({
    ...item,
    path: `${normalizedBasePath}/${normalizeLocalRootRelativePath(item.path)}`,
  }))
}

function findLocalRootBindingPath(bindings: LocalRootBindingEntry[], rootId: string): string | null {
  return bindings.find((binding) => binding.rootId === rootId)?.rootPath ?? null
}
