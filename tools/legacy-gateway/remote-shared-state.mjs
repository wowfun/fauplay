import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  isSkippableFsError,
  isObjectRecord,
  normalizeAbsolutePath,
  normalizeRelativePath,
  resolveRootPath,
  statPath,
} from './data/common.mjs'

export const DEFAULT_REMOTE_PUBLISHED_ROOTS_PATH = path.join(
  os.homedir(),
  '.fauplay',
  'global',
  'remote-published-roots.v1.json',
)

export const DEFAULT_REMOTE_SHARED_FAVORITES_PATH = path.join(
  os.homedir(),
  '.fauplay',
  'global',
  'remote-shared-favorites.v1.json',
)

const PUBLISHED_ROOTS_STORE_VERSION = 1
const SHARED_FAVORITES_STORE_VERSION = 1

function normalizeDisplayText(value, maxLength = 120) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized.slice(0, maxLength)
}

function derivePublishedRootId(absolutePath) {
  return `remote-root-${createHash('sha256').update(absolutePath, 'utf-8').digest('hex').slice(0, 24)}`
}

function createFavoriteKey(rootId, pathValue) {
  return `${rootId}:${pathValue}`
}

function normalizePublishedRootSnapshotEntry(value) {
  if (!isObjectRecord(value)) return null
  const absolutePath = typeof value.absolutePath === 'string'
    ? value.absolutePath.trim()
    : ''
  if (!absolutePath) return null

  let normalizedAbsolutePath = ''
  try {
    normalizedAbsolutePath = resolveRootPath(absolutePath)
  } catch {
    return null
  }

  const label = normalizeDisplayText(value.label) || path.basename(normalizedAbsolutePath) || '根目录'
  return {
    id: derivePublishedRootId(normalizedAbsolutePath),
    label,
    absolutePath: normalizedAbsolutePath,
  }
}

function normalizePublishedRootRecord(value) {
  if (!isObjectRecord(value)) return null
  const normalizedSnapshot = normalizePublishedRootSnapshotEntry(value)
  const createdAtMs = Number(value.createdAtMs)
  const lastSyncedAtMs = Number(value.lastSyncedAtMs)
  if (
    !normalizedSnapshot
    || !Number.isFinite(createdAtMs)
    || !Number.isFinite(lastSyncedAtMs)
  ) {
    return null
  }
  return {
    id: normalizedSnapshot.id,
    label: normalizedSnapshot.label,
    absolutePath: normalizedSnapshot.absolutePath,
    createdAtMs,
    lastSyncedAtMs,
  }
}

function buildPublishedRootsPayload(recordsById) {
  return {
    version: PUBLISHED_ROOTS_STORE_VERSION,
    items: [...recordsById.values()]
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .map((record) => ({
        id: record.id,
        label: record.label,
        absolutePath: record.absolutePath,
        createdAtMs: record.createdAtMs,
        lastSyncedAtMs: record.lastSyncedAtMs,
      })),
  }
}

function normalizeFavoritePath(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return normalizeRelativePath(trimmed, 'path')
  } catch {
    return null
  }
}

function normalizeSharedFavoriteRecord(value) {
  if (!isObjectRecord(value)) return null
  const rootId = typeof value.rootId === 'string' ? value.rootId.trim() : ''
  const normalizedPath = normalizeFavoritePath(value.path)
  const favoritedAtMs = Number(value.favoritedAtMs)
  if (!rootId || normalizedPath === null || !Number.isFinite(favoritedAtMs)) {
    return null
  }
  return {
    rootId,
    path: normalizedPath,
    favoritedAtMs,
  }
}

function buildSharedFavoritesPayload(recordsByKey) {
  return {
    version: SHARED_FAVORITES_STORE_VERSION,
    items: [...recordsByKey.values()]
      .sort((left, right) => right.favoritedAtMs - left.favoritedAtMs)
      .map((record) => ({
        rootId: record.rootId,
        path: record.path,
        favoritedAtMs: record.favoritedAtMs,
      })),
  }
}

