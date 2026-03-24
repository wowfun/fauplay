import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  nowTs,
  resolveRootPath,
  resolveOptionalRootPath,
  normalizeRelativePath,
  toDisplayPath,
  parseInteger,
  parseFiniteNumber,
  buildPathScopeClause,
} from './common.mjs'
import {
  withDb,
  withTransaction,
  ensureFileEntry,
  getAssetById,
  resolveFileByRootRelativePath,
  toEmbeddingBlob,
  fromEmbeddingBlob,
  choosePersonForFace,
  refreshPersonCache,
  cleanupEmptyPeople,
  updateFaceAssignmentStatus,
  syncVisionFaceTags,
} from './storage.mjs'

const execFileAsync = promisify(execFile)
const FACE_CROP_SCRIPT_PATH = path.resolve(process.cwd(), 'scripts', 'gateway', 'face_crop.py')
const FACE_CROP_SIZE_DEFAULT = 160
const FACE_CROP_SIZE_MIN = 48
const FACE_CROP_SIZE_MAX = 512
const FACE_CROP_PADDING_DEFAULT = 0.35
const FACE_CROP_PADDING_MIN = 0
const FACE_CROP_PADDING_MAX = 2
const FACE_CROP_MAX_BUFFER = 8 * 1024 * 1024
const FACE_ERROR_STATUS_CODES = {
  FACE_NOT_FOUND: 404,
  PERSON_NOT_FOUND: 404,
  FACE_ALREADY_ASSIGNED_TO_TARGET: 409,
  FACE_ALREADY_IGNORED: 409,
  FACE_STATE_CONFLICT: 409,
}

function representativeFilePathSubquery() {
  return `
    SELECT assetId, MIN(absolutePath) AS absolutePath
    FROM file
    GROUP BY assetId
  `
}

function parsePeopleScope(params) {
  const rawScope = typeof params?.scope === 'string' ? params.scope.trim() : 'global'
  if (rawScope !== 'global' && rawScope !== 'root') {
    throw new Error('scope must be "global" or "root"')
  }

  const displayRootPath = resolveOptionalRootPath(params?.rootPath)
  const scopedRootPath = rawScope === 'root'
    ? resolveRootPath(params?.rootPath)
    : null

  return {
    scope: rawScope,
    displayRootPath,
    scopedRootPath,
  }
}

function normalizeFaceIds(value) {
  const items = Array.isArray(value)
    ? value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : []

  const deduped = [...new Set(items)]
  if (deduped.length === 0) {
    throw new Error('faceIds must contain at least one faceId')
  }
  return deduped
}

function createFaceError(code, message) {
  const error = new Error(message)
  error.code = code
  error.statusCode = FACE_ERROR_STATUS_CODES[code] ?? 500
  return error
}

function buildAssetScopeExistsClause(assetIdColumn, rootPath) {
  if (!rootPath) {
    return {
      sql: '1 = 1',
      params: [],
    }
  }

  const scopeClause = buildPathScopeClause('file.absolutePath', rootPath)
  return {
    sql: `EXISTS (
      SELECT 1
      FROM file
      WHERE file.assetId = ${assetIdColumn}
        AND ${scopeClause.sql}
    )`,
    params: scopeClause.params,
  }
}

function buildRepresentativeFilePathExpression(assetIdColumn, rootPath) {
  if (!rootPath) {
    return {
      sql: `(SELECT MIN(file.absolutePath) FROM file WHERE file.assetId = ${assetIdColumn})`,
      params: [],
    }
  }

  const scopeClause = buildPathScopeClause('file.absolutePath', rootPath)
  return {
    sql: `(SELECT MIN(file.absolutePath) FROM file WHERE file.assetId = ${assetIdColumn} AND ${scopeClause.sql})`,
    params: scopeClause.params,
  }
}

function toDisplayPersonName(personId, name) {
  const normalizedName = typeof name === 'string' ? name.trim() : ''
  if (normalizedName) return normalizedName
  return `人物 ${String(personId || '').slice(0, 8)}`
}

function toFaceDto(row, displayRootPath, assetPathOverride = null) {
  const assetPath = assetPathOverride
    || (typeof row.displayAbsolutePath === 'string' ? toDisplayPath(displayRootPath, row.displayAbsolutePath) : null)
    || (typeof row.absolutePath === 'string' ? toDisplayPath(displayRootPath, row.absolutePath) : null)
    || null
  const personId = typeof row.personId === 'string' && row.personId ? row.personId : null

  return {
    faceId: row.id,
    assetId: row.assetId,
    assetPath,
    boundingBox: {
      x1: Number(row.x1),
      y1: Number(row.y1),
      x2: Number(row.x2),
      y2: Number(row.y2),
    },
    score: Number(row.score ?? 0),
    status: typeof row.status === 'string' ? row.status : 'unassigned',
    personId,
    personName: personId ? toDisplayPersonName(personId, row.personName) : null,
    assignedBy: typeof row.assignedBy === 'string' ? row.assignedBy : null,
    updatedAt: Number(row.updatedAt ?? 0),
  }
}

