import type { FileItem, ListingQueryState } from '../../../types/index.ts'

export interface RuntimeListingPageCursor {
  rootPath: string
  rootRelativePath: string
  flattened: boolean
  query: ListingQueryState
  nextOffset: number
}

export interface RuntimeListingQueryRequest {
  nameContains: string
  entryFilter: ListingQueryState['type']
  hideEmptyFolders: boolean
  sortBy: ListingQueryState['sortBy']
  sortOrder: ListingQueryState['sortOrder']
}

export const DEFAULT_LISTING_QUERY: ListingQueryState = {
  search: '',
  type: 'all',
  hideEmptyFolders: false,
  sortBy: 'name',
  sortOrder: 'asc',
}

export function normalizeListingQuery(query: ListingQueryState): ListingQueryState {
  return {
    search: typeof query.search === 'string' ? query.search.trim() : '',
    type: query.type === 'image' || query.type === 'video' ? query.type : 'all',
    hideEmptyFolders: query.hideEmptyFolders === true,
    sortBy: query.sortBy === 'date' || query.sortBy === 'size' ? query.sortBy : 'name',
    sortOrder: query.sortOrder === 'desc' ? 'desc' : 'asc',
  }
}

export function isSameListingQuery(left: ListingQueryState, right: ListingQueryState): boolean {
  return (
    left.search === right.search
    && left.type === right.type
    && left.hideEmptyFolders === right.hideEmptyFolders
    && left.sortBy === right.sortBy
    && left.sortOrder === right.sortOrder
  )
}

export function toRuntimeListingQueryRequest(query: ListingQueryState): RuntimeListingQueryRequest {
  return {
    nameContains: query.search,
    entryFilter: query.type,
    hideEmptyFolders: query.hideEmptyFolders,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  }
}

export function isSameRuntimeListingPageCursor(
  left: RuntimeListingPageCursor | null,
  right: RuntimeListingPageCursor
): boolean {
  return Boolean(
    left
    && left.rootPath === right.rootPath
    && left.rootRelativePath === right.rootRelativePath
    && left.flattened === right.flattened
    && isSameListingQuery(left.query, right.query)
    && left.nextOffset === right.nextOffset
  )
}

export function sortTrashFileItems(items: FileItem[]): FileItem[] {
  return [...items].sort((left, right) => {
    const leftDeletedAt = Number(left.deletedAt ?? 0)
    const rightDeletedAt = Number(right.deletedAt ?? 0)
    if (leftDeletedAt !== rightDeletedAt) {
      return rightDeletedAt - leftDeletedAt
    }
    const sourceOrder = String(left.sourceType || '').localeCompare(String(right.sourceType || ''))
    if (sourceOrder !== 0) {
      return sourceOrder
    }
    return left.path.localeCompare(right.path)
  })
}
