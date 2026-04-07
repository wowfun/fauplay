import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  SCHEMA_VERSION,
  EMBEDDING_DIM,
  FACE_SOURCE,
  GLOBAL_DB_PATH,
  migrateLegacyGlobalDb,
  nowTs,
  normalizeRelativePath,
  resolvePathWithinRoot,
  toFileMtimeMs,
  computeFingerprintsForFile,
  parseFiniteNumber,
  statPath,
} from './common.mjs'

function openDb() {
  const db = new DatabaseSync(GLOBAL_DB_PATH)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = DELETE')
  ensureSchema(db)
  return db
}

function quoteIdentifier(input) {
  return `"${String(input).replace(/"/g, '""')}"`
}

function rebuildSchema(db) {
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    const tableRows = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all()

    for (const row of tableRows) {
      const tableName = typeof row?.name === 'string' ? row.name : ''
      if (!tableName) continue
      db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`)
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function createSchemaV4(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset (
      id TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      fpMethod TEXT NOT NULL,
      sha256 TEXT,
      deletedAt INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      UNIQUE(size, fingerprint, fpMethod)
    );

    CREATE TABLE IF NOT EXISTS file (
      absolutePath TEXT PRIMARY KEY,
      assetId TEXT NOT NULL,
      fileMtimeMs INTEGER,
      lastSeenAt INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(assetId) REFERENCES asset(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tag (
      id TEXT NOT NULL UNIQUE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY(key, value, source)
    );

    CREATE TABLE IF NOT EXISTS asset_tag (
      assetId TEXT NOT NULL,
      tagId TEXT NOT NULL,
      appliedAt INTEGER NOT NULL,
      score REAL,
      PRIMARY KEY(assetId, tagId),
      FOREIGN KEY(assetId) REFERENCES asset(id) ON DELETE CASCADE,
      FOREIGN KEY(tagId) REFERENCES tag(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS face (
      id TEXT PRIMARY KEY,
      assetId TEXT NOT NULL,
      mediaType TEXT NOT NULL DEFAULT 'image',
      frameTsMs INTEGER,
      x1 REAL NOT NULL,
      y1 REAL NOT NULL,
      x2 REAL NOT NULL,
      y2 REAL NOT NULL,
      score REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'unassigned',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(assetId) REFERENCES asset(id) ON DELETE CASCADE
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

    CREATE INDEX IF NOT EXISTS idx_file_asset_id ON file(assetId);
    CREATE INDEX IF NOT EXISTS idx_tag_source_key_value ON tag(source, key, value);
    CREATE INDEX IF NOT EXISTS idx_asset_tag_tag_id ON asset_tag(tagId);
    CREATE INDEX IF NOT EXISTS idx_asset_tag_applied_at ON asset_tag(appliedAt);
    CREATE INDEX IF NOT EXISTS idx_face_asset_id ON face(assetId);
    CREATE INDEX IF NOT EXISTS idx_face_status ON face(status);
    CREATE INDEX IF NOT EXISTS idx_person_face_person_id ON person_face(personId);
    CREATE INDEX IF NOT EXISTS idx_asset_deleted_at ON asset(deletedAt);
  `)
}

