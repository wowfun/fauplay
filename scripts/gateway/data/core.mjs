import { execFile, execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TextDecoder, promisify } from 'node:util'

const DB_DIRNAME = '.fauplay'
const DB_FILENAME = 'faudb.v1.sqlite'
const SCHEMA_VERSION = 2
const EMBEDDING_DIM = 512
const SAMPLE_CHUNK_BYTES = 64 * 1024
const HASH_HEX_128_LENGTH = 32
const ES_SEARCH_MAX_BUFFER = 16 * 1024 * 1024
const DEFAULT_ES_INSTANCE_NAME = '1.5a'
const DEFAULT_ES_MAX_CANDIDATES = 500
const MIN_ES_MAX_CANDIDATES = 1
const MAX_ES_MAX_CANDIDATES = 5000
const LOCAL_DATA_CONFIG_PATH = path.resolve(process.cwd(), 'tools/mcp/local-data/config.json')
const LOCAL_DATA_CONFIG_LOCAL_PATH = path.resolve(process.cwd(), 'tools/mcp/local-data/config.local.json')
const ANNOTATION_SOURCE = 'meta.annotation'
const FACE_SOURCE = 'vision.face'
const CLASSIFY_SOURCE = 'ml.classify'
const UNANNOTATED_TAG_KEY = '__ANNOTATION_UNANNOTATED__'
const execFileAsync = promisify(execFile)

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

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolvePathWithinRoot(rootPath, relativePath) {
  const target = path.resolve(rootPath, ...relativePath.split('/'))
  const relative = path.relative(rootPath, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('relativePath escapes rootPath')
  }
  return target
}

function toRelativePathWithinRoot(rootPath, absolutePath) {
  const target = path.resolve(absolutePath)
  const relative = path.relative(rootPath, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }
  return relative.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

function readMappingPathField(mapping, primaryKey, fallbackKey) {
  if (!isObjectRecord(mapping)) return ''
  const primary = mapping[primaryKey]
  if (typeof primary === 'string' && primary.trim()) return primary
  if (fallbackKey) {
    const fallback = mapping[fallbackKey]
    if (typeof fallback === 'string' && fallback.trim()) return fallback
  }
  return ''
}

function parseInteger(value, defaultValue) {
  const next = Number(value)
  if (!Number.isFinite(next) || !Number.isInteger(next)) {
    return defaultValue
  }
  return next
}

function parseFiniteNumber(value, defaultValue = 0) {
  const next = Number(value)
  if (!Number.isFinite(next)) {
    return defaultValue
  }
  return next
}

function clampInt(value, min, max, defaultValue) {
  if (!Number.isInteger(value)) return defaultValue
  return Math.min(Math.max(value, min), max)
}

function asConfigObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }
  return input
}

function isSkippableFsError(error) {
  if (!error || typeof error !== 'object') return false
  const code = error.code
  return code === 'EIO'
    || code === 'EACCES'
    || code === 'EPERM'
    || code === 'ENOENT'
    || code === 'ENOTDIR'
    || code === 'EISDIR'
}

function toFileMtimeMs(statResult) {
  const value = Math.trunc(Number(statResult?.mtimeMs))
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function snapshotMatches(statResult, fileSizeBytes, fileMtimeMs) {
  if (!Number.isFinite(fileSizeBytes) || !Number.isFinite(fileMtimeMs)) {
    return false
  }
  return Number(statResult.size) === Number(fileSizeBytes)
    && toFileMtimeMs(statResult) === Number(fileMtimeMs)
}

async function readJsonFileSafe(filePath, required) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (!required && error && typeof error === 'object' && error.code === 'ENOENT') {
      return {}
    }
    throw new Error(`failed to load config: ${filePath}`)
  }
}

async function loadEsSearchConfig() {
  const baseConfig = asConfigObject(await readJsonFileSafe(LOCAL_DATA_CONFIG_PATH, true))
  const localConfig = asConfigObject(await readJsonFileSafe(LOCAL_DATA_CONFIG_LOCAL_PATH, false))
  const merged = { ...baseConfig, ...localConfig }

  if (typeof merged.esPath !== 'string' || !merged.esPath.trim()) {
    throw new Error('config.esPath is required')
  }

  return {
    esPath: merged.esPath.trim(),
    instanceName: typeof merged.instanceName === 'string' && merged.instanceName.trim()
      ? merged.instanceName.trim()
      : DEFAULT_ES_INSTANCE_NAME,
    maxCandidates: clampInt(
      Number(merged.maxCandidates),
      MIN_ES_MAX_CANDIDATES,
      MAX_ES_MAX_CANDIDATES,
      DEFAULT_ES_MAX_CANDIDATES
    ),
  }
}

