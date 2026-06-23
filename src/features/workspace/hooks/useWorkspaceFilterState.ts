import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { FilterState, ListingQueryState } from '@/types'

const WORKSPACE_FILTER_STATE_BY_ROOT_STORAGE_KEY_PREFIX = 'fauplay:workspace-filter-state:roots:v1'

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

interface UseWorkspaceFilterStateParams {
  rootId: string | null | undefined
  storageNamespace: string
  onUserFilterChange?: () => void
}

interface UseWorkspaceFilterStateResult {
  filter: FilterState
  setFilter: Dispatch<SetStateAction<FilterState>>
  handleFilterChange: (nextFilter: FilterState) => void
  listingQuery: ListingQueryState
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function cloneFilterState(filter: FilterState): FilterState {
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

function toListingQueryState(filter: FilterState): ListingQueryState {
  return {
    search: filter.search,
    type: filter.type,
    hideEmptyFolders: filter.hideEmptyFolders,
    sortBy: filter.sortBy === 'date' || filter.sortBy === 'size' ? filter.sortBy : 'name',
    sortOrder: filter.sortOrder,
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

function toWorkspaceFilterStorageKey(storageNamespace: string): string {
  return `${WORKSPACE_FILTER_STATE_BY_ROOT_STORAGE_KEY_PREFIX}:${storageNamespace}`
}

function savePersistedWorkspaceFilterStateByRoot(
  storageNamespace: string,
  states: PersistedWorkspaceFilterStateByRoot
): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(toWorkspaceFilterStorageKey(storageNamespace), JSON.stringify(states))
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

function loadPersistedWorkspaceFilterStateByRoot(storageNamespace: string): PersistedWorkspaceFilterStateByRoot {
  if (typeof window === 'undefined') return {}

  try {
    const parsed = parsePersistedWorkspaceFilterStateByRoot(
      window.localStorage.getItem(toWorkspaceFilterStorageKey(storageNamespace))
    )
    if (parsed.shouldRewrite) {
      savePersistedWorkspaceFilterStateByRoot(storageNamespace, parsed.states)
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

export function isAnnotationFilterAtDefault(filter: FilterState): boolean {
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

export function useWorkspaceFilterState({
  rootId,
  storageNamespace,
  onUserFilterChange,
}: UseWorkspaceFilterStateParams): UseWorkspaceFilterStateResult {
  const persistedWorkspaceFilterStateByRootRef = useRef<PersistedWorkspaceFilterStateByRoot>(
    loadPersistedWorkspaceFilterStateByRoot(storageNamespace)
  )
  const hydratedFilterRootIdRef = useRef<string | null>(rootId ?? null)
  const skipNextFilterPersistRef = useRef(true)
  const [filter, setFilter] = useState<FilterState>(() => (
    loadPersistedWorkspaceFilterStateForRoot(rootId, persistedWorkspaceFilterStateByRootRef.current)
  ))
  const handleFilterChange = useCallback((nextFilter: FilterState) => {
    onUserFilterChange?.()
    setFilter(withSyncedAnnotationFilterMode(nextFilter))
  }, [onUserFilterChange])
  const listingQuery = useMemo(() => toListingQueryState(filter), [filter])

  useEffect(() => {
    if (hydratedFilterRootIdRef.current === rootId) return
    hydratedFilterRootIdRef.current = null
    skipNextFilterPersistRef.current = true
    setFilter(loadPersistedWorkspaceFilterStateForRoot(rootId, persistedWorkspaceFilterStateByRootRef.current))
    hydratedFilterRootIdRef.current = rootId ?? null
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
    savePersistedWorkspaceFilterStateByRoot(storageNamespace, persistedWorkspaceFilterStateByRootRef.current)
  }, [filter, rootId, storageNamespace])

  return {
    filter,
    setFilter,
    handleFilterChange,
    listingQuery,
  }
}
