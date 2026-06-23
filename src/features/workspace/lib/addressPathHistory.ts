import type { AddressPathHistoryEntry } from '@/types'

const ADDRESS_PATH_HISTORY_STORAGE_KEY_PREFIX = 'fauplay:address-path-history'
const MAX_ADDRESS_PATH_HISTORY_ITEMS = 20

interface ParsedAddressPathHistory {
  entries: AddressPathHistoryEntry[]
  shouldRewrite: boolean
}

function normalizeRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function toAddressHistoryStorageKey(storageNamespace: string): string {
  return `${ADDRESS_PATH_HISTORY_STORAGE_KEY_PREFIX}:${storageNamespace}`
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

export function loadAddressPathHistory(storageNamespace: string): AddressPathHistoryEntry[] {
  if (typeof window === 'undefined') return []
  const parsed = parseAddressPathHistory(window.localStorage.getItem(toAddressHistoryStorageKey(storageNamespace)))
  if (parsed.shouldRewrite) {
    saveAddressPathHistory(storageNamespace, parsed.entries)
  }
  return parsed.entries
}

export function saveAddressPathHistory(storageNamespace: string, history: AddressPathHistoryEntry[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(toAddressHistoryStorageKey(storageNamespace), JSON.stringify(history))
}

export function upsertAddressPathHistory(
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