function decodeEsOutputBuffer(buffer) {
  const utf8Text = buffer.toString('utf8')
  if (!utf8Text.includes('\uFFFD')) {
    return utf8Text
  }

  try {
    const gbkText = new TextDecoder('gbk').decode(buffer)
    const utf8ReplacementCount = (utf8Text.match(/\uFFFD/g) || []).length
    const gbkReplacementCount = (gbkText.match(/\uFFFD/g) || []).length
    return gbkReplacementCount <= utf8ReplacementCount ? gbkText : utf8Text
  } catch {
    return utf8Text
  }
}

function parseEsCandidateWindowsPaths(stdoutText) {
  const windowsPaths = []
  const lines = stdoutText.split(/\r?\n/)

  for (const line of lines) {
    if (!line.trim()) continue

    const matchWithSize = line.match(/^\s*[0-9,]+\s+"(.+)"\s*$/)
    if (matchWithSize && matchWithSize[1]) {
      windowsPaths.push(matchWithSize[1])
      continue
    }

    const matchPathOnly = line.match(/^\s*"(.+)"\s*$/)
    if (matchPathOnly && matchPathOnly[1]) {
      windowsPaths.push(matchPathOnly[1])
    }
  }

  return windowsPaths
}

async function toWindowsPath(targetPath) {
  if (isWindowsPath(targetPath)) return targetPath
  if (process.platform === 'win32') return targetPath
  const { stdout } = await execFileAsync('wslpath', ['-w', targetPath])
  return String(stdout).trim()
}

async function toUnixPath(targetPath) {
  if (!isWindowsPath(targetPath)) return targetPath
  if (process.platform === 'win32') return targetPath
  const { stdout } = await execFileAsync('wslpath', ['-u', targetPath])
  return String(stdout).trim()
}

