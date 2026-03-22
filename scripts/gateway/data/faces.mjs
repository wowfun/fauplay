import { randomUUID } from 'node:crypto'
import {
  nowTs,
  resolveRootPath,
  resolveOptionalRootPath,
  normalizeRelativePath,
  toDisplayPath,
  parseInteger,
  parseFiniteNumber,
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

function representativeFilePathSubquery() {
  return `
    SELECT assetId, MIN(absolutePath) AS absolutePath
    FROM file
    GROUP BY assetId
  `
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
          status: 'unassigned',
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
  const rootPath = resolveOptionalRootPath(params.rootPath)
  const page = Math.max(1, parseInteger(params.page, 1))
  const size = Math.min(500, Math.max(1, parseInteger(params.size, 50)))
  const offset = (page - 1) * size

  return withDb(async (db) => {
    const totalRow = db.prepare('SELECT COUNT(*) AS count FROM person WHERE faceCount > 0').get()
    const total = Number(totalRow?.count ?? 0)

    const rows = db.prepare(`
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
      WHERE person.faceCount > 0
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
        featureAssetPath: typeof row.featureAbsolutePath === 'string'
          ? toDisplayPath(rootPath, row.featureAbsolutePath)
          : null,
        updatedAt: Number(row.updatedAt ?? 0),
      })),
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
        throw new Error(`person not found: ${personId}`)
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
        throw new Error(`target person not found: ${targetPersonId}`)
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
  const rootPath = resolveOptionalRootPath(params.rootPath)
  const personId = typeof params.personId === 'string' ? params.personId.trim() : ''
  const hasRelativePath = typeof params.relativePath === 'string' && params.relativePath.trim()

  if (!personId && !hasRelativePath) {
    throw new Error('listAssetFaces requires relativePath or personId')
  }

  return withDb(async (db) => {
    if (personId) {
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
          person_face.personId AS personId,
          file_path.absolutePath AS absolutePath
        FROM face
        INNER JOIN person_face ON person_face.faceId = face.id
        INNER JOIN asset ON asset.id = face.assetId
        LEFT JOIN (${representativeFilePathSubquery()}) AS file_path ON file_path.assetId = face.assetId
        WHERE person_face.personId = ?
          AND asset.deletedAt IS NULL
        ORDER BY face.updatedAt DESC
      `).all(personId)

      return {
        ok: true,
        total: rows.length,
        items: rows.map((row) => ({
          faceId: row.id,
          assetId: row.assetId,
          assetPath: typeof row.absolutePath === 'string'
            ? toDisplayPath(rootPath, row.absolutePath)
            : null,
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
    }

    const resolvedRootPath = resolveRootPath(params.rootPath)
    const relativePath = normalizeRelativePath(params.relativePath)
    const file = resolveFileByRootRelativePath(db, resolvedRootPath, relativePath)
    if (!file) {
      return {
        ok: true,
        total: 0,
        items: [],
      }
    }

    const asset = getAssetById(db, file.assetId)
    if (!asset || asset.deletedAt !== null) {
      return {
        ok: true,
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
        person_face.personId AS personId
      FROM face
      LEFT JOIN person_face ON person_face.faceId = face.id
      WHERE face.assetId = ?
      ORDER BY face.x1 ASC
    `).all(file.assetId)

    return {
      ok: true,
      total: rows.length,
      items: rows.map((row) => ({
        faceId: row.id,
        assetId: row.assetId,
        assetPath: relativePath,
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