function ensureSchema(db) {
  const row = db.prepare('PRAGMA user_version').get()
  const currentVersion = Number(row?.user_version ?? 0)
  if (currentVersion !== 0 && currentVersion !== SCHEMA_VERSION) {
    rebuildSchema(db)
  }
  createSchemaV4(db)
  if (currentVersion !== SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
}

export async function withDb(callback) {
  await migrateLegacyGlobalDb()
  const db = openDb()
  try {
    return await callback(db)
  } finally {
    db.close()
  }
}

export async function withTransaction(db, callback) {
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

function getAssetByIdentity(db, identity) {
  return db.prepare(`
    SELECT *
    FROM asset
    WHERE size = ? AND fingerprint = ? AND fpMethod = ?
  `).get(identity.size, identity.fingerprint, identity.fpMethod) ?? null
}

export function getAssetById(db, assetId) {
  if (typeof assetId !== 'string' || !assetId) return null
  return db.prepare('SELECT * FROM asset WHERE id = ?').get(assetId) ?? null
}

export function getOrCreateAsset(db, identity) {
  const existing = getAssetByIdentity(db, identity)
  const ts = nowTs()
  if (existing) {
    db.prepare(`
      UPDATE asset
      SET deletedAt = NULL, updatedAt = ?
      WHERE id = ?
    `).run(ts, existing.id)
    return {
      ...existing,
      deletedAt: null,
      updatedAt: ts,
    }
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO asset(id, size, fingerprint, fpMethod, sha256, deletedAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(id, identity.size, identity.fingerprint, identity.fpMethod, ts, ts)

  return {
    id,
    size: identity.size,
    fingerprint: identity.fingerprint,
    fpMethod: identity.fpMethod,
    sha256: null,
    deletedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }
}

export function getFileByAbsolutePath(db, absolutePath) {
  return db.prepare('SELECT * FROM file WHERE absolutePath = ?').get(absolutePath) ?? null
}

export function softDeleteAssetIfOrphan(db, assetId) {
  if (!assetId) return
  const row = db.prepare(`
    SELECT
      asset.id AS id,
      asset.deletedAt AS deletedAt,
      EXISTS(SELECT 1 FROM file WHERE file.assetId = asset.id) AS hasFiles
    FROM asset
    WHERE asset.id = ?
  `).get(assetId)

  if (!row || Number(row.hasFiles) !== 0 || row.deletedAt !== null) {
    return
  }

  const ts = nowTs()
  db.prepare(`
    UPDATE asset
    SET deletedAt = ?, updatedAt = ?
    WHERE id = ?
  `).run(ts, ts, assetId)
}

export function softDeleteAssetsIfOrphaned(db, assetIds) {
  if (!Array.isArray(assetIds) || assetIds.length === 0) return
  const uniqueAssetIds = [...new Set(assetIds.filter((item) => typeof item === 'string' && item))]
  for (const assetId of uniqueAssetIds) {
    softDeleteAssetIfOrphan(db, assetId)
  }
}

export async function ensureFileEntry(db, rootPath, relativePath) {
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  const absolutePath = resolvePathWithinRoot(rootPath, normalizedRelativePath)
  const statResult = await statPath(absolutePath)
  if (!statResult.isFile()) {
    throw new Error('target path must be a file')
  }

  const identity = await computeFingerprintsForFile(absolutePath, {
    exactEnabled: false,
    similarImageEnabled: false,
  }, statResult)

  const asset = getOrCreateAsset(db, identity)
  const ts = nowTs()
  const mtime = toFileMtimeMs(statResult)
  const existing = getFileByAbsolutePath(db, absolutePath)
  if (existing) {
    db.prepare(`
      UPDATE file
      SET assetId = ?, fileMtimeMs = ?, lastSeenAt = ?, updatedAt = ?
      WHERE absolutePath = ?
    `).run(asset.id, mtime, ts, ts, absolutePath)

    if (existing.assetId !== asset.id) {
      softDeleteAssetIfOrphan(db, existing.assetId)
    }

    return {
      assetId: asset.id,
      absolutePath,
      fileMtimeMs: mtime,
      lastSeenAt: ts,
      updatedAt: ts,
    }
  }

  db.prepare(`
    INSERT INTO file(absolutePath, assetId, fileMtimeMs, lastSeenAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(absolutePath, asset.id, mtime, ts, ts, ts)

  return {
    assetId: asset.id,
    absolutePath,
    fileMtimeMs: mtime,
    lastSeenAt: ts,
    updatedAt: ts,
  }
}

export function resolveFileByRootRelativePath(db, rootPath, relativePath) {
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  const absolutePath = resolvePathWithinRoot(rootPath, normalizedRelativePath)
  return getFileByAbsolutePath(db, absolutePath)
}

function getOrCreateTagId(db, { key, value, source }) {
  const normalizedKey = typeof key === 'string' ? key.trim() : ''
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  const normalizedSource = typeof source === 'string' ? source.trim() : ''
  if (!normalizedKey || !normalizedValue || !normalizedSource) {
    throw new Error('invalid tag payload')
  }

  const existing = db.prepare(`
    SELECT id
    FROM tag
    WHERE key = ? AND value = ? AND source = ?
  `).get(normalizedKey, normalizedValue, normalizedSource)
  if (existing?.id) {
    return existing.id
  }

  const tagId = randomUUID()
  try {
    db.prepare(`
      INSERT INTO tag(id, key, value, source)
      VALUES (?, ?, ?, ?)
    `).run(tagId, normalizedKey, normalizedValue, normalizedSource)
  } catch (error) {
    if (error?.code !== 'SQLITE_CONSTRAINT') {
      throw error
    }

    const conflicted = db.prepare(`
      SELECT id
      FROM tag
      WHERE key = ? AND value = ? AND source = ?
    `).get(normalizedKey, normalizedValue, normalizedSource)
    if (conflicted?.id) {
      return conflicted.id
    }
    throw error
  }
  return tagId
}

function upsertAssetTagBinding(db, { assetId, tagId, appliedAt = nowTs(), score = null }) {
  const normalizedScore = score === null || typeof score === 'undefined'
    ? null
    : parseFiniteNumber(score, 0)
  db.prepare(`
    INSERT INTO asset_tag(assetId, tagId, appliedAt, score)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(assetId, tagId) DO UPDATE SET
      appliedAt = excluded.appliedAt,
      score = excluded.score
  `).run(assetId, tagId, appliedAt, normalizedScore)
}

export function bindTagToAsset(db, { assetId, key, value, source, appliedAt = nowTs(), score = null }) {
  if (!assetId) {
    throw new Error('invalid assetId')
  }
  const tagId = getOrCreateTagId(db, { key, value, source })
  upsertAssetTagBinding(db, { assetId, tagId, appliedAt, score })
  return tagId
}

export function removeTagBindingsForAsset(db, { assetId, source = null, key = null, value = null }) {
  if (!assetId) return

  const where = ['asset_tag.assetId = ?']
  const params = [assetId]
  if (source) {
    where.push('tag.source = ?')
    params.push(source)
  }
  if (key) {
    where.push('tag.key = ?')
    params.push(key)
  }
  if (value) {
    where.push('tag.value = ?')
    params.push(value)
  }

  const rows = db.prepare(`
    SELECT tag.id AS tagId
    FROM asset_tag
    INNER JOIN tag ON tag.id = asset_tag.tagId
    WHERE ${where.join(' AND ')}
  `).all(...params)
  if (rows.length === 0) return

  const placeholders = rows.map(() => '?').join(',')
  db.prepare(`
    DELETE FROM asset_tag
    WHERE assetId = ? AND tagId IN (${placeholders})
  `).run(assetId, ...rows.map((row) => row.tagId))
}

export function cleanupOrphanTags(db, source = null) {
  if (source) {
    db.prepare(`
      DELETE FROM tag
      WHERE source = ?
        AND id NOT IN (SELECT DISTINCT tagId FROM asset_tag)
    `).run(source)
    return
  }

  db.prepare(`
    DELETE FROM tag
    WHERE id NOT IN (SELECT DISTINCT tagId FROM asset_tag)
  `).run()
}

export function toEmbeddingBlob(values) {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIM) {
    throw new Error(`embedding length must be ${EMBEDDING_DIM}`)
  }
  const floatArray = new Float32Array(EMBEDDING_DIM)
  for (let i = 0; i < EMBEDDING_DIM; i += 1) {
    floatArray[i] = Number(values[i])
  }
  return Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength)
}

export function fromEmbeddingBlob(blob) {
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

export function choosePersonForFace(currentFaceId, currentEmbedding, allEmbeddings, maxDistance) {
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

export function refreshPersonCache(db) {
  const ts = nowTs()
  db.prepare(`
    UPDATE person
    SET faceCount = (
      SELECT COUNT(*)
      FROM person_face
      INNER JOIN face ON face.id = person_face.faceId
      INNER JOIN asset ON asset.id = face.assetId
      WHERE person_face.personId = person.id
        AND asset.deletedAt IS NULL
    ),
    updatedAt = ?
  `).run(ts)

  db.prepare(`
    UPDATE person
    SET featureFaceId = (
      SELECT face.id
      FROM person_face
      INNER JOIN face ON face.id = person_face.faceId
      INNER JOIN asset ON asset.id = face.assetId
      WHERE person_face.personId = person.id
        AND asset.deletedAt IS NULL
      ORDER BY person_face.assignedAt ASC
      LIMIT 1
    )
  `).run()
}

export function cleanupEmptyPeople(db) {
  db.prepare('DELETE FROM person WHERE id NOT IN (SELECT personId FROM person_face)').run()
}

export function updateFaceAssignmentStatus(db) {
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
      AND status NOT IN ('deferred', 'manual_unassigned', 'ignored')
  `).run(ts)
}

function toPersonLabel(personId, name) {
  const nextName = typeof name === 'string' ? name.trim() : ''
  if (nextName) return nextName
  return `人物 ${personId.slice(0, 8)}`
}

export function syncVisionFaceTags(db, assetIds = null) {
  let targetAssetIds = []
  if (Array.isArray(assetIds)) {
    targetAssetIds = [...new Set(assetIds.filter((item) => typeof item === 'string' && item))]
  } else {
    const rows = db.prepare(`
      SELECT DISTINCT assetId FROM face
      UNION
      SELECT DISTINCT asset_tag.assetId AS assetId
      FROM asset_tag
      INNER JOIN tag ON tag.id = asset_tag.tagId
      WHERE tag.source = ? AND tag.key = 'person'
    `).all(FACE_SOURCE)
    targetAssetIds = rows
      .map((row) => row.assetId)
      .filter((item) => typeof item === 'string' && item)
  }

  if (targetAssetIds.length === 0) return

  const appliedAt = nowTs()
  for (const assetId of targetAssetIds) {
    const desiredRows = db.prepare(`
      SELECT DISTINCT
        person.id AS personId,
        person.name AS personName
      FROM face
      INNER JOIN person_face ON person_face.faceId = face.id
      INNER JOIN person ON person.id = person_face.personId
      WHERE face.assetId = ?
    `).all(assetId)
    const desiredValues = new Set(
      desiredRows.map((row) => toPersonLabel(row.personId, row.personName))
    )

    const existingRows = db.prepare(`
      SELECT tag.id AS tagId
      FROM asset_tag
      INNER JOIN tag ON tag.id = asset_tag.tagId
      WHERE asset_tag.assetId = ?
        AND tag.source = ?
        AND tag.key = 'person'
    `).all(assetId, FACE_SOURCE)

    const desiredTagIds = new Set()
    for (const label of desiredValues) {
      const tagId = bindTagToAsset(db, {
        assetId,
        key: 'person',
        value: label,
        source: FACE_SOURCE,
        appliedAt,
        score: null,
      })
      desiredTagIds.add(tagId)
    }

    for (const row of existingRows) {
      if (desiredTagIds.has(row.tagId)) continue
      db.prepare('DELETE FROM asset_tag WHERE assetId = ? AND tagId = ?').run(assetId, row.tagId)
    }
  }

  cleanupOrphanTags(db, FACE_SOURCE)
}