function buildMutationFailure(faceId, row, reasonCode, error) {
  return {
    faceId,
    ok: false,
    previousStatus: row?.status ?? null,
    previousPersonId: row?.personId ?? null,
    nextStatus: row?.status ?? null,
    nextPersonId: row?.personId ?? null,
    reasonCode,
    error,
  }
}

function buildMutationSuccess(faceId, row, nextStatus, nextPersonId = null) {
  return {
    faceId,
    ok: true,
    previousStatus: row?.status ?? null,
    previousPersonId: row?.personId ?? null,
    nextStatus,
    nextPersonId,
    reasonCode: null,
    error: null,
  }
}

function summarizeMutation(action, items, extra = {}) {
  const succeeded = items.filter((item) => item.ok).length
  return {
    ok: true,
    action,
    total: items.length,
    succeeded,
    failed: items.length - succeeded,
    items,
    ...extra,
  }
}

function mapFaceRowsById(rows) {
  const map = new Map()
  for (const row of rows) {
    map.set(row.faceId, row)
  }
  return map
}

function getFaceRowsByIds(db, faceIds) {
  const placeholders = faceIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT
      face.id AS faceId,
      face.assetId AS assetId,
      face.status AS status,
      person_face.personId AS personId,
      person_face.assignedBy AS assignedBy,
      person.name AS personName
    FROM face
    INNER JOIN asset ON asset.id = face.assetId
    LEFT JOIN person_face ON person_face.faceId = face.id
    LEFT JOIN person ON person.id = person_face.personId
    WHERE face.id IN (${placeholders})
      AND asset.deletedAt IS NULL
  `).all(...faceIds)
  return mapFaceRowsById(rows)
}

function upsertFaceAssignment(db, faceId, personId, assignedBy) {
  const ts = nowTs()
  db.prepare(`
    INSERT INTO person_face(personId, faceId, assignedBy, assignedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(faceId) DO UPDATE SET
      personId = excluded.personId,
      assignedBy = excluded.assignedBy,
      assignedAt = excluded.assignedAt
  `).run(personId, faceId, assignedBy, ts)

  db.prepare(`
    UPDATE face
    SET status = 'assigned', updatedAt = ?
    WHERE id = ?
  `).run(ts, faceId)
}

function clearFaceAssignment(db, faceId) {
  db.prepare('DELETE FROM person_face WHERE faceId = ?').run(faceId)
}

function updateFaceStatus(db, faceId, status) {
  db.prepare(`
    UPDATE face
    SET status = ?, updatedAt = ?
    WHERE id = ?
  `).run(status, nowTs(), faceId)
}

function finalizeFaceMutation(db, touchedAssetIds) {
  updateFaceAssignmentStatus(db)
  refreshPersonCache(db)
  cleanupEmptyPeople(db)
  if (touchedAssetIds.size > 0) {
    syncVisionFaceTags(db, [...touchedAssetIds])
  }
}

function pickCandidateAbsolutePath(row) {
  if (typeof row.preferredAbsolutePath === 'string' && row.preferredAbsolutePath) {
    return row.preferredAbsolutePath
  }
  if (typeof row.absolutePath === 'string' && row.absolutePath) {
    return row.absolutePath
  }
  return null
}

function resolveCropPythonBinary() {
  const venvPython = path.resolve(process.cwd(), '.venv', 'bin', 'python')
  if (existsSync(venvPython)) {
    return venvPython
  }
  return 'python3'
}

export async function saveDetectedFaces(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const relativePath = normalizeRelativePath(params.relativePath, 'relativePath')
  const facePayloads = Array.isArray(params.facePayloads) ? params.facePayloads : []

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const file = await ensureFileEntry(db, rootPath, relativePath)
      const ts = nowTs()

      const existingRows = db.prepare('SELECT id FROM face WHERE assetId = ?').all(file.assetId)
      const existingFaceIds = existingRows.map((row) => row.id)
      if (existingFaceIds.length > 0) {
        const placeholders = existingFaceIds.map(() => '?').join(',')
        db.prepare(`
          UPDATE person
          SET featureFaceId = NULL
          WHERE featureFaceId IN (${placeholders})
        `).run(...existingFaceIds)
      }

      db.prepare('DELETE FROM face WHERE assetId = ?').run(file.assetId)

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
          INSERT INTO face(id, assetId, x1, y1, x2, y2, score, status, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'unassigned', ?, ?)
        `).run(faceId, file.assetId, x1, y1, x2, y2, score, ts, ts)

        db.prepare(`
          INSERT INTO face_embedding(faceId, dim, embedding)
          VALUES (?, ?, ?)
        `).run(faceId, 512, embeddingBlob)

        createdFaces.push({
          faceId,
          assetPath: relativePath,
          score,
          boundingBox: { x1, y1, x2, y2 },
          personId: null,
          personName: null,
          assignedBy: null,
          status: 'unassigned',
          updatedAt: ts,
        })
      }

      cleanupEmptyPeople(db)
      updateFaceAssignmentStatus(db)
      refreshPersonCache(db)
      syncVisionFaceTags(db, [file.assetId])

      return {
        ok: true,
        assetId: file.assetId,
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
  const limit = Math.min(2000, Math.max(1, parseInteger(params.limit, 100)))
  const maxDistance = parseFiniteNumber(params.maxDistance, 0.5)
  const minFaces = Math.max(1, parseInteger(params.minFaces, 3))

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const rows = db.prepare(`
        SELECT
          face.id AS id,
          face.status AS status,
          face.assetId AS assetId,
          face.score AS score,
          face_embedding.embedding AS embedding
        FROM face
        INNER JOIN face_embedding ON face_embedding.faceId = face.id
        INNER JOIN asset ON asset.id = face.assetId
        WHERE face.status IN ('unassigned', 'deferred')
          AND asset.deletedAt IS NULL
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
        INNER JOIN asset ON asset.id = face.assetId
        LEFT JOIN person_face ON person_face.faceId = face.id
        WHERE asset.deletedAt IS NULL
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
      const touchedAssetIds = new Set()

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

          touchedAssetIds.add(row.assetId)
          assigned += 1
        } else {
          const ts = nowTs()
          db.prepare(`
            UPDATE face
            SET status = 'deferred', updatedAt = ?
            WHERE id = ?
          `).run(ts, faceId)
          touchedAssetIds.add(row.assetId)
          deferred += 1
        }
      }

      updateFaceAssignmentStatus(db)
      refreshPersonCache(db)
      cleanupEmptyPeople(db)
      if (touchedAssetIds.size > 0) {
        syncVisionFaceTags(db, [...touchedAssetIds])
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
  const { scope, displayRootPath, scopedRootPath } = parsePeopleScope(params)
  const page = Math.max(1, parseInteger(params.page, 1))
  const size = Math.min(500, Math.max(1, parseInteger(params.size, 50)))
  const offset = (page - 1) * size
  const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : ''
  const scopeClause = buildAssetScopeExistsClause('face.assetId', scopedRootPath)
  const preferredPathExpr = buildRepresentativeFilePathExpression('face.assetId', displayRootPath)
  const absolutePathExpr = buildRepresentativeFilePathExpression('face.assetId', null)

  return withDb(async (db) => {
    const peopleRows = db.prepare(`
      SELECT
        person.id AS id,
        person.name AS name,
        person.featureFaceId AS featureFaceId,
        person.updatedAt AS updatedAt,
        person.createdAt AS createdAt
      FROM person
    `).all()

    const faceRows = db.prepare(`
      SELECT
        person_face.personId AS personId,
        face.id AS faceId,
        face.assetId AS assetId,
        ${scopeClause.sql} AS inScope,
        ${preferredPathExpr.sql} AS preferredAbsolutePath,
        ${absolutePathExpr.sql} AS absolutePath
      FROM person_face
      INNER JOIN face ON face.id = person_face.faceId
      INNER JOIN asset ON asset.id = face.assetId
      WHERE asset.deletedAt IS NULL
    `).all(...scopeClause.params, ...preferredPathExpr.params, ...absolutePathExpr.params)

    const faceMap = new Map()
    for (const row of faceRows) {
      const group = faceMap.get(row.personId) ?? []
      group.push(row)
      faceMap.set(row.personId, group)
    }

    const filteredItems = peopleRows.flatMap((row) => {
      const rows = faceMap.get(row.id) ?? []
      const globalFaceCount = rows.length
      const scopedRows = scope === 'root'
        ? rows.filter((item) => Number(item.inScope) === 1)
        : rows
      const faceCount = scopedRows.length

      if (faceCount <= 0) {
        return []
      }

      const name = typeof row.name === 'string' ? row.name : ''
      if (query && !name.toLowerCase().includes(query)) {
        return []
      }

      const featureFaceId = typeof row.featureFaceId === 'string' && row.featureFaceId
        ? row.featureFaceId
        : (scopedRows[0]?.faceId ?? rows[0]?.faceId ?? null)
      const featureRow = scopedRows.find((item) => item.faceId === featureFaceId)
        ?? rows.find((item) => item.faceId === featureFaceId)
        ?? scopedRows[0]
        ?? rows[0]
        ?? null
      const featureAbsolutePath = featureRow ? pickCandidateAbsolutePath(featureRow) : null

      return [{
        personId: row.id,
        name,
        faceCount,
        globalFaceCount,
        featureFaceId,
        featureAssetPath: featureAbsolutePath ? toDisplayPath(displayRootPath, featureAbsolutePath) : null,
        updatedAt: Number(row.updatedAt ?? 0),
        createdAt: Number(row.createdAt ?? 0),
      }]
    })

    filteredItems.sort((left, right) => (
      right.faceCount - left.faceCount
      || right.globalFaceCount - left.globalFaceCount
      || right.updatedAt - left.updatedAt
      || right.createdAt - left.createdAt
    ))

    return {
      ok: true,
      scope,
      page,
      size,
      total: filteredItems.length,
      items: filteredItems.slice(offset, offset + size),
    }
  })
}

export async function renamePerson(params) {
  const personId = typeof params.personId === 'string' ? params.personId.trim() : ''
  const name = typeof params.name === 'string' ? params.name.trim() : ''
  const rootPath = resolveOptionalRootPath(params.rootPath)
  if (!personId) throw new Error('personId is required')

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const ts = nowTs()
      const cursor = db.prepare('UPDATE person SET name = ?, updatedAt = ? WHERE id = ?').run(name, ts, personId)
      if (Number(cursor?.changes ?? 0) === 0) {
        throw createFaceError('PERSON_NOT_FOUND', `person not found: ${personId}`)
      }

      const assetRows = db.prepare(`
        SELECT DISTINCT face.assetId AS assetId
        FROM face
        INNER JOIN person_face ON person_face.faceId = face.id
        WHERE person_face.personId = ?
      `).all(personId)
      syncVisionFaceTags(db, assetRows.map((row) => row.assetId))

      const row = db.prepare(`
        SELECT
          person.id AS id,
          person.name AS name,
          person.faceCount AS faceCount,
          person.featureFaceId AS featureFaceId,
          person.updatedAt AS updatedAt,
          file_path.absolutePath AS featureAbsolutePath
        FROM person
        LEFT JOIN face ON face.id = person.featureFaceId
        LEFT JOIN (${representativeFilePathSubquery()}) AS file_path ON file_path.assetId = face.assetId
        WHERE person.id = ?
      `).get(personId)

      return {
        ok: true,
        person: {
          personId: row.id,
          name: row.name,
          faceCount: Number(row.faceCount ?? 0),
          globalFaceCount: Number(row.faceCount ?? 0),
          featureFaceId: row.featureFaceId,
          featureAssetPath: typeof row.featureAbsolutePath === 'string'
            ? toDisplayPath(rootPath, row.featureAbsolutePath)
            : null,
          updatedAt: Number(row.updatedAt ?? 0),
        },
      }
    })
  ))
}

export async function mergePeople(params) {
  const targetPersonId = typeof params.targetPersonId === 'string' ? params.targetPersonId.trim() : ''
  const sourcePersonIds = Array.isArray(params.sourcePersonIds)
    ? params.sourcePersonIds.filter((item) => typeof item === 'string').map((item) => item.trim())
    : []

  if (!targetPersonId) throw new Error('targetPersonId is required')

  const validSources = sourcePersonIds.filter((item) => item && item !== targetPersonId)
  if (validSources.length === 0) {
    throw new Error('sourcePersonIds must contain at least one non-target personId')
  }

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const targetExists = db.prepare('SELECT 1 AS ok FROM person WHERE id = ?').get(targetPersonId)
      if (!targetExists) {
        throw createFaceError('PERSON_NOT_FOUND', `target person not found: ${targetPersonId}`)
      }

      const ts = nowTs()
      const merged = []
      const skipped = []
      const touchedAssetIds = new Set()

      for (const sourceId of validSources) {
        const sourceExists = db.prepare('SELECT 1 AS ok FROM person WHERE id = ?').get(sourceId)
        if (!sourceExists) {
          skipped.push(sourceId)
          continue
        }

        const sourceFaceRows = db.prepare(`
          SELECT person_face.faceId AS faceId, face.assetId AS assetId
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
          touchedAssetIds.add(row.assetId)
        }
      }

      updateFaceAssignmentStatus(db)
      refreshPersonCache(db)
      cleanupEmptyPeople(db)
      if (touchedAssetIds.size > 0) {
        syncVisionFaceTags(db, [...touchedAssetIds])
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
  const { scope, displayRootPath, scopedRootPath } = parsePeopleScope(params)
  const personId = typeof params.personId === 'string' ? params.personId.trim() : ''
  const hasRelativePath = typeof params.relativePath === 'string' && params.relativePath.trim()

  if (!personId && !hasRelativePath) {
    throw new Error('listAssetFaces requires relativePath or personId')
  }

  return withDb(async (db) => {
    if (personId) {
      const scopeClause = buildAssetScopeExistsClause('face.assetId', scopedRootPath)
      const displayPathExpr = buildRepresentativeFilePathExpression('face.assetId', displayRootPath)
      const rows = db.prepare(`
        SELECT
          face.id AS id,
          face.assetId AS assetId,
          face.x1 AS x1,
          face.y1 AS y1,
          face.x2 AS x2,
          face.y2 AS y2,
          face.score AS score,
          face.status AS status,
          face.updatedAt AS updatedAt,
          person_face.personId AS personId,
          person_face.assignedBy AS assignedBy,
          person.name AS personName,
          ${displayPathExpr.sql} AS displayAbsolutePath
        FROM face
        INNER JOIN person_face ON person_face.faceId = face.id
        INNER JOIN asset ON asset.id = face.assetId
        LEFT JOIN person ON person.id = person_face.personId
        WHERE person_face.personId = ?
          AND asset.deletedAt IS NULL
          AND ${scopeClause.sql}
        ORDER BY face.updatedAt DESC, face.id ASC
      `).all(...displayPathExpr.params, personId, ...scopeClause.params)

      return {
        ok: true,
        scope,
        total: rows.length,
        items: rows.map((row) => toFaceDto(row, displayRootPath)),
      }
    }

    const resolvedRootPath = resolveRootPath(params.rootPath)
    const relativePath = normalizeRelativePath(params.relativePath)
    const file = resolveFileByRootRelativePath(db, resolvedRootPath, relativePath)
    if (!file) {
      return {
        ok: true,
        scope: 'root',
        total: 0,
        items: [],
      }
    }

    const asset = getAssetById(db, file.assetId)
    if (!asset || asset.deletedAt !== null) {
      return {
        ok: true,
        scope: 'root',
        total: 0,
        items: [],
      }
    }

    const rows = db.prepare(`
      SELECT
        face.id AS id,
        face.assetId AS assetId,
        face.x1 AS x1,
        face.y1 AS y1,
        face.x2 AS x2,
        face.y2 AS y2,
        face.score AS score,
        face.status AS status,
        face.updatedAt AS updatedAt,
        person_face.personId AS personId,
        person_face.assignedBy AS assignedBy,
        person.name AS personName
      FROM face
      LEFT JOIN person_face ON person_face.faceId = face.id
      LEFT JOIN person ON person.id = person_face.personId
      WHERE face.assetId = ?
      ORDER BY face.x1 ASC
    `).all(file.assetId)

    return {
      ok: true,
      scope: 'root',
      total: rows.length,
      items: rows.map((row) => toFaceDto(row, displayRootPath, relativePath)),
    }
  })
}

