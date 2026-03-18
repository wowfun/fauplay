import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DB_DIRNAME = '.fauplay'
const DB_FILENAME = 'faudb.v1.sqlite'
const SCHEMA_VERSION = 1
const EMBEDDING_DIM = 512
const SAMPLE_CHUNK_BYTES = 64 * 1024
const HASH_HEX_128_LENGTH = 32
const ANNOTATION_SOURCE = 'meta.annotation'
const FACE_SOURCE = 'vision.face'
const CLASSIFY_SOURCE = 'ml.classify'
const UNANNOTATED_TAG_KEY = '__ANNOTATION_UNANNOTATED__'

function nowTs() {
  return Date.now()
}

function isWindowsPath(input) {
  return typeof input === 'string' && /^[a-zA-Z]:[\\/]/.test(input)
}

export function resolveRootPath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('rootPath is required')
  }

  const raw = input.trim()
  if (isWindowsPath(raw) && process.platform !== 'win32') {
    try {
      const converted = execFileSync('wslpath', ['-u', raw], { encoding: 'utf8' }).trim()
      if (converted) {
        return converted
      }
    } catch {
      throw new Error('rootPath windows path cannot be resolved in current runtime')
    }
  }

  if (!path.isAbsolute(raw)) {
    throw new Error('rootPath must be an absolute path')
  }

  return raw
}

export function normalizeRelativePath(input, fieldName = 'relativePath') {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`${fieldName} contains invalid value`)
  }

  const normalized = input.replace(/\\/g, '/').split('/').filter(Boolean)
  if (normalized.length === 0) {
    throw new Error(`${fieldName} contains empty path`)
  }

  for (const segment of normalized) {
    if (segment === '.' || segment === '..') {
      throw new Error(`${fieldName} contains unsafe segments`)
    }
    if (segment.includes('\0')) {
      throw new Error(`${fieldName} contains invalid characters`)
    }
  }

  return normalized.join('/')
}

function resolvePathWithinRoot(rootPath, relativePath) {
  const target = path.resolve(rootPath, ...relativePath.split('/'))
  const relative = path.relative(rootPath, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('relativePath escapes rootPath')
  }
  return target
}

function parseInteger(value, defaultValue) {
  const next = Number(value)
  if (!Number.isFinite(next) || !Number.isInteger(next)) {
    return defaultValue
  }
  return next
}

function parseBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'undefined') return defaultValue
  return defaultValue
}

function parseFiniteNumber(value, defaultValue = 0) {
  const next = Number(value)
  if (!Number.isFinite(next)) {
    return defaultValue
  }
  return next
}

function toFileMtimeMs(statResult) {
  const value = Math.trunc(Number(statResult?.mtimeMs))
  return Number.isFinite(value) && value >= 0 ? value : 0
}

async function readSampleBytes(absPath, fileSize) {
  const handle = await fs.open(absPath, 'r')
  try {
    if (fileSize <= SAMPLE_CHUNK_BYTES * 2) {
      const all = Buffer.allocUnsafe(Math.max(fileSize, 0))
      if (fileSize > 0) {
        await handle.read(all, 0, fileSize, 0)
      }
      return all
    }

    const head = Buffer.allocUnsafe(SAMPLE_CHUNK_BYTES)
    const tail = Buffer.allocUnsafe(SAMPLE_CHUNK_BYTES)
    await handle.read(head, 0, SAMPLE_CHUNK_BYTES, 0)
    await handle.read(tail, 0, SAMPLE_CHUNK_BYTES, Math.max(0, fileSize - SAMPLE_CHUNK_BYTES))
    return Buffer.concat([head, tail])
  } finally {
    await handle.close()
  }
}

