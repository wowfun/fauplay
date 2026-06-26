import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  isSkippableFsError,
  isObjectRecord,
  normalizeAbsolutePath,
  resolveRootPath,
  statPath,
} from './data/common.mjs'

export const DEFAULT_REMOTE_PUBLISHED_ROOTS_PATH = path.join(
  os.homedir(),
  '.fauplay',
  'global',
  'remote-published-roots.v1.json',
)

const PUBLISHED_ROOTS_STORE_VERSION = 1

function normalizeDisplayText(value, maxLength = 120) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized.slice(0, maxLength)
}

function derivePublishedRootId(absolutePath) {
  return `remote-root-${createHash('sha256').update(absolutePath, 'utf-8').digest('hex').slice(0, 24)}`
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

  function listRecords() {
    return [...recordsById.values()].sort((left, right) => left.createdAtMs - right.createdAtMs)
  }

  return {
    storagePath,
    async list() {
      await ensureLoaded()
      return listRecords()
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