export async function listReviewFaces(params) {
  const { scope, displayRootPath, scopedRootPath } = parsePeopleScope(params)
  const bucket = typeof params.bucket === 'string' ? params.bucket.trim() : ''
  const page = Math.max(1, parseInteger(params.page, 1))
  const size = Math.min(500, Math.max(1, parseInteger(params.size, 100)))
  const offset = (page - 1) * size
  const scopeClause = buildAssetScopeExistsClause('face.assetId', scopedRootPath)
  const displayPathExpr = buildRepresentativeFilePathExpression('face.assetId', displayRootPath)

  let statuses = []
  if (bucket === 'unassigned') {
    statuses = ['manual_unassigned', 'deferred', 'unassigned']
  } else if (bucket === 'ignored') {
    statuses = ['ignored']
  } else {
    throw new Error('bucket must be "unassigned" or "ignored"')
  }

  const placeholders = statuses.map(() => '?').join(',')
  const totalParams = [...statuses, ...scopeClause.params]
  const totalRow = await withDb(async (db) => db.prepare(`
    SELECT COUNT(*) AS count
    FROM face
    INNER JOIN asset ON asset.id = face.assetId
    WHERE asset.deletedAt IS NULL
      AND face.status IN (${placeholders})
      AND ${scopeClause.sql}
  `).get(...totalParams))

  return withDb(async (db) => {
    const rows = db.prepare(`
      SELECT
        face.id AS id,
        face.assetId AS assetId,
        face.x1 AS x1,
        face.y1 AS y1,
        face.x2 AS x2,
        face.y2 AS y2,
        face.score AS score,
        face.status AS status,
        face.updatedAt AS updatedAt,
        person_face.personId AS personId,
        person_face.assignedBy AS assignedBy,
        person.name AS personName,
        ${displayPathExpr.sql} AS displayAbsolutePath
      FROM face
      INNER JOIN asset ON asset.id = face.assetId
      LEFT JOIN person_face ON person_face.faceId = face.id
      LEFT JOIN person ON person.id = person_face.personId
      WHERE asset.deletedAt IS NULL
        AND face.status IN (${placeholders})
        AND ${scopeClause.sql}
      ORDER BY
        CASE face.status
          WHEN 'manual_unassigned' THEN 0
          WHEN 'deferred' THEN 1
          WHEN 'unassigned' THEN 2
          ELSE 3
        END ASC,
        face.updatedAt DESC,
        face.id ASC
      LIMIT ? OFFSET ?
    `).all(
      ...displayPathExpr.params,
      ...statuses,
      ...scopeClause.params,
      size,
      offset,
    )

    return {
      ok: true,
      scope,
      bucket,
      page,
      size,
      total: Number(totalRow?.count ?? 0),
      items: rows.map((row) => toFaceDto(row, displayRootPath)),
    }
  })
}

