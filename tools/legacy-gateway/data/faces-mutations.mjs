import { randomUUID } from 'node:crypto'
import { nowTs } from './common.mjs'
import {
  withDb,
  withTransaction,
  cleanupEmptyPeople,
  refreshPersonCache,
  syncVisionFaceTags,
  updateFaceAssignmentStatus,
} from './storage.mjs'

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
