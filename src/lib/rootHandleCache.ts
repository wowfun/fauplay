import type { CachedRootEntry } from '@/types'

const ROOT_HANDLE_CACHE_DB_NAME = 'fauplay-root-handle-cache'
const ROOT_HANDLE_CACHE_DB_VERSION = 1
const ROOT_HANDLE_CACHE_STORE_NAME = 'roots'
export const MAX_CACHED_ROOT_ITEMS = 10

interface RootHandleCacheRecord {
  rootId: string
  handle: FileSystemDirectoryHandle
  lastUsedAt: number
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function createRootId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `root-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function sanitizeRecord(raw: unknown): RootHandleCacheRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<RootHandleCacheRecord>
  if (typeof candidate.rootId !== 'string') return null
  if (!candidate.handle || typeof candidate.handle !== 'object') return null
  if (!Number.isFinite(candidate.lastUsedAt)) return null
  const lastUsedAt = candidate.lastUsedAt as number
  return {
    rootId: candidate.rootId,
    handle: candidate.handle as FileSystemDirectoryHandle,
    lastUsedAt,
  }
}

function sortByLastUsed(entries: RootHandleCacheRecord[]): RootHandleCacheRecord[] {
  return [...entries].sort((left, right) => right.lastUsedAt - left.lastUsedAt)
}

async function openRootCacheDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) return null

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(ROOT_HANDLE_CACHE_DB_NAME, ROOT_HANDLE_CACHE_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(ROOT_HANDLE_CACHE_STORE_NAME)) return
      const store = db.createObjectStore(ROOT_HANDLE_CACHE_STORE_NAME, { keyPath: 'rootId' })
      store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false })
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open root handle cache database'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const db = await openRootCacheDatabase()
  if (!db) {
    throw new Error('IndexedDB is unavailable')
  }

  try {
    const transaction = db.transaction(ROOT_HANDLE_CACHE_STORE_NAME, mode)
    const store = transaction.objectStore(ROOT_HANDLE_CACHE_STORE_NAME)
    return await executor(store)
  } finally {
    db.close()
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function loadAllRecords(): Promise<RootHandleCacheRecord[]> {
  if (!isIndexedDbAvailable()) return []

  try {
    const raw = await withStore('readonly', async (store) => {
      const request = store.getAll()
      return requestToPromise<unknown[]>(request as IDBRequest<unknown[]>)
    })
    return sortByLastUsed(raw.map(sanitizeRecord).filter((item): item is RootHandleCacheRecord => item !== null))
  } catch {
    return []
  }
}

async function putRecord(record: RootHandleCacheRecord): Promise<void> {
  await withStore('readwrite', async (store) => {
    const request = store.put(record)
    await requestToPromise(request)
  })
}

async function deleteRecord(rootId: string): Promise<void> {
  await withStore('readwrite', async (store) => {
    const request = store.delete(rootId)
    await requestToPromise(request)
  })
}

async function findMatchingRootId(
  handle: FileSystemDirectoryHandle,
  records: RootHandleCacheRecord[]
): Promise<string | null> {
  for (const record of records) {
    const cachedHandle = record.handle
    const leftIsSameEntry = cachedHandle.isSameEntry
    const rightIsSameEntry = handle.isSameEntry

    if (typeof leftIsSameEntry === 'function') {
      try {
        if (await leftIsSameEntry.call(cachedHandle, handle)) {
          return record.rootId
        }
      } catch {
        // ignore and continue fallback checks
      }
    }

    if (typeof rightIsSameEntry === 'function') {
      try {
        if (await rightIsSameEntry.call(handle, cachedHandle)) {
          return record.rootId
        }
      } catch {
        // ignore and continue fallback checks
      }
    }
  }

  // Fallback strategy when isSameEntry is unavailable or unsupported.
  const byName = records.filter((item) => (item.handle.name || '根目录') === (handle.name || '根目录'))
  if (byName.length === 1) {
    return byName[0].rootId
  }
  return null
}

export async function listCachedRoots(): Promise<CachedRootEntry[]> {
  const records = await loadAllRecords()
  return records.map(({ rootId, handle, lastUsedAt }) => ({
    rootId,
    rootName: handle.name || '根目录',
    lastUsedAt,
  }))
}

export async function getCachedRootHandle(rootId: string): Promise<FileSystemDirectoryHandle | null> {
  if (!rootId || !isIndexedDbAvailable()) return null

  try {
    const raw = await withStore('readonly', async (store) => {
      const request = store.get(rootId)
      return requestToPromise<unknown>(request as IDBRequest<unknown>)
    })
    const record = sanitizeRecord(raw)
    return record?.handle ?? null
  } catch {
    return null
  }
}

export async function upsertCachedRootHandle(handle: FileSystemDirectoryHandle): Promise<CachedRootEntry | null> {
  if (!isIndexedDbAvailable()) return null

  const records = await loadAllRecords()
  const matchedRootId = await findMatchingRootId(handle, records)
  const rootId = matchedRootId ?? createRootId()
  const lastUsedAt = Date.now()
  const nextRecord: RootHandleCacheRecord = {
    rootId,
    handle,
    lastUsedAt,
  }

  await putRecord(nextRecord)

  const latestRecords = await loadAllRecords()
  if (latestRecords.length > MAX_CACHED_ROOT_ITEMS) {
    const overflowItems = latestRecords.slice(MAX_CACHED_ROOT_ITEMS)
    await Promise.all(overflowItems.map((item) => deleteRecord(item.rootId)))
  }

  return {
    rootId,
    rootName: handle.name || '根目录',
    lastUsedAt,
  }
}

export async function markCachedRootAsUsed(rootId: string): Promise<void> {
  if (!rootId || !isIndexedDbAvailable()) return

  const records = await loadAllRecords()
  const match = records.find((item) => item.rootId === rootId)
  if (!match) return

  await putRecord({
    ...match,
    lastUsedAt: Date.now(),
  })
}

export async function removeCachedRoot(rootId: string): Promise<void> {
  if (!rootId || !isIndexedDbAvailable()) return
  await deleteRecord(rootId)
}