export async function suggestPeople(params) {
  const faceId = typeof params.faceId === 'string' ? params.faceId.trim() : ''
  const candidateSize = Math.min(20, Math.max(1, parseInteger(params.candidateSize, 6)))
  if (!faceId) {
    throw new Error('faceId is required')
  }

  return withDb(async (db) => {
    const sourceRow = db.prepare(`
      SELECT
        face.id AS faceId,
        face_embedding.embedding AS embedding
      FROM face
      INNER JOIN face_embedding ON face_embedding.faceId = face.id
      INNER JOIN asset ON asset.id = face.assetId
      WHERE face.id = ?
        AND asset.deletedAt IS NULL
    `).get(faceId)

    if (!sourceRow) {
      throw createFaceError('FACE_NOT_FOUND', `face not found: ${faceId}`)
    }

    const absolutePathExpr = buildRepresentativeFilePathExpression('face.assetId', null)
    const rows = db.prepare(`
      SELECT
        person.id AS personId,
        person.name AS personName,
        face.id AS faceId,
        face.assetId AS assetId,
        face.x1 AS x1,
        face.y1 AS y1,
        face.x2 AS x2,
        face.y2 AS y2,
        face_embedding.embedding AS embedding,
        ${absolutePathExpr.sql} AS absolutePath
      FROM person_face
      INNER JOIN person ON person.id = person_face.personId
      INNER JOIN face ON face.id = person_face.faceId
      INNER JOIN face_embedding ON face_embedding.faceId = face.id
      INNER JOIN asset ON asset.id = face.assetId
      WHERE asset.deletedAt IS NULL
        AND face.id != ?
    `).all(...absolutePathExpr.params, faceId)

    const currentEmbedding = fromEmbeddingBlob(sourceRow.embedding)
    const candidateMap = new Map()

    for (const row of rows) {
      const embedding = fromEmbeddingBlob(row.embedding)
      let dot = 0
      let leftNorm = 0
      let rightNorm = 0
      const size = Math.min(currentEmbedding.length, embedding.length)
      for (let index = 0; index < size; index += 1) {
        const left = currentEmbedding[index]
        const right = embedding[index]
        dot += left * right
        leftNorm += left * left
        rightNorm += right * right
      }

      const distance = leftNorm > 0 && rightNorm > 0
        ? 1 - Math.min(1, Math.max(-1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))))
        : 1
      const existing = candidateMap.get(row.personId)
      if (!existing || distance < existing.distance) {
        candidateMap.set(row.personId, {
          personId: row.personId,
          name: typeof row.personName === 'string' ? row.personName : '',
          distance,
          score: Math.max(0, 1 - distance),
          supportingFace: {
            faceId: row.faceId,
            assetId: row.assetId,
            assetPath: typeof row.absolutePath === 'string' ? row.absolutePath : null,
            boundingBox: {
              x1: Number(row.x1),
              y1: Number(row.y1),
              x2: Number(row.x2),
              y2: Number(row.y2),
            },
          },
        })
      }
    }

    const items = [...candidateMap.values()]
      .sort((left, right) => left.distance - right.distance)
      .slice(0, candidateSize)

    return {
      ok: true,
      faceId,
      items,
    }
  })
}

