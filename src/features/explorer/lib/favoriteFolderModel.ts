import type { FavoriteFolderEntry } from '../../../types/index.ts'

export interface FavoriteFolderModelOptions {
  maxItems: number
  rootLabelFallback: string
}

export interface FavoriteFolderPathOptions {
  rootId: string | null | undefined
  path: string
  virtualTrashPath: string
}

export interface ToggleFavoriteFolderParams extends FavoriteFolderModelOptions, FavoriteFolderPathOptions {
  rootName: string
  favoritedAt: number
}

export interface RemoveFavoriteFolderParams {
  rootId: string
  path: string
}

export interface UpdateFavoriteFolderRootNameParams extends FavoriteFolderModelOptions {
  rootId: string
  rootName: string
}

export interface ParsedFavoriteFolders {
  entries: FavoriteFolderEntry[]
  shouldRewrite: boolean
}

export function normalizeFavoriteFolderPath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

export function dedupeFavoriteFolders(
  entries: FavoriteFolderEntry[],
  options: FavoriteFolderModelOptions
): FavoriteFolderEntry[] {
  const latestEntryByKey = new Map<string, FavoriteFolderEntry>()

  for (const item of entries) {
    if (!item.rootId) continue
    const normalizedPath = normalizeFavoriteFolderPath(item.path)
    const favoritedAt = Number.isFinite(item.favoritedAt) ? item.favoritedAt : 0
    const key = `${item.rootId}:${normalizedPath}`
    const existing = latestEntryByKey.get(key)
    if (!existing || favoritedAt > existing.favoritedAt) {
      latestEntryByKey.set(key, {
        rootId: item.rootId,
        rootName: item.rootName || options.rootLabelFallback,
        path: normalizedPath,
        favoritedAt,
      })
    }
  }

  return [...latestEntryByKey.values()]
    .sort((left, right) => right.favoritedAt - left.favoritedAt)
    .slice(0, options.maxItems)
}

export function parseFavoriteFolders(raw: string | null, options: FavoriteFolderModelOptions): ParsedFavoriteFolders {
  if (!raw) return { entries: [], shouldRewrite: false }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return { entries: [], shouldRewrite: true }

    let hasInvalidEntry = false
    let hasFallbackRootName = false
    const validEntries: FavoriteFolderEntry[] = []

    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        hasInvalidEntry = true
        continue
      }
      const candidate = item as Partial<FavoriteFolderEntry>
      if (
        typeof candidate.rootId !== 'string'
        || typeof candidate.path !== 'string'
        || typeof candidate.favoritedAt !== 'number'
      ) {
        hasInvalidEntry = true
        continue
      }

      if (typeof candidate.rootName !== 'string') {
        hasFallbackRootName = true
      }
      validEntries.push({
        rootId: candidate.rootId,
        rootName: candidate.rootName || options.rootLabelFallback,
        path: candidate.path,
        favoritedAt: candidate.favoritedAt,
      })
    }

    const dedupedEntries = dedupeFavoriteFolders(validEntries, options)
    return {
      entries: dedupedEntries,
      shouldRewrite: hasInvalidEntry || hasFallbackRootName || dedupedEntries.length !== validEntries.length,
    }
  } catch {
    return { entries: [], shouldRewrite: true }
  }
}

export function removeFavoriteFolder(
  entries: FavoriteFolderEntry[],
  params: RemoveFavoriteFolderParams
): FavoriteFolderEntry[] {
  const targetPath = normalizeFavoriteFolderPath(params.path)
  const targetKey = `${params.rootId}:${targetPath}`
  return entries.filter((item) => {
    const key = `${item.rootId}:${normalizeFavoriteFolderPath(item.path)}`
    return key !== targetKey
  })
}

export function isFavoriteFolderActive(
  entries: FavoriteFolderEntry[],
  params: FavoriteFolderPathOptions
): boolean {
  if (!params.rootId) return false
  const normalizedPath = normalizeFavoriteFolderPath(params.path)
  if (normalizedPath === normalizeFavoriteFolderPath(params.virtualTrashPath)) return false
  return entries.some((item) => (
    item.rootId === params.rootId
    && normalizeFavoriteFolderPath(item.path) === normalizedPath
  ))
}

export function toggleFavoriteFolder(
  entries: FavoriteFolderEntry[],
  params: ToggleFavoriteFolderParams
): FavoriteFolderEntry[] {
  if (!params.rootId) return entries
  const normalizedPath = normalizeFavoriteFolderPath(params.path)
  if (normalizedPath === normalizeFavoriteFolderPath(params.virtualTrashPath)) return entries

  const targetKey = `${params.rootId}:${normalizedPath}`
  const alreadyFavorited = entries.some((item) => {
    const key = `${item.rootId}:${normalizeFavoriteFolderPath(item.path)}`
    return key === targetKey
  })
  if (alreadyFavorited) {
    return removeFavoriteFolder(entries, {
      rootId: params.rootId,
      path: normalizedPath,
    })
  }

  return dedupeFavoriteFolders([{
    rootId: params.rootId,
    rootName: params.rootName || params.rootLabelFallback,
    path: normalizedPath,
    favoritedAt: params.favoritedAt,
  }, ...entries], params)
}

export function updateFavoriteFolderRootName(
  entries: FavoriteFolderEntry[],
  params: UpdateFavoriteFolderRootNameParams
): FavoriteFolderEntry[] {
  const latestRootName = params.rootName || params.rootLabelFallback
  let hasChanged = false
  const updated = entries.map((item) => {
    if (item.rootId !== params.rootId || item.rootName === latestRootName) {
      return item
    }
    hasChanged = true
    return {
      ...item,
      rootName: latestRootName,
    }
  })

  if (!hasChanged) return entries
  return dedupeFavoriteFolders(updated, params)
}
