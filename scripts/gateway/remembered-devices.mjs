import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_REMOTE_REMEMBER_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_REMOTE_REMEMBERED_DEVICES_PATH = path.join(
  os.homedir(),
  '.fauplay',
  'global',
  'remote-remembered-devices.v1.json',
)

const STORE_VERSION = 1
const LEGACY_AUTO_LABEL = '旧版已记住设备'
const DEFAULT_AUTO_LABEL = '当前设备'
const MAX_LABEL_LENGTH = 80

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hashRememberedDeviceSecret(secret) {
  return createHash('sha256').update(secret, 'utf-8').digest('hex')
}

function createRememberedDeviceSecret() {
  return randomBytes(32).toString('base64url')
}

function createRememberedDeviceCookieValue(id, secret) {
  return `${id}.${secret}`
}

function normalizeDisplayText(value, maxLength = MAX_LABEL_LENGTH) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized.slice(0, maxLength)
}

function detectUserAgentBrowser(userAgent) {
  const source = typeof userAgent === 'string' ? userAgent : ''
  if (!source) return ''
  if (/edg(?:e|ios|a)?\//i.test(source)) return 'Edge'
  if (/samsungbrowser\//i.test(source)) return 'Samsung Internet'
  if (/opr\//i.test(source) || /opera\//i.test(source)) return 'Opera'
  if (/firefox\//i.test(source) || /fxios\//i.test(source)) return 'Firefox'
  if (/chrome\//i.test(source) || /crios\//i.test(source)) return 'Chrome'
  if (/safari\//i.test(source) && !/chrome\//i.test(source) && !/crios\//i.test(source)) return 'Safari'
  return ''
}

function detectUserAgentPlatform(userAgent) {
  const source = typeof userAgent === 'string' ? userAgent : ''
  if (!source) return ''
  if (/iphone/i.test(source)) return 'iPhone'
  if (/ipad/i.test(source)) return 'iPad'
  if (/android/i.test(source)) return 'Android'
  if (/windows/i.test(source)) return 'Windows'
  if (/macintosh|mac os x/i.test(source)) return 'macOS'
  if (/linux/i.test(source)) return 'Linux'
  return ''
}

function buildRememberedDeviceSummary(userAgent) {
  const browser = detectUserAgentBrowser(userAgent)
  const platform = detectUserAgentPlatform(userAgent)
  const autoLabel = [browser, platform].filter(Boolean).join(' · ') || DEFAULT_AUTO_LABEL
  const userAgentSummary = [platform, browser].filter(Boolean).join(' · ')
  return {
    autoLabel,
    userAgentSummary,
  }
}

function parseRememberedDeviceCookieValue(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  const separatorIndex = raw.indexOf('.')
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    return null
  }

  const id = raw.slice(0, separatorIndex).trim()
  const secret = raw.slice(separatorIndex + 1).trim()
  if (!id || !secret) return null

  return { id, secret }
}

function isRememberedDeviceHashMatch(expectedHash, actualHash) {
  if (
    typeof expectedHash !== 'string'
    || typeof actualHash !== 'string'
    || expectedHash.length !== actualHash.length
    || expectedHash.length === 0
  ) {
    return false
  }

  return timingSafeEqual(
    Buffer.from(expectedHash, 'utf-8'),
    Buffer.from(actualHash, 'utf-8'),
  )
}

function normalizeRememberedDeviceRecord(value) {
  if (!isObjectRecord(value)) return null

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const tokenHash = typeof value.tokenHash === 'string' ? value.tokenHash.trim() : ''
  const label = normalizeDisplayText(value.label)
  const autoLabel = normalizeDisplayText(value.autoLabel, 120) || LEGACY_AUTO_LABEL
  const userAgentSummary = normalizeDisplayText(value.userAgentSummary, 160)
  const createdAtMs = Number(value.createdAtMs)
  const lastUsedAtMs = Number(value.lastUsedAtMs)
  const expiresAtMs = Number(value.expiresAtMs)

  if (
    !id
    || !tokenHash
    || !Number.isFinite(createdAtMs)
    || !Number.isFinite(lastUsedAtMs)
    || !Number.isFinite(expiresAtMs)
  ) {
    return null
  }

  return {
    id,
    tokenHash,
    label,
    autoLabel,
    userAgentSummary,
    createdAtMs,
    lastUsedAtMs,
    expiresAtMs,
  }
}

function buildStorePayload(recordsById) {
  return {
    version: STORE_VERSION,
    devices: [...recordsById.values()]
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .map((record) => ({
        id: record.id,
        tokenHash: record.tokenHash,
        label: record.label,
        autoLabel: record.autoLabel,
        userAgentSummary: record.userAgentSummary,
        createdAtMs: record.createdAtMs,
        lastUsedAtMs: record.lastUsedAtMs,
        expiresAtMs: record.expiresAtMs,
      })),
  }
}

async function writeStoreFile(storagePath, recordsById) {
  const payload = JSON.stringify(buildStorePayload(recordsById), null, 2)
  const directoryPath = path.dirname(storagePath)
  await fs.mkdir(directoryPath, { recursive: true })

  const tempPath = `${storagePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await fs.writeFile(tempPath, payload, { encoding: 'utf-8', mode: 0o600 })
  await fs.rename(tempPath, storagePath)
}

export function createRemoteRememberedDeviceStore({
  storagePath = DEFAULT_REMOTE_REMEMBERED_DEVICES_PATH,
  ttlMs = DEFAULT_REMOTE_REMEMBER_DEVICE_TTL_MS,
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
      let shouldPersist = false
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
        const devices = Array.isArray(parsed?.devices) ? parsed.devices : []
        recordsById.clear()
        for (const item of devices) {
          const record = normalizeRememberedDeviceRecord(item)
          if (!record) continue
          if (!('label' in item) || !('autoLabel' in item) || !('userAgentSummary' in item)) {
            shouldPersist = true
          }
          recordsById.set(record.id, record)
        }
      } catch (error) {
        console.warn(`[gateway] invalid remembered-device store, resetting: ${storagePath}`)
        console.warn(error)
        recordsById.clear()
        shouldPersist = true
      }

      if (pruneExpiredRecords()) {
        shouldPersist = true
      }
      if (shouldPersist) {
        await writeStoreFile(storagePath, recordsById)
      }
      loaded = true
    })()

    try {
      await loadPromise
    } finally {
      loadPromise = null
    }
  }

  function pruneExpiredRecords(nowMs = Date.now()) {
    let changed = false
    for (const [id, record] of recordsById.entries()) {
      if (!Number.isFinite(record.expiresAtMs) || record.expiresAtMs <= nowMs) {
        recordsById.delete(id)
        changed = true
      }
    }
    return changed
  }

  async function persistIfNeeded(changed) {
    if (!changed) return
    await writeStoreFile(storagePath, recordsById)
  }

  return {
    storagePath,
    ttlMs,
    async create(nowMs = Date.now(), options = {}) {
      await ensureLoaded()
      await persistIfNeeded(pruneExpiredRecords(nowMs))
      const userAgent = typeof options?.userAgent === 'string' ? options.userAgent : ''
      const label = normalizeDisplayText(options?.label)
      const summary = buildRememberedDeviceSummary(userAgent)
      const id = randomUUID()
      const secret = createRememberedDeviceSecret()
      const expiresAtMs = nowMs + ttlMs

      recordsById.set(id, {
        id,
        tokenHash: hashRememberedDeviceSecret(secret),
        label,
        autoLabel: summary.autoLabel,
        userAgentSummary: summary.userAgentSummary,
        createdAtMs: nowMs,
        lastUsedAtMs: nowMs,
        expiresAtMs,
      })
      await writeStoreFile(storagePath, recordsById)

      return {
        id,
        cookieValue: createRememberedDeviceCookieValue(id, secret),
        label,
        autoLabel: summary.autoLabel,
        userAgentSummary: summary.userAgentSummary,
        expiresAtMs,
      }
    },
    async list(nowMs = Date.now()) {
      await ensureLoaded()
      await persistIfNeeded(pruneExpiredRecords(nowMs))
      return [...recordsById.values()]
        .sort((left, right) => right.lastUsedAtMs - left.lastUsedAtMs || right.createdAtMs - left.createdAtMs)
        .map((record) => ({
          id: record.id,
          label: record.label,
          autoLabel: record.autoLabel,
          userAgentSummary: record.userAgentSummary,
          createdAtMs: record.createdAtMs,
          lastUsedAtMs: record.lastUsedAtMs,
          expiresAtMs: record.expiresAtMs,
        }))
    },
    async rotate(cookieValue, nowMs = Date.now()) {
      await ensureLoaded()
      let changed = pruneExpiredRecords(nowMs)

      const parsed = parseRememberedDeviceCookieValue(cookieValue)
      if (!parsed) {
        await persistIfNeeded(changed)
        return null
      }

      const record = recordsById.get(parsed.id)
      if (!record) {
        await persistIfNeeded(changed)
        return null
      }

      const receivedTokenHash = hashRememberedDeviceSecret(parsed.secret)
      if (!isRememberedDeviceHashMatch(record.tokenHash, receivedTokenHash)) {
        await persistIfNeeded(changed)
        return null
      }

      const nextSecret = createRememberedDeviceSecret()
      record.tokenHash = hashRememberedDeviceSecret(nextSecret)
      record.lastUsedAtMs = nowMs
      changed = true

      await persistIfNeeded(changed)
      return {
        id: record.id,
        cookieValue: createRememberedDeviceCookieValue(record.id, nextSecret),
        label: record.label,
        autoLabel: record.autoLabel,
        userAgentSummary: record.userAgentSummary,
        expiresAtMs: record.expiresAtMs,
      }
    },
    async revoke(cookieValue, nowMs = Date.now()) {
      await ensureLoaded()
      let changed = pruneExpiredRecords(nowMs)

      const parsed = parseRememberedDeviceCookieValue(cookieValue)
      if (!parsed) {
        await persistIfNeeded(changed)
        return []
      }

      const record = recordsById.get(parsed.id)
      if (!record) {
        await persistIfNeeded(changed)
        return []
      }

      const receivedTokenHash = hashRememberedDeviceSecret(parsed.secret)
      if (!isRememberedDeviceHashMatch(record.tokenHash, receivedTokenHash)) {
        await persistIfNeeded(changed)
        return []
      }

      recordsById.delete(parsed.id)
      changed = true
      await persistIfNeeded(changed)
      return [parsed.id]
    },
    async renameById(id, label, nowMs = Date.now()) {
      await ensureLoaded()
      await persistIfNeeded(pruneExpiredRecords(nowMs))
      const normalizedId = typeof id === 'string' ? id.trim() : ''
      if (!normalizedId) {
        throw new Error('Remembered device id is required')
      }
      const record = recordsById.get(normalizedId)
      if (!record) {
        throw new Error('Remembered device not found')
      }
      record.label = normalizeDisplayText(label)
      await writeStoreFile(storagePath, recordsById)
      return {
        id: record.id,
        label: record.label,
        autoLabel: record.autoLabel,
        userAgentSummary: record.userAgentSummary,
        createdAtMs: record.createdAtMs,
        lastUsedAtMs: record.lastUsedAtMs,
        expiresAtMs: record.expiresAtMs,
      }
    },
    async revokeById(id, nowMs = Date.now()) {
      await ensureLoaded()
      let changed = pruneExpiredRecords(nowMs)
      const normalizedId = typeof id === 'string' ? id.trim() : ''
      if (!normalizedId) {
        await persistIfNeeded(changed)
        return []
      }
      const deleted = recordsById.delete(normalizedId)
      if (deleted) {
        changed = true
      }
      await persistIfNeeded(changed)
      return deleted ? [normalizedId] : []
    },
    async clearAll(nowMs = Date.now()) {
      await ensureLoaded()
      let changed = pruneExpiredRecords(nowMs)
      if (recordsById.size === 0) {
        await writeStoreFile(storagePath, recordsById)
        return []
      }

      const revokedDeviceIds = [...recordsById.keys()]
      recordsById.clear()
      changed = true
      await persistIfNeeded(changed)
      return revokedDeviceIds
    },
  }
}