export async function assignFaces(params) {
  const faceIds = normalizeFaceIds(params.faceIds)
  const targetPersonId = typeof params.targetPersonId === 'string' ? params.targetPersonId.trim() : ''
  if (!targetPersonId) {
    throw new Error('targetPersonId is required')
  }

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const targetPerson = db.prepare('SELECT id FROM person WHERE id = ?').get(targetPersonId)
      if (!targetPerson) {
        return summarizeMutation(
          'assignFaces',
          faceIds.map((faceId) => buildMutationFailure(faceId, null, 'PERSON_NOT_FOUND', `person not found: ${targetPersonId}`)),
          { targetPersonId }
        )
      }

      const faceRows = getFaceRowsByIds(db, faceIds)
      const items = []
      const touchedAssetIds = new Set()

      for (const faceId of faceIds) {
        const row = faceRows.get(faceId) ?? null
        if (!row) {
          items.push(buildMutationFailure(faceId, row, 'FACE_NOT_FOUND', `face not found: ${faceId}`))
          continue
        }
        if (row.status === 'ignored') {
          items.push(buildMutationFailure(faceId, row, 'FACE_STATE_CONFLICT', 'ignored face must be restored before assignment'))
          continue
        }
        if (row.personId === targetPersonId) {
          items.push(buildMutationFailure(faceId, row, 'FACE_ALREADY_ASSIGNED_TO_TARGET', 'face is already assigned to target person'))
          continue
        }

        upsertFaceAssignment(db, faceId, targetPersonId, 'manual')
        touchedAssetIds.add(row.assetId)
        items.push(buildMutationSuccess(faceId, row, 'assigned', targetPersonId))
      }

      finalizeFaceMutation(db, touchedAssetIds)
      return summarizeMutation('assignFaces', items, { targetPersonId })
    })
  ))
}