async function searchCandidatesBySizeMtime(rootPath, snapshot, config) {
  const rootWindowsPath = await toWindowsPath(rootPath)

  const args = []
  if (config.instanceName) {
    args.push('-instance', config.instanceName)
  }
  args.push('-path', rootWindowsPath)
  args.push('file:')
  args.push(`size:${snapshot.fileSizeBytes}`)
  args.push('-double-quote')
  args.push('-n', String(config.maxCandidates))
  args.push('-size')

  const result = await execFileAsync(config.esPath, args, {
    encoding: 'buffer',
    maxBuffer: ES_SEARCH_MAX_BUFFER,
  })

  const stdoutBuffer = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(String(result.stdout || ''), 'utf8')
  const stdoutText = decodeEsOutputBuffer(stdoutBuffer)
  const windowsPaths = parseEsCandidateWindowsPaths(stdoutText)

  const deduped = new Map()
  for (const windowsPath of windowsPaths) {
    let unixPath = ''
    try {
      unixPath = await toUnixPath(windowsPath)
    } catch {
      continue
    }

    const relativePath = toRelativePathWithinRoot(rootPath, unixPath)
    if (!relativePath) continue

    let candidateStat = null
    try {
      const absPath = resolvePathWithinRoot(rootPath, relativePath)
      candidateStat = await fs.stat(absPath)
    } catch (error) {
      if (isSkippableFsError(error)) continue
      throw error
    }

    if (!candidateStat || !candidateStat.isFile()) continue
    if (!snapshotMatches(candidateStat, snapshot.fileSizeBytes, snapshot.fileMtimeMs)) continue

    deduped.set(relativePath, {
      relativePath,
      stat: candidateStat,
    })
  }

  return [...deduped.values()]
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
  const appliedAt = Number(row.appliedAt ?? row.updatedAt ?? 0)
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    source: row.source,
    appliedAt,
    // Backward-compatible alias for older consumers.
    updatedAt: appliedAt,
    score: row.score === null || typeof row.score === 'undefined' ? null : Number(row.score),
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

function createSchemaV2(db) {
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

    CREATE TABLE IF NOT EXISTS tag (
      id TEXT NOT NULL UNIQUE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY(key, value, source)
    );

    CREATE TABLE IF NOT EXISTS file_tag (
      fileId TEXT NOT NULL,
      tagId TEXT NOT NULL,
      appliedAt INTEGER NOT NULL,
      score REAL,
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

    CREATE INDEX IF NOT EXISTS idx_file_relative_path ON file(relativePath);
    CREATE INDEX IF NOT EXISTS idx_tag_source_key_value ON tag(source, key, value);
    CREATE INDEX IF NOT EXISTS idx_file_tag_tag_id ON file_tag(tagId);
    CREATE INDEX IF NOT EXISTS idx_file_tag_applied_at ON file_tag(appliedAt);
    CREATE INDEX IF NOT EXISTS idx_face_file_id ON face(fileId);
    CREATE INDEX IF NOT EXISTS idx_face_status ON face(status);
    CREATE INDEX IF NOT EXISTS idx_person_face_person_id ON person_face(personId);
  `)
}

function ensureSchema(db) {
  const row = db.prepare('PRAGMA user_version').get()
  const currentVersion = Number(row?.user_version ?? 0)
  if (currentVersion !== 0 && currentVersion !== SCHEMA_VERSION) {
    rebuildSchema(db)
  }
  createSchemaV2(db)
  if (currentVersion !== SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
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

function upsertFileTagBinding(db, { fileId, tagId, appliedAt = nowTs(), score = null }) {
  const normalizedScore = score === null || typeof score === 'undefined'
    ? null
    : parseFiniteNumber(score, 0)
  db.prepare(`
    INSERT INTO file_tag(fileId, tagId, appliedAt, score)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(fileId, tagId) DO UPDATE SET
      appliedAt = excluded.appliedAt,
      score = excluded.score
  `).run(fileId, tagId, appliedAt, normalizedScore)
}

function bindTagToFile(db, { fileId, key, value, source, appliedAt = nowTs(), score = null }) {
  if (!fileId) {
    throw new Error('invalid fileId')
  }
  const tagId = getOrCreateTagId(db, { key, value, source })
  upsertFileTagBinding(db, { fileId, tagId, appliedAt, score })
  return tagId
}

function removeTagBindingsForFile(db, { fileId, source = null, key = null }) {
  if (!fileId) return

  const where = ['file_tag.fileId = ?']
  const params = [fileId]
  if (source) {
    where.push('tag.source = ?')
    params.push(source)
  }
  if (key) {
    where.push('tag.key = ?')
    params.push(key)
  }

  const rows = db.prepare(`
    SELECT tag.id AS tagId
    FROM file_tag
    INNER JOIN tag ON tag.id = file_tag.tagId
    WHERE ${where.join(' AND ')}
  `).all(...params)
  if (rows.length === 0) return

  const placeholders = rows.map(() => '?').join(',')
  db.prepare(`
    DELETE FROM file_tag
    WHERE fileId = ? AND tagId IN (${placeholders})
  `).run(fileId, ...rows.map((row) => row.tagId))
}

function cleanupOrphanTags(db, source = null) {
  if (source) {
    db.prepare(`
      DELETE FROM tag
      WHERE source = ?
        AND id NOT IN (SELECT DISTINCT tagId FROM file_tag)
    `).run(source)
    return
  }

  db.prepare(`
    DELETE FROM tag
    WHERE id NOT IN (SELECT DISTINCT tagId FROM file_tag)
  `).run()
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

function syncVisionFaceTags(db, fileIds = null) {
  let targetFileIds = []
  if (Array.isArray(fileIds)) {
    targetFileIds = [...new Set(fileIds.filter((item) => typeof item === 'string' && item))]
  } else {
    const rows = db.prepare(`
      SELECT DISTINCT fileId
      FROM face
      UNION
      SELECT DISTINCT file_tag.fileId AS fileId
      FROM file_tag
      INNER JOIN tag ON tag.id = file_tag.tagId
      WHERE tag.source = ? AND tag.key = 'person'
    `).all(FACE_SOURCE)
    targetFileIds = rows
      .map((row) => row.fileId)
      .filter((item) => typeof item === 'string' && item)
  }

  if (targetFileIds.length === 0) return

  const appliedAt = nowTs()
  for (const fileId of targetFileIds) {
    const desiredRows = db.prepare(`
      SELECT DISTINCT
        person.id AS personId,
        person.name AS personName
      FROM face
      INNER JOIN person_face ON person_face.faceId = face.id
      INNER JOIN person ON person.id = person_face.personId
      WHERE face.fileId = ?
    `).all(fileId)
    const desiredValues = new Set(
      desiredRows.map((row) => toPersonLabel(row.personId, row.personName)),
    )

    const existingRows = db.prepare(`
      SELECT tag.id AS tagId
      FROM file_tag
      INNER JOIN tag ON tag.id = file_tag.tagId
      WHERE file_tag.fileId = ?
        AND tag.source = ?
        AND tag.key = 'person'
    `).all(fileId, FACE_SOURCE)

    const desiredTagIds = new Set()
    for (const label of desiredValues) {
      const tagId = bindTagToFile(db, {
        fileId,
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
      db.prepare('DELETE FROM file_tag WHERE fileId = ? AND tagId = ?').run(fileId, row.tagId)
    }
  }

  cleanupOrphanTags(db, FACE_SOURCE)
}

async function evaluateFileBindingRows(db, rootPath, { applyRebind }) {
  const rows = db.prepare(`
    SELECT
      id AS fileId,
      relativePath,
      fileSizeBytes,
      fileMtimeMs,
      bindingFp
    FROM file
    ORDER BY relativePath ASC
  `).all()

  let cachedSearchConfig = null
  let searchConfigLoadFailed = false
  const ensureSearchConfig = async () => {
    if (searchConfigLoadFailed) return null
    if (cachedSearchConfig) return cachedSearchConfig
    try {
      cachedSearchConfig = await loadEsSearchConfig()
      return cachedSearchConfig
    } catch {
      searchConfigLoadFailed = true
      return null
    }
  }

  const items = []
  let active = 0
  let rebound = 0
  let conflict = 0
  let orphan = 0
  let searchUnavailable = 0
  const timestamp = nowTs()

  for (const row of rows) {
    const item = {
      fileId: row.fileId,
      relativePath: row.relativePath,
      status: 'active',
      reason: null,
      rebound: false,
      resolvedRelativePath: row.relativePath,
    }

    let previousStat = null
    try {
      const previousAbsPath = resolvePathWithinRoot(rootPath, row.relativePath)
      const statResult = await fs.stat(previousAbsPath)
      if (statResult.isFile()) {
        previousStat = statResult
      }
    } catch (error) {
      if (!isSkippableFsError(error)) {
        throw error
      }
    }

    if (previousStat && snapshotMatches(previousStat, row.fileSizeBytes, row.fileMtimeMs)) {
      active += 1
      items.push(item)
      continue
    }

    const recordedSize = Number.isFinite(Number(row.fileSizeBytes))
      ? Math.trunc(Number(row.fileSizeBytes))
      : null
    const recordedMtime = Number.isFinite(Number(row.fileMtimeMs))
      ? Math.trunc(Number(row.fileMtimeMs))
      : null
    const originalBinding = typeof row.bindingFp === 'string' ? row.bindingFp : ''

    if (recordedSize === null || recordedMtime === null || !originalBinding) {
      item.status = 'orphan'
      item.reason = 'no_candidate'
      orphan += 1
      items.push(item)
      continue
    }

    const searchConfig = await ensureSearchConfig()
    if (!searchConfig) {
      item.status = 'orphan'
      item.reason = 'search_unavailable'
      orphan += 1
      searchUnavailable += 1
      items.push(item)
      continue
    }

    let candidates = []
    try {
      candidates = await searchCandidatesBySizeMtime(rootPath, {
        fileSizeBytes: recordedSize,
        fileMtimeMs: recordedMtime,
      }, searchConfig)
    } catch {
      item.status = 'orphan'
      item.reason = 'search_unavailable'
      orphan += 1
      searchUnavailable += 1
      items.push(item)
      continue
    }

    const matchedCandidates = []
    for (const candidate of candidates) {
      try {
        const candidateAbsPath = resolvePathWithinRoot(rootPath, candidate.relativePath)
        const candidateFingerprints = await computeFingerprintsForFile(candidateAbsPath, candidate.relativePath, {
          exactEnabled: false,
          similarImageEnabled: false,
        }, candidate.stat)

        if (candidateFingerprints.bindingFp === originalBinding) {
          matchedCandidates.push(candidate)
        }
      } catch (error) {
        if (isSkippableFsError(error)) continue
        throw error
      }
    }

    if (matchedCandidates.length === 1) {
      const [matched] = matchedCandidates
      const occupier = db.prepare('SELECT id FROM file WHERE relativePath = ?').get(matched.relativePath)
      if (occupier?.id && occupier.id !== row.fileId) {
        item.status = 'conflict'
        item.reason = 'ambiguous_rebind'
        conflict += 1
        items.push(item)
        continue
      }

      item.resolvedRelativePath = matched.relativePath
      item.rebound = matched.relativePath !== row.relativePath
      if (item.rebound) {
        rebound += 1
      }
      active += 1
      items.push(item)

      if (applyRebind) {
        db.prepare(`
          UPDATE file
          SET
            relativePath = ?,
            fileSizeBytes = ?,
            fileMtimeMs = ?,
            bindingFp = ?,
            updatedAt = ?
          WHERE id = ?
        `).run(
          matched.relativePath,
          Number(matched.stat.size),
          toFileMtimeMs(matched.stat),
          originalBinding,
          timestamp,
          row.fileId,
        )
      }
      continue
    }

    if (matchedCandidates.length > 1) {
      item.status = 'conflict'
      item.reason = 'ambiguous_rebind'
      conflict += 1
      items.push(item)
      continue
    }

    item.status = 'orphan'
    item.reason = 'no_candidate'
    orphan += 1
    items.push(item)
  }

  return {
    ok: true,
    total: rows.length,
    active,
    rebound,
    conflict,
    orphan,
    searchUnavailable,
    items,
  }
}

function countRows(db, sql, params = []) {
  return Number(db.prepare(sql).get(...params)?.count ?? 0)
}

function estimateCleanupImpact(db, targetFileIds) {
  if (!Array.isArray(targetFileIds) || targetFileIds.length === 0) {
    return {
      file: 0,
      fileTag: 0,
      face: 0,
      faceEmbedding: 0,
      personFace: 0,
      person: 0,
      tag: 0,
    }
  }

  const placeholders = targetFileIds.map(() => '?').join(',')
  const duplicateParams = [...targetFileIds, ...targetFileIds]

  return {
    file: targetFileIds.length,
    fileTag: countRows(
      db,
      `SELECT COUNT(*) AS count FROM file_tag WHERE fileId IN (${placeholders})`,
      targetFileIds,
    ),
    face: countRows(
      db,
      `SELECT COUNT(*) AS count FROM face WHERE fileId IN (${placeholders})`,
      targetFileIds,
    ),
    faceEmbedding: countRows(
      db,
      `SELECT COUNT(*) AS count FROM face_embedding WHERE faceId IN (
        SELECT id FROM face WHERE fileId IN (${placeholders})
      )`,
      targetFileIds,
    ),
    personFace: countRows(
      db,
      `SELECT COUNT(*) AS count FROM person_face WHERE faceId IN (
        SELECT id FROM face WHERE fileId IN (${placeholders})
      )`,
      targetFileIds,
    ),
    person: countRows(
      db,
      `SELECT COUNT(*) AS count
       FROM person
       WHERE id IN (
         SELECT DISTINCT person_face.personId
         FROM person_face
         INNER JOIN face ON face.id = person_face.faceId
         WHERE face.fileId IN (${placeholders})
       )
       AND id NOT IN (
         SELECT DISTINCT person_face.personId
         FROM person_face
         INNER JOIN face ON face.id = person_face.faceId
         WHERE face.fileId NOT IN (${placeholders})
       )`,
      duplicateParams,
    ),
    tag: countRows(
      db,
      `SELECT COUNT(*) AS count
       FROM tag
       WHERE id IN (
         SELECT DISTINCT tagId FROM file_tag WHERE fileId IN (${placeholders})
       )
       AND id NOT IN (
         SELECT DISTINCT tagId FROM file_tag WHERE fileId NOT IN (${placeholders})
       )`,
      duplicateParams,
    ),
  }
}

function batchUpdateRelativePaths(tx, mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { updated: 0 }
  }

  const ts = nowTs()
  const stagedMappings = mappings.map((mapping) => ({
    ...mapping,
    tempRelativePath: `__fauplay_rebind_tmp__/${randomUUID()}`,
  }))

  for (const mapping of stagedMappings) {
    tx.prepare(`
      UPDATE file
      SET relativePath = ?, updatedAt = ?
      WHERE id = ?
    `).run(mapping.tempRelativePath, ts, mapping.fileId)
  }

  for (const mapping of stagedMappings) {
    tx.prepare(`
      UPDATE file
      SET relativePath = ?, updatedAt = ?
      WHERE id = ?
    `).run(mapping.toRelativePath, ts, mapping.fileId)
  }

  return { updated: stagedMappings.length }
}

export async function batchRebindPaths(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const inputMappings = Array.isArray(params.mappings) ? params.mappings : null
  if (!inputMappings) {
    throw new Error('mappings must be an array')
  }

  return withDb(rootPath, async (db) => (
    withTransaction(db, async () => {
      const items = inputMappings.map((mapping, index) => ({
        index,
        fromRelativePath: '',
        toRelativePath: '',
        fileId: null,
        ok: false,
        skipped: false,
        reasonCode: null,
        error: null,
      }))

      const sourceUseMap = new Map()
      const targetUseMap = new Map()

      for (let i = 0; i < inputMappings.length; i += 1) {
        const item = items[i]
        const mapping = inputMappings[i]
        const rawFrom = readMappingPathField(mapping, 'fromRelativePath', 'relativePath')
        const rawTo = readMappingPathField(mapping, 'toRelativePath', 'nextRelativePath')

        if (!rawFrom) {
          item.reasonCode = 'INVALID_SOURCE_PATH'
          item.error = 'fromRelativePath is required'
          continue
        }

        if (!rawTo) {
          item.reasonCode = 'INVALID_TARGET_PATH'
          item.error = 'toRelativePath is required'
          continue
        }

        try {
          item.fromRelativePath = normalizeRelativePath(rawFrom, 'fromRelativePath')
        } catch (error) {
          item.reasonCode = 'INVALID_SOURCE_PATH'
          item.error = error instanceof Error ? error.message : 'invalid fromRelativePath'
          continue
        }

        try {
          item.toRelativePath = normalizeRelativePath(rawTo, 'toRelativePath')
        } catch (error) {
          item.reasonCode = 'INVALID_TARGET_PATH'
          item.error = error instanceof Error ? error.message : 'invalid toRelativePath'
          continue
        }

        if (item.fromRelativePath === item.toRelativePath) {
          item.ok = true
          item.skipped = true
          item.reasonCode = 'NO_CHANGE'
          continue
        }

        if (sourceUseMap.has(item.fromRelativePath)) {
          item.reasonCode = 'DUPLICATE_SOURCE'
          item.error = 'duplicate fromRelativePath in mappings'
          continue
        }
        sourceUseMap.set(item.fromRelativePath, i)

        if (targetUseMap.has(item.toRelativePath)) {
          item.reasonCode = 'DUPLICATE_TARGET'
          item.error = 'duplicate toRelativePath in mappings'
          continue
        }
        targetUseMap.set(item.toRelativePath, i)
      }

      const validSourcePaths = items
        .filter((item) => !item.reasonCode && item.skipped !== true)
        .map((item) => item.fromRelativePath)
      const validTargetPaths = items
        .filter((item) => !item.reasonCode && item.skipped !== true)
        .map((item) => item.toRelativePath)

      const sourceRows = validSourcePaths.length > 0
        ? db.prepare(`
          SELECT id, relativePath
          FROM file
          WHERE relativePath IN (${validSourcePaths.map(() => '?').join(',')})
        `).all(...validSourcePaths)
        : []
      const sourceByPath = new Map(sourceRows.map((row) => [row.relativePath, row]))

      const targetRows = validTargetPaths.length > 0
        ? db.prepare(`
          SELECT id, relativePath
          FROM file
          WHERE relativePath IN (${validTargetPaths.map(() => '?').join(',')})
        `).all(...validTargetPaths)
        : []
      const targetByPath = new Map(targetRows.map((row) => [row.relativePath, row]))
      const movingFileIdSet = new Set(sourceRows.map((row) => row.id))

      const executableMappings = []

      for (const item of items) {
        if (item.reasonCode || item.skipped === true) continue

        const sourceRow = sourceByPath.get(item.fromRelativePath)
        if (!sourceRow) {
          item.reasonCode = 'SOURCE_NOT_FOUND'
          item.error = 'source file entry not found'
          continue
        }

        const targetRow = targetByPath.get(item.toRelativePath)
        if (targetRow && !movingFileIdSet.has(targetRow.id)) {
          item.reasonCode = 'TARGET_OCCUPIED'
          item.error = 'target path is occupied by another file entry'
          continue
        }

        item.fileId = sourceRow.id
        executableMappings.push({
          fileId: sourceRow.id,
          fromRelativePath: item.fromRelativePath,
          toRelativePath: item.toRelativePath,
        })
      }

      if (executableMappings.length > 0) {
        batchUpdateRelativePaths(db, executableMappings)
      }

      let updated = 0
      let skipped = 0
      let failed = 0

      for (const item of items) {
        if (item.reasonCode) {
          if (item.reasonCode === 'NO_CHANGE') {
            skipped += 1
            continue
          }
          failed += 1
          continue
        }

        if (item.skipped) {
          skipped += 1
          continue
        }

        item.ok = true
        updated += 1
      }

      return {
        ok: true,
        total: items.length,
        updated,
        skipped,
        failed,
        items: items.map((item) => ({
          fromRelativePath: item.fromRelativePath,
          toRelativePath: item.toRelativePath,
          fileId: item.fileId,
          ok: item.ok,
          skipped: item.skipped || undefined,
          reasonCode: item.reasonCode || undefined,
          error: item.error || undefined,
        })),
      }
    })
  ))
}

export async function reconcileFileBindings(params) {
  const rootPath = resolveRootPath(params.rootPath)
  return withDb(rootPath, async (db) => (
    withTransaction(db, async () => evaluateFileBindingRows(db, rootPath, { applyRebind: true }))
  ))
}

export async function refreshFileBindings(params) {
  return reconcileFileBindings(params)
}

export async function cleanupInvalidFileIds(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const confirm = params.confirm === true

  return withDb(rootPath, async (db) => (
    withTransaction(db, async () => {
      const refreshResult = await evaluateFileBindingRows(db, rootPath, { applyRebind: false })
      const invalidItems = refreshResult.items.filter((item) => item.status !== 'active')
      const invalidFileIds = [...new Set(invalidItems.map((item) => item.fileId))]
      const impact = estimateCleanupImpact(db, invalidFileIds)

      if (!confirm || invalidFileIds.length === 0) {
        return {
          ok: true,
          dryRun: !confirm,
          invalidFileIds,
          impact,
          removed: 0,
        }
      }

      const placeholders = invalidFileIds.map(() => '?').join(',')
      const cursor = db.prepare(`DELETE FROM file WHERE id IN (${placeholders})`).run(...invalidFileIds)
      const removed = Number(cursor?.changes ?? 0)

      db.prepare('DELETE FROM person WHERE id NOT IN (SELECT personId FROM person_face)').run()
      refreshPersonCache(db)
      updateFaceAssignmentStatus(db)
      syncVisionFaceTags(db)
      cleanupOrphanTags(db)

      return {
        ok: true,
        dryRun: false,
        invalidFileIds,
        impact,
        removed,
      }
    })
  ))
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
      const appliedAt = nowTs()

      // Enforce overwrite semantics by file + field key.
      removeTagBindingsForFile(db, {
        fileId: file.id,
        source: ANNOTATION_SOURCE,
        key: fieldKey,
      })
      cleanupOrphanTags(db, ANNOTATION_SOURCE)

      bindTagToFile(db, {
        fileId: file.id,
        key: fieldKey,
        value,
        source: ANNOTATION_SOURCE,
        appliedAt,
        score: null,
      })

      return {
        ok: true,
        fileId: file.id,
        relativePath,
        fieldKey,
        value,
        source,
      }
    })
  ))
}

export async function setLocalDataValue(params) {
  return setAnnotationValue(params)
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
      SELECT
        tag.id AS id,
        tag.key AS key,
        tag.value AS value,
        tag.source AS source,
        file_tag.appliedAt AS appliedAt,
        file_tag.score AS score
      FROM file_tag
      INNER JOIN tag ON tag.id = file_tag.tagId
      WHERE file_tag.fileId = ?
      ORDER BY file_tag.appliedAt DESC, tag.source ASC, tag.key ASC, tag.value ASC
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
        tag.source AS source,
        COUNT(DISTINCT file_tag.fileId) AS fileCount
      FROM tag
      INNER JOIN file_tag ON file_tag.tagId = tag.id
      GROUP BY tag.source, tag.key, tag.value
      ORDER BY tag.source ASC, tag.key ASC, tag.value ASC
    `).all()

    return {
      ok: true,
      items: rows.map((row) => ({
        tagKey: buildTagKey(row.key, row.value),
        key: row.key,
        value: row.value,
        source: row.source,
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
        file_tag.appliedAt AS appliedAt,
        file_tag.score AS score
      FROM file
      LEFT JOIN file_tag ON file_tag.fileId = file.id
      LEFT JOIN tag ON tag.id = file_tag.tagId
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
        if (dto.source === ANNOTATION_SOURCE) {
          existing.updatedAt = Math.max(existing.updatedAt, Number(dto.appliedAt ?? dto.updatedAt ?? 0))
        }
      }
      byFile.set(fileId, existing)
    }

    const filtered = []
    for (const item of byFile.values()) {
      const annotationTagKeys = item.tags
        .filter((tag) => tag.source === ANNOTATION_SOURCE)
        .map((tag) => buildTagKey(tag.key, tag.value))
      if (!matchesTagFilter(annotationTagKeys, includeTagKeys, excludeTagKeys, includeMatchMode)) {
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
      syncVisionFaceTags(db, [file.id])

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
      const touchedFileIds = new Set()

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

          for (const item of allEmbeddings) {
            if (item.faceId === faceId) {
              item.personId = personId
              break
            }
          }

          touchedFileIds.add(row.fileId)
          assigned += 1
        } else {
          const ts = nowTs()
          db.prepare(`
            UPDATE face
            SET status = 'deferred', updatedAt = ?
            WHERE id = ?
          `).run(ts, faceId)
          touchedFileIds.add(row.fileId)
          deferred += 1
        }
      }

      updateFaceAssignmentStatus(db)
      refreshPersonCache(db)
      if (touchedFileIds.size > 0) {
        syncVisionFaceTags(db, [...touchedFileIds])
      }

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

      const fileRows = db.prepare(`
        SELECT DISTINCT face.fileId AS fileId
        FROM face
        INNER JOIN person_face ON person_face.faceId = face.id
        WHERE person_face.personId = ?
      `).all(personId)
      syncVisionFaceTags(db, fileRows.map((row) => row.fileId))

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
      const touchedFileIds = new Set()

      for (const sourceId of validSources) {
        const sourceExists = db.prepare('SELECT 1 AS ok FROM person WHERE id = ?').get(sourceId)
        if (!sourceExists) {
          skipped.push(sourceId)
          continue
        }

        const sourceFaceRows = db.prepare(`
          SELECT person_face.faceId AS faceId, face.fileId AS fileId
          FROM person_face
          INNER JOIN face ON face.id = person_face.faceId
          WHERE personId = ?
        `).all(sourceId)

        db.prepare(`
          UPDATE person_face
          SET personId = ?, assignedBy = 'merge', assignedAt = ?
          WHERE personId = ?
        `).run(targetPersonId, ts, sourceId)

        db.prepare('DELETE FROM person WHERE id = ?').run(sourceId)
        merged.push(sourceId)
        for (const row of sourceFaceRows) {
          touchedFileIds.add(row.fileId)
        }
      }

      updateFaceAssignmentStatus(db)
      refreshPersonCache(db)
      if (touchedFileIds.size > 0) {
        syncVisionFaceTags(db, [...touchedFileIds])
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

        removeTagBindingsForFile(db, {
          fileId: file.id,
          source: CLASSIFY_SOURCE,
          key: 'class',
        })
        cleanupOrphanTags(db, CLASSIFY_SOURCE)

        const scoreByLabel = new Map()
        for (const prediction of task.predictions) {
          if (!prediction || typeof prediction !== 'object') continue
          const label = typeof prediction.label === 'string' ? prediction.label.trim() : ''
          if (!label) continue
          const score = parseFiniteNumber(prediction.score, 0)
          const prev = scoreByLabel.get(label)
          if (typeof prev !== 'number' || score > prev) {
            scoreByLabel.set(label, score)
          }
        }

        const appliedAt = nowTs()
        for (const [label, score] of scoreByLabel.entries()) {
          bindTagToFile(db, {
            fileId: file.id,
            key: 'class',
            value: label,
            source: CLASSIFY_SOURCE,
            appliedAt,
            score,
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
