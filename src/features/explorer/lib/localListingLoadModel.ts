import type { RuntimeListDirectoryRequest } from '../../../lib/runtimeApi/types.ts'
import type { FileItem, ListingQueryState } from '../../../types/index.ts'
import {
  type RuntimeListingPageCursor,
  isSameListingQuery,
  normalizeListingQuery,
  toRuntimeListingQueryRequest,
} from './listingQueryModel.ts'
import {
  isLocalVirtualTrashPath,
  normalizeLocalRootRelativePath,
} from './localFileSystemModel.ts'

export interface CreateRuntimeListingRequestParams {
  rootPath: string | null
  rootRelativePath: string
  flattened: boolean
  pageSize: number
  query: ListingQueryState
  offset?: number
}

export interface CreateRuntimeListingPageCursorParams {
  rootPath: string
  rootRelativePath: string
  flattened: boolean
  query: ListingQueryState
  isTruncated: boolean
  nextOffset: number | null
}

export interface AppendRuntimeListingPageItemsParams {
  previousItems: FileItem[]
  nextItems: FileItem[]
}

export interface ResolveListingQueryUpdateParams {
  currentQuery: ListingQueryState
  nextQuery: ListingQueryState
  rootId: string | null
  currentPath: string
  virtualTrashPath: string
  hasBoundRootPath: boolean
}

export type ListingQueryUpdate =
  | {
    type: 'unchanged'
    query: ListingQueryState
  }
  | {
    type: 'state-only'
    query: ListingQueryState
  }
  | {
    type: 'reload-runtime-listing'
    query: ListingQueryState
  }

export function createRuntimeListingRequest({
  rootPath,
  rootRelativePath,
  flattened,
  pageSize,
  query,
  offset,
}: CreateRuntimeListingRequestParams): RuntimeListDirectoryRequest | null {
  if (!rootPath) return null

  return {
    rootPath,
    rootRelativePath: normalizeLocalRootRelativePath(rootRelativePath),
    flattened,
    limit: pageSize,
    ...(typeof offset === 'number' ? { offset } : {}),
    ...toRuntimeListingQueryRequest(query),
  }
}

export function createRuntimeListingPageCursor({
  rootPath,
  rootRelativePath,
  flattened,
  query,
  isTruncated,
  nextOffset,
}: CreateRuntimeListingPageCursorParams): RuntimeListingPageCursor | null {
  if (!isTruncated || nextOffset === null) return null

  return {
    rootPath,
    rootRelativePath: normalizeLocalRootRelativePath(rootRelativePath),
    flattened,
    query,
    nextOffset,
  }
}

export function appendRuntimeListingPageItems({
  previousItems,
  nextItems,
}: AppendRuntimeListingPageItemsParams): FileItem[] {
  const existingPaths = new Set(previousItems.map((item) => item.path))
  const appendedItems = nextItems.filter((item) => !existingPaths.has(item.path))
  if (appendedItems.length === 0) return previousItems
  return [...previousItems, ...appendedItems]
}

export function resolveListingQueryUpdate({
  currentQuery,
  nextQuery,
  rootId,
  currentPath,
  virtualTrashPath,
  hasBoundRootPath,
}: ResolveListingQueryUpdateParams): ListingQueryUpdate {
  const query = normalizeListingQuery(nextQuery)
  if (isSameListingQuery(currentQuery, query)) {
    return {
      type: 'unchanged',
      query,
    }
  }

  if (!rootId || isLocalVirtualTrashPath(currentPath, virtualTrashPath) || !hasBoundRootPath) {
    return {
      type: 'state-only',
      query,
    }
  }

  return {
    type: 'reload-runtime-listing',
    query,
  }
}