export async function createPersonFromFaces(params) {
  const faceIds = normalizeFaceIds(params.faceIds)
  const name = typeof params.name === 'string' ? params.name.trim() : ''

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const faceRows = getFaceRowsByIds(db, faceIds)
      const items = []
      const touchedAssetIds = new Set()
      let createdPersonId = null

      for (const faceId of faceIds) {
        const row = faceRows.get(faceId) ?? null
        if (!row) {
          items.push(buildMutationFailure(faceId, row, 'FACE_NOT_FOUND', `face not found: ${faceId}`))
          continue
        }
        if (row.status === 'ignored') {
          items.push(buildMutationFailure(faceId, row, 'FACE_STATE_CONFLICT', 'ignored face must be restored before assignment'))
          continue
        }

        if (!createdPersonId) {
          createdPersonId = randomUUID()
          const ts = nowTs()
          db.prepare(`
            INSERT INTO person(id, name, featureFaceId, faceCount, createdAt, updatedAt)
            VALUES (?, ?, NULL, 0, ?, ?)
          `).run(createdPersonId, name, ts, ts)
        }

        upsertFaceAssignment(db, faceId, createdPersonId, 'manual')
        touchedAssetIds.add(row.assetId)
        items.push(buildMutationSuccess(faceId, row, 'assigned', createdPersonId))
      }

      finalizeFaceMutation(db, touchedAssetIds)
      return summarizeMutation('createPersonFromFaces', items, { personId: createdPersonId })
    })
  ))
}