async function writeStoreFile(storagePath, payload) {
  const directoryPath = path.dirname(storagePath)
  await fs.mkdir(directoryPath, { recursive: true })
  const tempPath = `${storagePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 })
  await fs.rename(tempPath, storagePath)
}

export function createRemotePublishedRootsStore({
  storagePath = DEFAULT_REMOTE_PUBLISHED_ROOTS_PATH,
} = {}) {
  let loaded = false
  let loadPromise = null
  const recordsById = new Map()

  async function ensureLoaded() {
    if (loaded) return
    if (loadPromise) {
      await loadPromise
      return
    }

    loadPromise = (async () => {
      let raw = ''
      try {
        raw = await fs.readFile(storagePath, 'utf-8')
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          loaded = true
          return
        }
        throw error
      }

      try {
        const parsed = JSON.parse(raw)
        const items = Array.isArray(parsed?.items) ? parsed.items : []
        recordsById.clear()
        for (const item of items) {
          const record = normalizePublishedRootRecord(item)
          if (!record) continue
          recordsById.set(record.id, record)
        }
      } catch (error) {
        console.warn(`[gateway] invalid remote published roots store, resetting: ${storagePath}`)
        console.warn(error)
        recordsById.clear()
        await writeStoreFile(storagePath, buildPublishedRootsPayload(recordsById))
      }

      loaded = true
    })()

    try {
      await loadPromise
    } finally {
      loadPromise = null
    }
  }

  async function persist() {
    await writeStoreFile(storagePath, buildPublishedRootsPayload(recordsById))
  }

  function listRecords() {
    return [...recordsById.values()].sort((left, right) => left.createdAtMs - right.createdAtMs)
  }

  return {
    storagePath,
    async list() {
      await ensureLoaded()
      return listRecords()
    },
    async replaceAll(snapshotItems, nowMs = Date.now()) {
      await ensureLoaded()
      const previousRecords = listRecords()
      const previousRecordById = new Map(previousRecords.map((record) => [record.id, record]))
      const nextRecordsById = new Map()

      for (const item of Array.isArray(snapshotItems) ? snapshotItems : []) {
        const normalized = normalizePublishedRootSnapshotEntry(item)
        if (!normalized) continue
        const existing = previousRecordById.get(normalized.id)
        nextRecordsById.set(normalized.id, {
          id: normalized.id,
          label: normalized.label,
          absolutePath: normalized.absolutePath,
          createdAtMs: existing?.createdAtMs ?? nowMs,
          lastSyncedAtMs: nowMs,
        })
      }

      const removedRootIds = previousRecords
        .map((record) => record.id)
        .filter((id) => !nextRecordsById.has(id))

      recordsById.clear()
      for (const [id, record] of nextRecordsById.entries()) {
        recordsById.set(id, record)
      }
      await persist()

      return {
        items: listRecords(),
        itemsByAbsolutePath: new Map(
          listRecords().map((record) => [record.absolutePath, record]),
        ),
        removedRootIds,
      }
    },
    async listResolvedRoots() {
      await ensureLoaded()
      const resolvedRoots = []
      for (const record of listRecords()) {
        try {
          const resolvedPath = resolveRootPath(record.absolutePath)
          const statResult = await statPath(resolvedPath)
          if (!statResult.isDirectory()) {
            continue
          }
          try {
            await fs.readdir(resolvedPath, { withFileTypes: true })
          } catch (error) {
            if (isSkippableFsError(error)) {
              continue
            }
            throw error
          }
          const realPath = normalizeAbsolutePath(await fs.realpath(resolvedPath))
          resolvedRoots.push({
            id: record.id,
            label: record.label,
            path: resolvedPath,
            realPath,
          })
        } catch {
          // Ignore stale published roots until the next local sync replaces them.
        }
      }
      return resolvedRoots
    },
  }
}

export function createRemoteSharedFavoritesStore({
  storagePath = DEFAULT_REMOTE_SHARED_FAVORITES_PATH,
} = {}) {
  let loaded = false
  let loadPromise = null
  const recordsByKey = new Map()

  async function ensureLoaded() {
    if (loaded) return
    if (loadPromise) {
      await loadPromise
      return
    }

    loadPromise = (async () => {
      let raw = ''
      try {
        raw = await fs.readFile(storagePath, 'utf-8')
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          loaded = true
          return
        }
        throw error
      }

      try {
        const parsed = JSON.parse(raw)
        const items = Array.isArray(parsed?.items) ? parsed.items : []
        recordsByKey.clear()
        for (const item of items) {
          const record = normalizeSharedFavoriteRecord(item)
          if (!record) continue
          recordsByKey.set(createFavoriteKey(record.rootId, record.path), record)
        }
      } catch (error) {
        console.warn(`[gateway] invalid remote shared favorites store, resetting: ${storagePath}`)
        console.warn(error)
        recordsByKey.clear()
        await writeStoreFile(storagePath, buildSharedFavoritesPayload(recordsByKey))
      }

      loaded = true
    })()

    try {
      await loadPromise
    } finally {
      loadPromise = null
    }
  }

  async function persist() {
    await writeStoreFile(storagePath, buildSharedFavoritesPayload(recordsByKey))
  }

  function listRecords() {
    return [...recordsByKey.values()].sort((left, right) => right.favoritedAtMs - left.favoritedAtMs)
  }

  async function pruneByAllowedRootIds(allowedRootIds) {
    if (!Array.isArray(allowedRootIds)) return false
    const allowed = new Set(
      allowedRootIds
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    let changed = false
    for (const [key, record] of recordsByKey.entries()) {
      if (!allowed.has(record.rootId)) {
        recordsByKey.delete(key)
        changed = true
      }
    }
    if (changed) {
      await persist()
    }
    return changed
  }

  return {
    storagePath,
    async list(options = {}) {
      await ensureLoaded()
      await pruneByAllowedRootIds(options.allowedRootIds)
      return listRecords()
    },
    async upsert(rootId, pathValue, favoritedAtMs = Date.now()) {
      await ensureLoaded()
      const normalizedRootId = typeof rootId === 'string' ? rootId.trim() : ''
      const normalizedPath = normalizeFavoritePath(pathValue)
      if (!normalizedRootId) {
        throw new Error('rootId is required')
      }
      if (normalizedPath === null) {
        throw new Error('path contains invalid value')
      }
      const key = createFavoriteKey(normalizedRootId, normalizedPath)
      recordsByKey.set(key, {
        rootId: normalizedRootId,
        path: normalizedPath,
        favoritedAtMs: Number.isFinite(Number(favoritedAtMs)) ? Number(favoritedAtMs) : Date.now(),
      })
      await persist()
      return recordsByKey.get(key) ?? null
    },
    async upsertBatch(items = [], nowMs = Date.now()) {
      await ensureLoaded()
      let changed = false
      for (const item of Array.isArray(items) ? items : []) {
        if (!isObjectRecord(item)) continue
        const normalizedRootId = typeof item.rootId === 'string' ? item.rootId.trim() : ''
        const normalizedPath = normalizeFavoritePath(item.path)
        if (!normalizedRootId || normalizedPath === null) continue
        const key = createFavoriteKey(normalizedRootId, normalizedPath)
        const favoritedAtMs = Number.isFinite(Number(item.favoritedAtMs))
          ? Number(item.favoritedAtMs)
          : nowMs
        const existing = recordsByKey.get(key)
        if (
          existing?.favoritedAtMs === favoritedAtMs
          && existing.rootId === normalizedRootId
          && existing.path === normalizedPath
        ) {
          continue
        }
        recordsByKey.set(key, {
          rootId: normalizedRootId,
          path: normalizedPath,
          favoritedAtMs,
        })
        changed = true
      }
      if (changed) {
        await persist()
      }
      return listRecords()
    },
    async remove(rootId, pathValue) {
      await ensureLoaded()
      const normalizedRootId = typeof rootId === 'string' ? rootId.trim() : ''
      const normalizedPath = normalizeFavoritePath(pathValue)
      if (!normalizedRootId) {
        throw new Error('rootId is required')
      }
      if (normalizedPath === null) {
        throw new Error('path contains invalid value')
      }
      const key = createFavoriteKey(normalizedRootId, normalizedPath)
      const deleted = recordsByKey.delete(key)
      if (deleted) {
        await persist()
      }
      return deleted
    },
    async removeByRootIds(rootIds) {
      await ensureLoaded()
      const targetRootIds = new Set(
        (Array.isArray(rootIds) ? rootIds : [])
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      )
      if (targetRootIds.size === 0) {
        return []
      }
      let changed = false
      for (const [key, record] of recordsByKey.entries()) {
        if (targetRootIds.has(record.rootId)) {
          recordsByKey.delete(key)
          changed = true
        }
      }
      if (changed) {
        await persist()
      }
      return [...targetRootIds]
    },
  }
}