async function sha256HexForFile(absPath) {
  const hash = createHash('sha256')
  const handle = await fs.open(absPath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead <= 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

async function computeFingerprintsForFile(absPath, relativePath, options, providedStat = null) {
  const statResult = providedStat ?? await fs.stat(absPath)
  if (!statResult.isFile()) {
    throw new Error('target path must be a file')
  }

  const fileSize = Number(statResult.size)
  const sampleBytes = await readSampleBytes(absPath, fileSize)
  const sampleSha256 = createHash('sha256').update(sampleBytes).digest('hex')
  const sampleSha256_128 = sampleSha256.slice(0, HASH_HEX_128_LENGTH)

  const result = {
    bindingFp: `b1:${fileSize}:${sampleSha256_128}`,
  }

  if (options.exactEnabled) {
    const exactSha = await sha256HexForFile(absPath)
    result.exactFp = `e1:${exactSha}`
  }

  if (options.similarImageEnabled) {
    const simHex = sampleSha256.slice(0, 16)
    result.simFp = `s1:${simHex}`
  }

  return result
}

function buildTagKey(key, value) {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function toTagDto(row) {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    source: row.source,
    sourceRefId: row.sourceRefId,
    confidence: row.confidence === null || typeof row.confidence === 'undefined' ? null : Number(row.confidence),
    status: row.status,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  }
}

function openDb(rootPath) {
  const dbDir = path.join(rootPath, DB_DIRNAME)
  const dbPath = path.join(dbDir, DB_FILENAME)
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = DELETE')
  ensureSchema(db)
  return db
}

function ensureSchema(db) {
  const row = db.prepare('PRAGMA user_version').get()
  const currentVersion = Number(row?.user_version ?? 0)
  if (currentVersion === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file (
        id TEXT PRIMARY KEY,
        relativePath TEXT NOT NULL UNIQUE,
        fileSizeBytes INTEGER,
        fileMtimeMs INTEGER,
        bindingFp TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS annotation_record (
        id TEXT PRIMARY KEY,
        fileId TEXT NOT NULL,
        fieldKey TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'click',
        status TEXT NOT NULL DEFAULT 'active',
        orphanReason TEXT,
        fileSizeBytes INTEGER,
        fileMtimeMs INTEGER,
        bindingFp TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        UNIQUE(fileId, fieldKey),
        FOREIGN KEY(fileId) REFERENCES file(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tag (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL,
        sourceRefId TEXT,
        confidence REAL,
        status TEXT NOT NULL DEFAULT 'active',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        UNIQUE(source, sourceRefId)
      );

      CREATE TABLE IF NOT EXISTS file_tag (
        fileId TEXT NOT NULL,
        tagId TEXT NOT NULL,
        appliedAt INTEGER NOT NULL,
        PRIMARY KEY(fileId, tagId),
        FOREIGN KEY(fileId) REFERENCES file(id) ON DELETE CASCADE,
        FOREIGN KEY(tagId) REFERENCES tag(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS face (
        id TEXT PRIMARY KEY,
        fileId TEXT NOT NULL,
        x1 REAL NOT NULL,
        y1 REAL NOT NULL,
        x2 REAL NOT NULL,
        y2 REAL NOT NULL,
        score REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'unassigned',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(fileId) REFERENCES file(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS face_embedding (
        faceId TEXT PRIMARY KEY,
        dim INTEGER NOT NULL DEFAULT 512,
        embedding BLOB NOT NULL,
        FOREIGN KEY(faceId) REFERENCES face(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS person (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        featureFaceId TEXT,
        faceCount INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(featureFaceId) REFERENCES face(id)
      );

      CREATE TABLE IF NOT EXISTS person_face (
        personId TEXT NOT NULL,
        faceId TEXT NOT NULL UNIQUE,
        assignedBy TEXT NOT NULL,
        assignedAt INTEGER NOT NULL,
        PRIMARY KEY(personId, faceId),
        FOREIGN KEY(personId) REFERENCES person(id) ON DELETE CASCADE,
        FOREIGN KEY(faceId) REFERENCES face(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS face_job_state (
        faceId TEXT PRIMARY KEY,
        detectStatus TEXT NOT NULL,
        clusterStatus TEXT NOT NULL,
        deferred INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        lastErrorCode TEXT,
        lastRunAt INTEGER NOT NULL,
        nextRunAt INTEGER,
        FOREIGN KEY(faceId) REFERENCES face(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_file_relative_path ON file(relativePath);
      CREATE INDEX IF NOT EXISTS idx_tag_key_value ON tag(key, value);
      CREATE INDEX IF NOT EXISTS idx_tag_source_ref ON tag(source, sourceRefId);
      CREATE INDEX IF NOT EXISTS idx_file_tag_tag_id ON file_tag(tagId);
      CREATE INDEX IF NOT EXISTS idx_annotation_file_id ON annotation_record(fileId);
      CREATE INDEX IF NOT EXISTS idx_annotation_status ON annotation_record(status);
      CREATE INDEX IF NOT EXISTS idx_face_file_id ON face(fileId);
      CREATE INDEX IF NOT EXISTS idx_face_status ON face(status);
      CREATE INDEX IF NOT EXISTS idx_person_face_person_id ON person_face(personId);
      CREATE INDEX IF NOT EXISTS idx_face_job_state_cluster ON face_job_state(clusterStatus, deferred);
    `)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    return
  }

  if (currentVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported schemaVersion: ${currentVersion}`)
  }
}

async function withDb(rootPathInput, callback) {
  const rootPath = resolveRootPath(rootPathInput)
  await fs.mkdir(path.join(rootPath, DB_DIRNAME), { recursive: true })
  const db = openDb(rootPath)
  try {
    return await callback(db, rootPath)
  } finally {
    db.close()
  }
}

async function withTransaction(db, callback) {
  db.exec('BEGIN')
  try {
    const result = await callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function ensureFileEntry(db, rootPath, relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  const absPath = resolvePathWithinRoot(rootPath, normalized)
  const statResult = await fs.stat(absPath)
  if (!statResult.isFile()) {
    throw new Error('target path must be a file')
  }

  const fingerprints = await computeFingerprintsForFile(absPath, normalized, {
    exactEnabled: false,
    similarImageEnabled: false,
  }, statResult)

  const ts = nowTs()
  const size = Number(statResult.size)
  const mtime = toFileMtimeMs(statResult)
  const existing = db.prepare('SELECT * FROM file WHERE relativePath = ?').get(normalized)
  if (existing) {
    db.prepare(`
      UPDATE file
      SET fileSizeBytes = ?, fileMtimeMs = ?, bindingFp = ?, updatedAt = ?
      WHERE id = ?
    `).run(size, mtime, fingerprints.bindingFp, ts, existing.id)

    return {
      id: existing.id,
      relativePath: normalized,
      fileSizeBytes: size,
      fileMtimeMs: mtime,
      bindingFp: fingerprints.bindingFp,
      updatedAt: ts,
    }
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO file(id, relativePath, fileSizeBytes, fileMtimeMs, bindingFp, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, normalized, size, mtime, fingerprints.bindingFp, ts, ts)

  return {
    id,
    relativePath: normalized,
    fileSizeBytes: size,
    fileMtimeMs: mtime,
    bindingFp: fingerprints.bindingFp,
    updatedAt: ts,
  }
}

function getFileById(db, fileId) {
  if (typeof fileId !== 'string' || !fileId) return null
  return db.prepare('SELECT * FROM file WHERE id = ?').get(fileId) ?? null
}

function getFileByRelativePath(db, relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  return db.prepare('SELECT * FROM file WHERE relativePath = ?').get(normalized) ?? null
}

function upsertTagForSourceRef(db, payload) {
  const {
    fileId,
    key,
    value,
    source,
    sourceRefId,
    confidence = null,
    status = 'active',
  } = payload

  if (!fileId || !key || !value || !source) {
    throw new Error('invalid tag payload')
  }

  const ts = nowTs()
  let existing = null
  if (sourceRefId) {
    existing = db.prepare('SELECT * FROM tag WHERE source = ? AND sourceRefId = ?').get(source, sourceRefId) ?? null
  }

  let tagId = existing?.id ?? null
  if (existing) {
    db.prepare(`
      UPDATE tag
      SET key = ?, value = ?, confidence = ?, status = ?, updatedAt = ?
      WHERE id = ?
    `).run(key, value, confidence, status, ts, existing.id)
  } else {
    tagId = randomUUID()
    db.prepare(`
      INSERT INTO tag(id, key, value, source, sourceRefId, confidence, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tagId, key, value, source, sourceRefId ?? null, confidence, status, ts, ts)
  }

  db.prepare(`
    INSERT INTO file_tag(fileId, tagId, appliedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(fileId, tagId) DO UPDATE SET
      appliedAt = excluded.appliedAt
  `).run(fileId, tagId, ts)

  return tagId
}

function removeTagBySourceRef(db, source, sourceRefId) {
  if (!source || !sourceRefId) return
  const row = db.prepare('SELECT id FROM tag WHERE source = ? AND sourceRefId = ?').get(source, sourceRefId)
  if (!row) return
  db.prepare('DELETE FROM file_tag WHERE tagId = ?').run(row.id)
  db.prepare('DELETE FROM tag WHERE id = ?').run(row.id)
}

function removeClassifyTagsForFile(db, fileId) {
  const rows = db.prepare('SELECT id FROM tag WHERE source = ? AND sourceRefId LIKE ?').all(CLASSIFY_SOURCE, `file:${fileId}:%`)
  for (const row of rows) {
    db.prepare('DELETE FROM file_tag WHERE tagId = ?').run(row.id)
    db.prepare('DELETE FROM tag WHERE id = ?').run(row.id)
  }
}

function toEmbeddingBlob(values) {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIM) {
    throw new Error(`embedding length must be ${EMBEDDING_DIM}`)
  }
  const floatArray = new Float32Array(EMBEDDING_DIM)
  for (let i = 0; i < EMBEDDING_DIM; i += 1) {
    floatArray[i] = Number(values[i])
  }
  return Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength)
}

function fromEmbeddingBlob(blob) {
  const bytes = blob instanceof Uint8Array ? blob : Buffer.from(blob)
  const usableLength = Math.floor(bytes.byteLength / 4) * 4
  const floatArray = new Float32Array(bytes.buffer, bytes.byteOffset, usableLength / 4)
  return Array.from(floatArray)
}

function cosineDistance(left, right) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const size = Math.min(left.length, right.length)
  for (let i = 0; i < size; i += 1) {
    const a = left[i]
    const b = right[i]
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }

  if (leftNorm <= 0 || rightNorm <= 0) {
    return 1
  }

  const similarity = Math.min(1, Math.max(-1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))))
  return 1 - similarity
}

function choosePersonForFace(currentFaceId, currentEmbedding, allEmbeddings, maxDistance) {
  const matches = []
  for (const candidate of allEmbeddings) {
    const distance = cosineDistance(currentEmbedding, candidate.embedding)
    if (distance <= maxDistance) {
      matches.push({
        faceId: candidate.faceId,
        personId: candidate.personId,
        distance,
      })
    }
  }

  matches.sort((left, right) => left.distance - right.distance)
  let matchedPersonId = null
  for (const item of matches) {
    if (item.faceId === currentFaceId) continue
    if (typeof item.personId === 'string' && item.personId) {
      matchedPersonId = item.personId
      break
    }
  }

  return {
    matches,
    matchedPersonId,
  }
}

function refreshPersonCache(db) {
  const ts = nowTs()
  db.prepare(`
    UPDATE person
    SET faceCount = (
      SELECT COUNT(*)
      FROM person_face
      WHERE person_face.personId = person.id
    ),
    updatedAt = ?
  `).run(ts)

  db.prepare(`
    UPDATE person
    SET featureFaceId = (
      SELECT faceId
      FROM person_face
      WHERE person_face.personId = person.id
      ORDER BY assignedAt ASC
      LIMIT 1
    )
    WHERE featureFaceId IS NULL OR featureFaceId NOT IN (
      SELECT faceId FROM person_face WHERE person_face.personId = person.id
    )
  `).run()
}

function updateFaceAssignmentStatus(db) {
  const ts = nowTs()
  db.prepare(`
    UPDATE face
    SET status = 'assigned', updatedAt = ?
    WHERE id IN (SELECT faceId FROM person_face)
  `).run(ts)

  db.prepare(`
    UPDATE face
    SET status = 'unassigned', updatedAt = ?
    WHERE id NOT IN (SELECT faceId FROM person_face)
      AND status != 'deferred'
  `).run(ts)
}

function toPersonLabel(personId, name) {
  const nextName = typeof name === 'string' ? name.trim() : ''
  if (nextName) return nextName
  return `人物 ${personId.slice(0, 8)}`
}

function syncVisionFaceTags(db, faceIds = null) {
  let rows = []
  if (Array.isArray(faceIds) && faceIds.length > 0) {
    const placeholders = faceIds.map(() => '?').join(',')
    rows = db.prepare(`
      SELECT
        face.id AS faceId,
        face.fileId AS fileId,
        person_face.personId AS personId,
        person.name AS personName
      FROM face
      LEFT JOIN person_face ON person_face.faceId = face.id
      LEFT JOIN person ON person.id = person_face.personId
      WHERE face.id IN (${placeholders})
    `).all(...faceIds)
  } else {
    rows = db.prepare(`
      SELECT
        face.id AS faceId,
        face.fileId AS fileId,
        person_face.personId AS personId,
        person.name AS personName
      FROM face
      LEFT JOIN person_face ON person_face.faceId = face.id
      LEFT JOIN person ON person.id = person_face.personId
    `).all()
  }

  for (const row of rows) {
    const sourceRefId = `face:${row.faceId}`
    if (row.personId) {
      upsertTagForSourceRef(db, {
        fileId: row.fileId,
        key: 'person',
        value: toPersonLabel(row.personId, row.personName),
        source: FACE_SOURCE,
        sourceRefId,
        confidence: null,
        status: 'active',
      })
    } else {
      removeTagBySourceRef(db, FACE_SOURCE, sourceRefId)
    }
  }
}

async function listFilesRecursively(rootPath) {
  const result = []

  async function walk(relativeDir) {
    const absDir = relativeDir ? resolvePathWithinRoot(rootPath, relativeDir) : rootPath
    const entries = await fs.readdir(absDir, { withFileTypes: true })

    for (const entry of entries) {
      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (childRelative === DB_DIRNAME || childRelative.startsWith(`${DB_DIRNAME}/`)) continue
      if (childRelative === '.trash' || childRelative.startsWith('.trash/')) continue

      if (entry.isDirectory()) {
        await walk(childRelative)
        continue
      }
      if (!entry.isFile()) continue
      result.push(childRelative)
    }
  }

  await walk('')
  return result
}

async function buildSnapshotIndex(rootPath) {
  const relativePaths = await listFilesRecursively(rootPath)
  const bySizeMtime = new Map()

  for (const relativePath of relativePaths) {
    try {
      const absPath = resolvePathWithinRoot(rootPath, relativePath)
      const statResult = await fs.stat(absPath)
      if (!statResult.isFile()) continue
      const size = Number(statResult.size)
      const mtime = toFileMtimeMs(statResult)
      const key = `${size}:${mtime}`
      const list = bySizeMtime.get(key) ?? []
      list.push({ relativePath, stat: statResult })
      bySizeMtime.set(key, list)
    } catch {
      // ignore broken entries
    }
  }

  return {
    bySizeMtime,
  }
}

export async function setAnnotationValue(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const relativePath = normalizeRelativePath(params.relativePath, 'relativePath')
  const fieldKey = typeof params.fieldKey === 'string' ? params.fieldKey.trim() : ''
  const value = typeof params.value === 'string' ? params.value.trim() : ''
  const source = params.source === 'hotkey' ? 'hotkey' : 'click'

  if (!fieldKey) throw new Error('fieldKey is required')
  if (!value) throw new Error('value is required')

  return withDb(rootPath, async (db, resolvedRoot) => (
    withTransaction(db, async () => {
      const file = await ensureFileEntry(db, resolvedRoot, relativePath)
      const ts = nowTs()

      const existing = db.prepare(`
        SELECT *
        FROM annotation_record
        WHERE fileId = ? AND fieldKey = ?
      `).get(file.id, fieldKey)

      const id = existing?.id ?? randomUUID()
      if (existing) {
        db.prepare(`
          UPDATE annotation_record
          SET value = ?, source = ?, status = 'active', orphanReason = NULL,
              fileSizeBytes = ?, fileMtimeMs = ?, bindingFp = ?, updatedAt = ?
          WHERE id = ?
        `).run(
          value,
          source,
          file.fileSizeBytes,
          file.fileMtimeMs,
          file.bindingFp,
          ts,
          id,
        )
      } else {
        db.prepare(`
          INSERT INTO annotation_record(
            id, fileId, fieldKey, value, source, status, orphanReason,
            fileSizeBytes, fileMtimeMs, bindingFp, createdAt, updatedAt
          )
          VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?)
        `).run(
          id,
          file.id,
          fieldKey,
          value,
          source,
          file.fileSizeBytes,
          file.fileMtimeMs,
          file.bindingFp,
          ts,
          ts,
        )
      }

      upsertTagForSourceRef(db, {
        fileId: file.id,
        key: fieldKey,
        value,
        source: ANNOTATION_SOURCE,
        sourceRefId: id,
        confidence: null,
        status: 'active',
      })

      return {
        ok: true,
        id,
        fileId: file.id,
        relativePath,
        fieldKey,
        value,
        source,
      }
    })
  ))
}

export async function refreshAnnotationBindings(params) {
  const rootPath = resolveRootPath(params.rootPath)

  return withDb(rootPath, async (db, resolvedRoot) => (
    withTransaction(db, async () => {
      const rows = db.prepare(`
        SELECT
          annotation_record.*,
          file.relativePath AS relativePath
        FROM annotation_record
        INNER JOIN file ON file.id = annotation_record.fileId
      `).all()

      if (rows.length === 0) {
        return {
          ok: true,
          total: 0,
          active: 0,
          orphan: 0,
          conflict: 0,
          rebound: 0,
        }
      }

      let active = 0
      let orphan = 0
      let conflict = 0
      let rebound = 0
      const ts = nowTs()
      let snapshotIndex = null

      for (const row of rows) {
        const id = row.id
        const relativePath = row.relativePath
        const recordedSize = parseFiniteNumber(row.fileSizeBytes, -1)
        const recordedMtime = parseFiniteNumber(row.fileMtimeMs, -1)
        const bindingFp = typeof row.bindingFp === 'string' ? row.bindingFp : ''

        let statMatched = false
        let currentStat = null

        try {
          const absPath = resolvePathWithinRoot(resolvedRoot, relativePath)
          const statResult = await fs.stat(absPath)
          if (statResult.isFile()) {
            currentStat = statResult
            const currentSize = Number(statResult.size)
            const currentMtime = toFileMtimeMs(statResult)
            if (currentSize === recordedSize && currentMtime === recordedMtime) {
              statMatched = true
            }
          }
        } catch {
          currentStat = null
        }

        if (statMatched) {
          db.prepare(`
            UPDATE annotation_record
            SET status = 'active', orphanReason = NULL, updatedAt = ?
            WHERE id = ?
          `).run(ts, id)
          db.prepare(`
            UPDATE tag
            SET status = 'active', updatedAt = ?
            WHERE source = ? AND sourceRefId = ?
          `).run(ts, ANNOTATION_SOURCE, id)
          active += 1
          continue
        }

        if (currentStat && (recordedSize < 0 || recordedMtime < 0)) {
          const currentSize = Number(currentStat.size)
          const currentMtime = toFileMtimeMs(currentStat)
          const absPath = resolvePathWithinRoot(resolvedRoot, relativePath)
          const fps = await computeFingerprintsForFile(absPath, relativePath, {
            exactEnabled: false,
            similarImageEnabled: false,
          }, currentStat)

          db.prepare(`
            UPDATE annotation_record
            SET fileSizeBytes = ?, fileMtimeMs = ?, bindingFp = ?,
                status = 'active', orphanReason = NULL, updatedAt = ?
            WHERE id = ?
          `).run(currentSize, currentMtime, fps.bindingFp, ts, id)

          db.prepare(`
            UPDATE tag
            SET status = 'active', updatedAt = ?
            WHERE source = ? AND sourceRefId = ?
          `).run(ts, ANNOTATION_SOURCE, id)
          active += 1
          continue
        }

        if (!bindingFp || recordedSize < 0 || recordedMtime < 0) {
          db.prepare(`
            UPDATE annotation_record
            SET status = 'orphan', orphanReason = 'no_candidate', updatedAt = ?
            WHERE id = ?
          `).run(ts, id)
          db.prepare(`
            UPDATE tag
            SET status = 'orphan', updatedAt = ?
            WHERE source = ? AND sourceRefId = ?
          `).run(ts, ANNOTATION_SOURCE, id)
          orphan += 1
          continue
        }

        if (!snapshotIndex) {
          snapshotIndex = await buildSnapshotIndex(resolvedRoot)
        }

        const key = `${recordedSize}:${recordedMtime}`
        const candidates = snapshotIndex.bySizeMtime.get(key) ?? []
        const matched = []

        for (const candidate of candidates) {
          try {
            const absPath = resolvePathWithinRoot(resolvedRoot, candidate.relativePath)
            const candidateFp = await computeFingerprintsForFile(absPath, candidate.relativePath, {
              exactEnabled: false,
              similarImageEnabled: false,
            }, candidate.stat)
            if (candidateFp.bindingFp === bindingFp) {
              matched.push({
                relativePath: candidate.relativePath,
                stat: candidate.stat,
                bindingFp: candidateFp.bindingFp,
              })
            }
          } catch {
            // ignore candidate failures
          }
        }

        if (matched.length === 1) {
          const candidate = matched[0]
          let targetFile = getFileByRelativePath(db, candidate.relativePath)
          if (!targetFile) {
            const nextId = randomUUID()
            db.prepare(`
              INSERT INTO file(id, relativePath, fileSizeBytes, fileMtimeMs, bindingFp, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              nextId,
              candidate.relativePath,
              Number(candidate.stat.size),
              toFileMtimeMs(candidate.stat),
              candidate.bindingFp,
              ts,
              ts,
            )
            targetFile = getFileById(db, nextId)
          }

          db.prepare(`
            UPDATE annotation_record
            SET fileId = ?, status = 'active', orphanReason = NULL,
                fileSizeBytes = ?, fileMtimeMs = ?, bindingFp = ?, updatedAt = ?
            WHERE id = ?
          `).run(
            targetFile.id,
            Number(candidate.stat.size),
            toFileMtimeMs(candidate.stat),
            candidate.bindingFp,
            ts,
            id,
          )

          db.prepare(`
            UPDATE file
            SET fileSizeBytes = ?, fileMtimeMs = ?, bindingFp = ?, updatedAt = ?
            WHERE id = ?
          `).run(Number(candidate.stat.size), toFileMtimeMs(candidate.stat), candidate.bindingFp, ts, targetFile.id)

          db.prepare(`
            UPDATE tag
            SET status = 'active', updatedAt = ?
            WHERE source = ? AND sourceRefId = ?
          `).run(ts, ANNOTATION_SOURCE, id)

          db.prepare(`
            INSERT INTO file_tag(fileId, tagId, appliedAt)
            SELECT ?, id, ?
            FROM tag
            WHERE source = ? AND sourceRefId = ?
            ON CONFLICT(fileId, tagId) DO UPDATE SET appliedAt = excluded.appliedAt
          `).run(targetFile.id, ts, ANNOTATION_SOURCE, id)

          active += 1
          rebound += 1
          continue
        }

        if (matched.length > 1) {
          db.prepare(`
            UPDATE annotation_record
            SET status = 'conflict', orphanReason = 'ambiguous_rebind', updatedAt = ?
            WHERE id = ?
          `).run(ts, id)
          db.prepare(`
            UPDATE tag
            SET status = 'conflict', updatedAt = ?
            WHERE source = ? AND sourceRefId = ?
          `).run(ts, ANNOTATION_SOURCE, id)
          conflict += 1
          continue
        }

        db.prepare(`
          UPDATE annotation_record
          SET status = 'orphan', orphanReason = 'no_candidate', updatedAt = ?
          WHERE id = ?
        `).run(ts, id)
        db.prepare(`
          UPDATE tag
          SET status = 'orphan', updatedAt = ?
          WHERE source = ? AND sourceRefId = ?
        `).run(ts, ANNOTATION_SOURCE, id)
        orphan += 1
      }

      return {
        ok: true,
        total: rows.length,
        active,
        orphan,
        conflict,
        rebound,
      }
    })
  ))
}

export async function cleanupAnnotationOrphans(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const confirm = parseBoolean(params.confirm, false)

  return withDb(rootPath, async (db) => (
    withTransaction(db, async () => {
      const orphanRows = db.prepare(`
        SELECT id
        FROM annotation_record
        WHERE status = 'orphan'
      `).all()

      const totalOrphans = orphanRows.length
      if (!confirm) {
        return {
          ok: true,
          dryRun: true,
          totalOrphans,
          removed: 0,
        }
      }

      for (const row of orphanRows) {
        const annotationId = row.id
        removeTagBySourceRef(db, ANNOTATION_SOURCE, annotationId)
        db.prepare('DELETE FROM annotation_record WHERE id = ?').run(annotationId)
      }

      return {
        ok: true,
        dryRun: false,
        totalOrphans,
        removed: orphanRows.length,
      }
    })
  ))
}

export async function getFileTags(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const fileId = typeof params.fileId === 'string' ? params.fileId : null
  const relativePath = typeof params.relativePath === 'string' && params.relativePath.trim()
    ? normalizeRelativePath(params.relativePath)
    : null

  return withDb(rootPath, async (db) => {
    let file = null
    if (fileId) {
      file = getFileById(db, fileId)
    } else if (relativePath) {
      file = getFileByRelativePath(db, relativePath)
    }

    if (!file) {
      return {
        ok: true,
        file: null,
      }
    }

    const tagRows = db.prepare(`
      SELECT tag.*
      FROM tag
      INNER JOIN file_tag ON file_tag.tagId = tag.id
      WHERE file_tag.fileId = ? AND tag.status = 'active'
      ORDER BY tag.updatedAt DESC, tag.createdAt DESC
    `).all(file.id)

    return {
      ok: true,
      file: {
        fileId: file.id,
        relativePath: file.relativePath,
        tags: tagRows.map(toTagDto),
      },
    }
  })
}

function fileMatchesAnnotationTag(tagSet, tagKey) {
  if (tagKey === UNANNOTATED_TAG_KEY) {
    return tagSet.size === 0
  }
  return tagSet.has(tagKey)
}

function matchesTagFilter(tagKeys, includeTagKeys, excludeTagKeys, includeMatchMode) {
  if (includeTagKeys.length === 0 && excludeTagKeys.length === 0) return true
  const tagSet = new Set(tagKeys)

  const includeMatched = includeTagKeys.length === 0
    ? true
    : includeMatchMode === 'and'
      ? includeTagKeys.every((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))
      : includeTagKeys.some((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))

  if (!includeMatched) return false
  return !excludeTagKeys.some((tagKey) => fileMatchesAnnotationTag(tagSet, tagKey))
}

export async function listTagOptions(params) {
  const rootPath = resolveRootPath(params.rootPath)

  return withDb(rootPath, async (db) => {
    const rows = db.prepare(`
      SELECT
        tag.key AS key,
        tag.value AS value,
        COUNT(DISTINCT file_tag.fileId) AS fileCount
      FROM tag
      INNER JOIN file_tag ON file_tag.tagId = tag.id
      WHERE tag.status = 'active'
      GROUP BY tag.key, tag.value
      ORDER BY tag.key ASC, tag.value ASC
    `).all()

    return {
      ok: true,
      items: rows.map((row) => ({
        tagKey: buildTagKey(row.key, row.value),
        key: row.key,
        value: row.value,
        fileCount: Number(row.fileCount ?? 0),
      })),
    }
  })
}

export async function queryFilesByTags(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const includeTagKeys = Array.isArray(params.includeTagKeys)
    ? params.includeTagKeys.filter((item) => typeof item === 'string')
    : []
  const excludeTagKeys = Array.isArray(params.excludeTagKeys)
    ? params.excludeTagKeys.filter((item) => typeof item === 'string')
    : []
  const includeMatchMode = params.includeMatchMode === 'and' ? 'and' : 'or'
  const page = Math.max(1, parseInteger(params.page, 1))
  const size = Math.min(5000, Math.max(1, parseInteger(params.size, 500)))

  return withDb(rootPath, async (db) => {
    const rows = db.prepare(`
      SELECT
        file.id AS fileId,
        file.relativePath AS relativePath,
        tag.id AS tagId,
        tag.key AS key,
        tag.value AS value,
        tag.source AS source,
        tag.sourceRefId AS sourceRefId,
        tag.confidence AS confidence,
        tag.status AS status,
        tag.createdAt AS createdAt,
        tag.updatedAt AS updatedAt
      FROM file
      LEFT JOIN file_tag ON file_tag.fileId = file.id
      LEFT JOIN tag ON tag.id = file_tag.tagId AND tag.status = 'active'
      ORDER BY file.relativePath ASC
    `).all()

    const byFile = new Map()
    for (const row of rows) {
      const fileId = row.fileId
      const existing = byFile.get(fileId) ?? {
        fileId,
        relativePath: row.relativePath,
        tags: [],
        updatedAt: 0,
      }
      if (row.tagId) {
        const dto = toTagDto(row)
        existing.tags.push(dto)
        existing.updatedAt = Math.max(existing.updatedAt, Number(dto.updatedAt ?? 0))
      }
      byFile.set(fileId, existing)
    }

    const filtered = []
    for (const item of byFile.values()) {
      const tagKeys = item.tags.map((tag) => buildTagKey(tag.key, tag.value))
      if (!matchesTagFilter(tagKeys, includeTagKeys, excludeTagKeys, includeMatchMode)) {
        continue
      }
      filtered.push(item)
    }

    filtered.sort((left, right) => left.relativePath.localeCompare(right.relativePath))

    const total = filtered.length
    const offset = (page - 1) * size
    const paged = filtered.slice(offset, offset + size)

    return {
      ok: true,
      page,
      size,
      total,
      items: paged,
    }
  })
}

export async function saveDetectedFaces(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const relativePath = normalizeRelativePath(params.relativePath, 'relativePath')
  const facePayloads = Array.isArray(params.facePayloads) ? params.facePayloads : []

  return withDb(rootPath, async (db, resolvedRoot) => (
    withTransaction(db, async () => {
      const file = await ensureFileEntry(db, resolvedRoot, relativePath)
      const ts = nowTs()

      const existingRows = db.prepare('SELECT id FROM face WHERE fileId = ?').all(file.id)
      const existingFaceIds = existingRows.map((row) => row.id)
      if (existingFaceIds.length > 0) {
        const placeholders = existingFaceIds.map(() => '?').join(',')
        db.prepare(`
          UPDATE person
          SET featureFaceId = NULL
          WHERE featureFaceId IN (${placeholders})
        `).run(...existingFaceIds)

        for (const faceId of existingFaceIds) {
          removeTagBySourceRef(db, FACE_SOURCE, `face:${faceId}`)
        }
      }

      db.prepare('DELETE FROM face WHERE fileId = ?').run(file.id)

      const createdFaces = []
      for (const payload of facePayloads) {
        const box = payload?.boundingBox
        const embedding = payload?.embedding
        if (!box || typeof box !== 'object' || !Array.isArray(embedding)) {
          continue
        }

        const x1 = parseFiniteNumber(box.x1, NaN)
        const y1 = parseFiniteNumber(box.y1, NaN)
        const x2 = parseFiniteNumber(box.x2, NaN)
        const y2 = parseFiniteNumber(box.y2, NaN)
        const score = parseFiniteNumber(payload.score, 0)

        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
          continue
        }

        const faceId = randomUUID()
        const embeddingBlob = toEmbeddingBlob(embedding)

        db.prepare(`
          INSERT INTO face(id, fileId, x1, y1, x2, y2, score, status, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'unassigned', ?, ?)
        `).run(faceId, file.id, x1, y1, x2, y2, score, ts, ts)

        db.prepare(`
          INSERT INTO face_embedding(faceId, dim, embedding)
          VALUES (?, ?, ?)
        `).run(faceId, EMBEDDING_DIM, embeddingBlob)

        db.prepare(`
          INSERT INTO face_job_state(faceId, detectStatus, clusterStatus, deferred, attempts, lastErrorCode, lastRunAt, nextRunAt)
          VALUES (?, 'success', 'pending', 0, 0, NULL, ?, NULL)
          ON CONFLICT(faceId) DO UPDATE SET
            detectStatus = 'success',
            clusterStatus = 'pending',
            deferred = 0,
            lastErrorCode = NULL,
            lastRunAt = excluded.lastRunAt
        `).run(faceId, ts)

        createdFaces.push({
          faceId,
          assetPath: relativePath,
          boundingBox: { x1, y1, x2, y2 },
          score,
          personId: null,
          status: 'unassigned',
        })
      }

      updateFaceAssignmentStatus(db)
      refreshPersonCache(db)
      db.prepare('DELETE FROM person WHERE id NOT IN (SELECT personId FROM person_face)').run()

      return {
        ok: true,
        fileId: file.id,
        assetPath: relativePath,
        detected: facePayloads.length,
        created: createdFaces.length,
        updated: 0,
        skipped: Math.max(0, facePayloads.length - createdFaces.length),
        faces: createdFaces,
      }
    })
  ))
}

export async function clusterPendingFaces(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const limit = Math.min(2000, Math.max(1, parseInteger(params.limit, 100)))
  const maxDistance = parseFiniteNumber(params.maxDistance, 0.5)
  const minFaces = Math.max(1, parseInteger(params.minFaces, 3))

  return withDb(rootPath, async (db) => (
    withTransaction(db, async () => {
      const rows = db.prepare(`
        SELECT
          face.id AS id,
          face.status AS status,
          face.fileId AS fileId,
          face.score AS score,
          face_embedding.embedding AS embedding
        FROM face
        INNER JOIN face_embedding ON face_embedding.faceId = face.id
        WHERE face.status IN ('unassigned', 'deferred')
        ORDER BY face.updatedAt ASC
        LIMIT ?
      `).all(limit)

      if (rows.length === 0) {
        return {
          ok: true,
          processed: 0,
          assigned: 0,
          createdPersons: 0,
          deferred: 0,
          skipped: 0,
          failed: 0,
        }
      }

      const allRows = db.prepare(`
        SELECT
          face.id AS faceId,
          face_embedding.embedding AS embedding,
          person_face.personId AS personId
        FROM face
        INNER JOIN face_embedding ON face_embedding.faceId = face.id
        LEFT JOIN person_face ON person_face.faceId = face.id
      `).all()

      const allEmbeddings = allRows.map((row) => ({
        faceId: row.faceId,
        embedding: fromEmbeddingBlob(row.embedding),
        personId: row.personId,
      }))

      let processed = 0
      let assigned = 0
      let createdPersons = 0
      let deferred = 0
      let skipped = 0
      let failed = 0
      const touchedFaceIds = []

      for (const row of rows) {
        processed += 1
        const faceId = row.id
        const currentEmbedding = fromEmbeddingBlob(row.embedding)
        const { matches, matchedPersonId } = choosePersonForFace(faceId, currentEmbedding, allEmbeddings, maxDistance)
        const isCore = matches.length >= minFaces

        let personId = matchedPersonId
        if (!personId && isCore) {
          personId = randomUUID()
          const ts = nowTs()
          db.prepare(`
            INSERT INTO person(id, name, featureFaceId, faceCount, createdAt, updatedAt)
            VALUES (?, '', ?, 0, ?, ?)
          `).run(personId, faceId, ts, ts)
          createdPersons += 1
        }

        if (personId) {
          const ts = nowTs()
          db.prepare(`
            INSERT INTO person_face(personId, faceId, assignedBy, assignedAt)
            VALUES (?, ?, 'auto', ?)
            ON CONFLICT(faceId) DO UPDATE SET
              personId = excluded.personId,
              assignedBy = 'auto',
              assignedAt = excluded.assignedAt
          `).run(personId, faceId, ts)

          db.prepare(`
            UPDATE face
            SET status = 'assigned', updatedAt = ?
            WHERE id = ?
          `).run(ts, faceId)

          db.prepare(`
            INSERT INTO face_job_state(faceId, detectStatus, clusterStatus, deferred, attempts, lastErrorCode, lastRunAt, nextRunAt)
            VALUES (?, 'success', 'assigned', 0, 0, NULL, ?, NULL)
            ON CONFLICT(faceId) DO UPDATE SET
              clusterStatus = 'assigned',
              deferred = 0,
              lastErrorCode = NULL,
              lastRunAt = excluded.lastRunAt
          `).run(faceId, ts)

          for (const item of allEmbeddings) {
            if (item.faceId === faceId) {
              item.personId = personId
              break
            }
          }

          touchedFaceIds.push(faceId)
          assigned += 1
        } else {
          const ts = nowTs()
          db.prepare(`
            UPDATE face
            SET status = 'deferred', updatedAt = ?
            WHERE id = ?
          `).run(ts, faceId)

          db.prepare(`
            INSERT INTO face_job_state(faceId, detectStatus, clusterStatus, deferred, attempts, lastErrorCode, lastRunAt, nextRunAt)
            VALUES (?, 'success', 'deferred', 1, 0, NULL, ?, NULL)
            ON CONFLICT(faceId) DO UPDATE SET
              clusterStatus = 'deferred',
              deferred = 1,
              lastErrorCode = NULL,
              lastRunAt = excluded.lastRunAt
          `).run(faceId, ts)

          touchedFaceIds.push(faceId)
          deferred += 1
        }
      }

      updateFaceAssignmentStatus(db)
      refreshPersonCache(db)
      syncVisionFaceTags(db, touchedFaceIds)

      return {
        ok: true,
        processed,
        assigned,
        createdPersons,
        deferred,
        skipped,
        failed,
      }
    })
  ))
}

export async function listPeople(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const page = Math.max(1, parseInteger(params.page, 1))
  const size = Math.min(500, Math.max(1, parseInteger(params.size, 50)))
  const offset = (page - 1) * size

  return withDb(rootPath, async (db) => {
    const totalRow = db.prepare('SELECT COUNT(*) AS count FROM person').get()
    const total = Number(totalRow?.count ?? 0)

    const rows = db.prepare(`
      SELECT
        person.id AS id,
        person.name AS name,
        person.faceCount AS faceCount,
        person.featureFaceId AS featureFaceId,
        person.updatedAt AS updatedAt,
        file.relativePath AS featureAssetPath
      FROM person
      LEFT JOIN face ON face.id = person.featureFaceId
      LEFT JOIN file ON file.id = face.fileId
      ORDER BY person.faceCount DESC, person.updatedAt DESC, person.createdAt DESC
      LIMIT ? OFFSET ?
    `).all(size, offset)

    return {
      ok: true,
      page,
      size,
      total,
      items: rows.map((row) => ({
        personId: row.id,
        name: row.name,
        faceCount: Number(row.faceCount ?? 0),
        featureFaceId: row.featureFaceId,
        featureAssetPath: row.featureAssetPath,
        updatedAt: Number(row.updatedAt ?? 0),
      })),
    }
  })
}

export async function renamePerson(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const personId = typeof params.personId === 'string' ? params.personId.trim() : ''
  const name = typeof params.name === 'string' ? params.name.trim() : ''
  if (!personId) throw new Error('personId is required')

  return withDb(rootPath, async (db) => (
    withTransaction(db, async () => {
      const ts = nowTs()
      const cursor = db.prepare('UPDATE person SET name = ?, updatedAt = ? WHERE id = ?').run(name, ts, personId)
      if (Number(cursor?.changes ?? 0) === 0) {
        throw new Error(`person not found: ${personId}`)
      }

      const faceRows = db.prepare(`
        SELECT face.id AS faceId
        FROM face
        INNER JOIN person_face ON person_face.faceId = face.id
        WHERE person_face.personId = ?
      `).all(personId)
      syncVisionFaceTags(db, faceRows.map((row) => row.faceId))

      const row = db.prepare(`
        SELECT
          person.id AS id,
          person.name AS name,
          person.faceCount AS faceCount,
          person.featureFaceId AS featureFaceId,
          person.updatedAt AS updatedAt,
          file.relativePath AS featureAssetPath
        FROM person
        LEFT JOIN face ON face.id = person.featureFaceId
        LEFT JOIN file ON file.id = face.fileId
        WHERE person.id = ?
      `).get(personId)

      return {
        ok: true,
        person: {
          personId: row.id,
          name: row.name,
          faceCount: Number(row.faceCount ?? 0),
          featureFaceId: row.featureFaceId,
          featureAssetPath: row.featureAssetPath,
          updatedAt: Number(row.updatedAt ?? 0),
        },
      }
    })
  ))
}

export async function mergePeople(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const targetPersonId = typeof params.targetPersonId === 'string' ? params.targetPersonId.trim() : ''
  const sourcePersonIds = Array.isArray(params.sourcePersonIds)
    ? params.sourcePersonIds.filter((item) => typeof item === 'string').map((item) => item.trim())
    : []

  if (!targetPersonId) throw new Error('targetPersonId is required')

  const validSources = sourcePersonIds.filter((item) => item && item !== targetPersonId)
  if (validSources.length === 0) {
    throw new Error('sourcePersonIds must contain at least one non-target personId')
  }

  return withDb(rootPath, async (db) => (
    withTransaction(db, async () => {
      const targetExists = db.prepare('SELECT 1 AS ok FROM person WHERE id = ?').get(targetPersonId)
      if (!targetExists) {
        throw new Error(`target person not found: ${targetPersonId}`)
      }

      const ts = nowTs()
      const merged = []
      const skipped = []
      const touchedFaces = []

      for (const sourceId of validSources) {
        const sourceExists = db.prepare('SELECT 1 AS ok FROM person WHERE id = ?').get(sourceId)
        if (!sourceExists) {
          skipped.push(sourceId)
          continue
        }

        const sourceFaceRows = db.prepare(`
          SELECT faceId
          FROM person_face
          WHERE personId = ?
        `).all(sourceId)

        db.prepare(`
          UPDATE person_face
          SET personId = ?, assignedBy = 'merge', assignedAt = ?
          WHERE personId = ?
        `).run(targetPersonId, ts, sourceId)

        db.prepare('DELETE FROM person WHERE id = ?').run(sourceId)
        merged.push(sourceId)
        touchedFaces.push(...sourceFaceRows.map((row) => row.faceId))
      }

      updateFaceAssignmentStatus(db)
      refreshPersonCache(db)
      if (touchedFaces.length > 0) {
        syncVisionFaceTags(db, touchedFaces)
      }

      return {
        ok: true,
        targetPersonId,
        merged: merged.length,
        sourcePersonIds: merged,
        skippedSourcePersonIds: skipped,
      }
    })
  ))
}

export async function listAssetFaces(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const personId = typeof params.personId === 'string' ? params.personId.trim() : ''
  const hasRelativePath = typeof params.relativePath === 'string' && params.relativePath.trim()

  if (!personId && !hasRelativePath) {
    throw new Error('listAssetFaces requires relativePath or personId')
  }

  return withDb(rootPath, async (db) => {
    let rows = []

    if (personId) {
      rows = db.prepare(`
        SELECT
          face.id AS id,
          face.x1 AS x1,
          face.y1 AS y1,
          face.x2 AS x2,
          face.y2 AS y2,
          face.score AS score,
          face.status AS status,
          person_face.personId AS personId,
          file.relativePath AS assetPath
        FROM face
        INNER JOIN person_face ON person_face.faceId = face.id
        INNER JOIN file ON file.id = face.fileId
        WHERE person_face.personId = ?
        ORDER BY face.updatedAt DESC
      `).all(personId)
    } else {
      const relativePath = normalizeRelativePath(params.relativePath)
      rows = db.prepare(`
        SELECT
          face.id AS id,
          face.x1 AS x1,
          face.y1 AS y1,
          face.x2 AS x2,
          face.y2 AS y2,
          face.score AS score,
          face.status AS status,
          person_face.personId AS personId,
          file.relativePath AS assetPath
        FROM face
        INNER JOIN file ON file.id = face.fileId
        LEFT JOIN person_face ON person_face.faceId = face.id
        WHERE file.relativePath = ?
        ORDER BY face.x1 ASC
      `).all(relativePath)
    }

    return {
      ok: true,
      total: rows.length,
      items: rows.map((row) => ({
        faceId: row.id,
        assetPath: row.assetPath,
        boundingBox: {
          x1: Number(row.x1),
          y1: Number(row.y1),
          x2: Number(row.x2),
          y2: Number(row.y2),
        },
        score: Number(row.score ?? 0),
        status: row.status,
        personId: row.personId ?? null,
      })),
    }
  })
}

export async function ingestClassificationResult(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const toolName = typeof params.toolName === 'string' ? params.toolName : ''
  const toolResult = params.toolResult && typeof params.toolResult === 'object' ? params.toolResult : null
  const toolArgs = params.toolArgs && typeof params.toolArgs === 'object' ? params.toolArgs : {}

  if (!toolResult) {
    return { ok: true, ingested: 0 }
  }

  const tasks = []

  if (toolName === 'ml.classifyImage') {
    const relativePath = typeof toolArgs.relativePath === 'string' ? toolArgs.relativePath : ''
    const predictions = Array.isArray(toolResult.predictions) ? toolResult.predictions : []
    if (relativePath && predictions.length > 0) {
      tasks.push({ relativePath, predictions })
    }
  }

  if (toolName === 'ml.classifyBatch') {
    const items = Array.isArray(toolResult.items) ? toolResult.items : []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const relativePath = typeof item.relativePath === 'string' ? item.relativePath : ''
      const ok = item.ok === true
      const predictions = Array.isArray(item.predictions) ? item.predictions : []
      if (!ok || !relativePath || predictions.length === 0) continue
      tasks.push({ relativePath, predictions })
    }
  }

  if (tasks.length === 0) {
    return { ok: true, ingested: 0 }
  }

  return withDb(rootPath, async (db, resolvedRoot) => (
    withTransaction(db, async () => {
      let ingested = 0
      for (const task of tasks) {
        let file = null
        try {
          file = await ensureFileEntry(db, resolvedRoot, task.relativePath)
        } catch {
          continue
        }

        removeClassifyTagsForFile(db, file.id)

        for (let index = 0; index < task.predictions.length; index += 1) {
          const prediction = task.predictions[index]
          if (!prediction || typeof prediction !== 'object') continue
          const label = typeof prediction.label === 'string' ? prediction.label.trim() : ''
          if (!label) continue
          const score = parseFiniteNumber(prediction.score, 0)
          upsertTagForSourceRef(db, {
            fileId: file.id,
            key: 'class',
            value: label,
            source: CLASSIFY_SOURCE,
            sourceRefId: `file:${file.id}:${index}`,
            confidence: score,
            status: 'active',
          })
          ingested += 1
        }
      }

      return {
        ok: true,
        ingested,
      }
    })
  ))
}

export async function callVisionInference(runtime, params) {
  const rootPath = resolveRootPath(params.rootPath)
  const relativePath = normalizeRelativePath(params.relativePath, 'relativePath')
  const result = await runtime.callTool('vision.face', {
    rootPath,
    operation: 'detectAsset',
    relativePath,
  })

  const items = Array.isArray(result?.faces) ? result.faces : []
  const normalizedFaces = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const box = item.boundingBox
    const embedding = Array.isArray(item.embedding) ? item.embedding : null
    if (!box || typeof box !== 'object' || !embedding) continue
    normalizedFaces.push({
      boundingBox: {
        x1: parseFiniteNumber(box.x1, NaN),
        y1: parseFiniteNumber(box.y1, NaN),
        x2: parseFiniteNumber(box.x2, NaN),
        y2: parseFiniteNumber(box.y2, NaN),
      },
      score: parseFiniteNumber(item.score, 0),
      embedding,
    })
  }

  return {
    ok: true,
    rootPath,
    relativePath,
    faces: normalizedFaces,
    detected: normalizedFaces.length,
  }
}