export async function unassignFaces(params) {
  const faceIds = normalizeFaceIds(params.faceIds)

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const faceRows = getFaceRowsByIds(db, faceIds)
      const items = []
      const touchedAssetIds = new Set()

      for (const faceId of faceIds) {
        const row = faceRows.get(faceId) ?? null
        if (!row) {
          items.push(buildMutationFailure(faceId, row, 'FACE_NOT_FOUND', `face not found: ${faceId}`))
          continue
        }
        if (row.status === 'ignored') {
          items.push(buildMutationFailure(faceId, row, 'FACE_STATE_CONFLICT', 'ignored face cannot be manually unassigned'))
          continue
        }
        if (row.status === 'manual_unassigned' && !row.personId) {
          items.push(buildMutationFailure(faceId, row, 'FACE_STATE_CONFLICT', 'face is already manual_unassigned'))
          continue
        }

        clearFaceAssignment(db, faceId)
        updateFaceStatus(db, faceId, 'manual_unassigned')
        touchedAssetIds.add(row.assetId)
        items.push(buildMutationSuccess(faceId, row, 'manual_unassigned', null))
      }

      finalizeFaceMutation(db, touchedAssetIds)
      return summarizeMutation('unassignFaces', items)
    })
  ))
}

export async function ignoreFaces(params) {
  const faceIds = normalizeFaceIds(params.faceIds)

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const faceRows = getFaceRowsByIds(db, faceIds)
      const items = []
      const touchedAssetIds = new Set()

      for (const faceId of faceIds) {
        const row = faceRows.get(faceId) ?? null
        if (!row) {
          items.push(buildMutationFailure(faceId, row, 'FACE_NOT_FOUND', `face not found: ${faceId}`))
          continue
        }
        if (row.status === 'ignored') {
          items.push(buildMutationFailure(faceId, row, 'FACE_ALREADY_IGNORED', 'face is already ignored'))
          continue
        }

        clearFaceAssignment(db, faceId)
        updateFaceStatus(db, faceId, 'ignored')
        touchedAssetIds.add(row.assetId)
        items.push(buildMutationSuccess(faceId, row, 'ignored', null))
      }

      finalizeFaceMutation(db, touchedAssetIds)
      return summarizeMutation('ignoreFaces', items)
    })
  ))
}

export async function restoreIgnoredFaces(params) {
  const faceIds = normalizeFaceIds(params.faceIds)

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const faceRows = getFaceRowsByIds(db, faceIds)
      const items = []
      const touchedAssetIds = new Set()

      for (const faceId of faceIds) {
        const row = faceRows.get(faceId) ?? null
        if (!row) {
          items.push(buildMutationFailure(faceId, row, 'FACE_NOT_FOUND', `face not found: ${faceId}`))
          continue
        }
        if (row.status !== 'ignored') {
          items.push(buildMutationFailure(faceId, row, 'FACE_STATE_CONFLICT', 'only ignored faces can be restored'))
          continue
        }

        updateFaceStatus(db, faceId, 'manual_unassigned')
        touchedAssetIds.add(row.assetId)
        items.push(buildMutationSuccess(faceId, row, 'manual_unassigned', null))
      }

      finalizeFaceMutation(db, touchedAssetIds)
      return summarizeMutation('restoreIgnoredFaces', items)
    })
  ))
}

export async function requeueFaces(params) {
  const faceIds = normalizeFaceIds(params.faceIds)

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const faceRows = getFaceRowsByIds(db, faceIds)
      const items = []
      const touchedAssetIds = new Set()

      for (const faceId of faceIds) {
        const row = faceRows.get(faceId) ?? null
        if (!row) {
          items.push(buildMutationFailure(faceId, row, 'FACE_NOT_FOUND', `face not found: ${faceId}`))
          continue
        }
        if (row.status !== 'manual_unassigned') {
          items.push(buildMutationFailure(faceId, row, 'FACE_STATE_CONFLICT', 'only manual_unassigned faces can be requeued'))
          continue
        }

        clearFaceAssignment(db, faceId)
        updateFaceStatus(db, faceId, 'deferred')
        touchedAssetIds.add(row.assetId)
        items.push(buildMutationSuccess(faceId, row, 'deferred', null))
      }

      finalizeFaceMutation(db, touchedAssetIds)
      return summarizeMutation('requeueFaces', items)
    })
  ))
}

export async function getFaceCrop(params) {
  const faceId = typeof params.faceId === 'string' ? params.faceId.trim() : ''
  if (!faceId) {
    throw new Error('faceId is required')
  }

  const size = Math.min(
    FACE_CROP_SIZE_MAX,
    Math.max(FACE_CROP_SIZE_MIN, parseInteger(params.size, FACE_CROP_SIZE_DEFAULT))
  )
  const padding = Math.min(
    FACE_CROP_PADDING_MAX,
    Math.max(FACE_CROP_PADDING_MIN, parseFiniteNumber(params.padding, FACE_CROP_PADDING_DEFAULT))
  )

  return withDb(async (db) => {
    const row = db.prepare(`
      SELECT
        face.id AS faceId,
        face.x1 AS x1,
        face.y1 AS y1,
        face.x2 AS x2,
        face.y2 AS y2,
        file_path.absolutePath AS absolutePath
      FROM face
      INNER JOIN asset ON asset.id = face.assetId
      LEFT JOIN (${representativeFilePathSubquery()}) AS file_path ON file_path.assetId = face.assetId
      WHERE face.id = ?
        AND asset.deletedAt IS NULL
    `).get(faceId)

    if (!row || typeof row.absolutePath !== 'string' || !row.absolutePath) {
      throw createFaceError('FACE_NOT_FOUND', `face not found: ${faceId}`)
    }

    const pythonBinary = resolveCropPythonBinary()
    const args = [
      FACE_CROP_SCRIPT_PATH,
      '--input',
      row.absolutePath,
      '--x1',
      String(Number(row.x1)),
      '--y1',
      String(Number(row.y1)),
      '--x2',
      String(Number(row.x2)),
      '--y2',
      String(Number(row.y2)),
      '--size',
      String(size),
      '--padding',
      String(padding),
    ]

    const { stdout } = await execFileAsync(pythonBinary, args, {
      encoding: 'buffer',
      maxBuffer: FACE_CROP_MAX_BUFFER,
    })

    return {
      contentType: 'image/jpeg',
      body: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    }
  })
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
