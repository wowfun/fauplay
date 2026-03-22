import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import {
  nowTs,
  resolveRootPath,
  normalizeRelativePath,
  readMappingPathField,
  resolvePathWithinRoot,
  buildPathScopeClause,
  isSkippableFsError,
  toFileMtimeMs,
} from './common.mjs'
import {
  withDb,
  withTransaction,
  softDeleteAssetsIfOrphaned,
  refreshPersonCache,
  cleanupEmptyPeople,
  updateFaceAssignmentStatus,
  syncVisionFaceTags,
  cleanupOrphanTags,
} from './storage.mjs'

function countRows(db, sql, params = []) {
  return Number(db.prepare(sql).get(...params)?.count ?? 0)
}

function isMissingPathError(error) {
  if (!error || typeof error !== 'object') return false
  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

function estimateCleanupImpact(db, targetAbsolutePaths) {
  if (!Array.isArray(targetAbsolutePaths) || targetAbsolutePaths.length === 0) {
    return {
      file: 0,
      asset: 0,
      assetTag: 0,
      face: 0,
      faceEmbedding: 0,
      personFace: 0,
      person: 0,
      tag: 0,
    }
  }

  const pathPlaceholders = targetAbsolutePaths.map(() => '?').join(',')
  const assetRows = db.prepare(`
    SELECT DISTINCT assetId
    FROM file
    WHERE absolutePath IN (${pathPlaceholders})
      AND assetId NOT IN (
        SELECT DISTINCT assetId
        FROM file
        WHERE absolutePath NOT IN (${pathPlaceholders})
      )
  `).all(...targetAbsolutePaths, ...targetAbsolutePaths)
  const targetAssetIds = assetRows.map((row) => row.assetId).filter((item) => typeof item === 'string' && item)

  if (targetAssetIds.length === 0) {
    return {
      file: targetAbsolutePaths.length,
      asset: 0,
      assetTag: 0,
      face: 0,
      faceEmbedding: 0,
      personFace: 0,
      person: 0,
      tag: 0,
    }
  }

  const assetPlaceholders = targetAssetIds.map(() => '?').join(',')
  const duplicatedAssetParams = [...targetAssetIds, ...targetAssetIds]

  return {
    file: targetAbsolutePaths.length,
    asset: targetAssetIds.length,
    assetTag: countRows(
      db,
      `SELECT COUNT(*) AS count FROM asset_tag WHERE assetId IN (${assetPlaceholders})`,
      targetAssetIds
    ),
    face: countRows(
      db,
      `SELECT COUNT(*) AS count FROM face WHERE assetId IN (${assetPlaceholders})`,
      targetAssetIds
    ),
    faceEmbedding: countRows(
      db,
      `SELECT COUNT(*) AS count FROM face_embedding WHERE faceId IN (
        SELECT id FROM face WHERE assetId IN (${assetPlaceholders})
      )`,
      targetAssetIds
    ),
    personFace: countRows(
      db,
      `SELECT COUNT(*) AS count FROM person_face WHERE faceId IN (
        SELECT id FROM face WHERE assetId IN (${assetPlaceholders})
      )`,
      targetAssetIds
    ),
    person: countRows(
      db,
      `SELECT COUNT(*) AS count
       FROM person
       WHERE id IN (
         SELECT DISTINCT person_face.personId
         FROM person_face
         INNER JOIN face ON face.id = person_face.faceId
         WHERE face.assetId IN (${assetPlaceholders})
       )
       AND id NOT IN (
         SELECT DISTINCT person_face.personId
         FROM person_face
         INNER JOIN face ON face.id = person_face.faceId
         WHERE face.assetId NOT IN (${assetPlaceholders})
       )`,
      duplicatedAssetParams
    ),
    tag: countRows(
      db,
      `SELECT COUNT(*) AS count
       FROM tag
       WHERE id IN (
         SELECT DISTINCT tagId FROM asset_tag WHERE assetId IN (${assetPlaceholders})
       )
       AND id NOT IN (
         SELECT DISTINCT tagId FROM asset_tag WHERE assetId NOT IN (${assetPlaceholders})
       )`,
      duplicatedAssetParams
    ),
  }
}

async function listMissingFileRows(db, rootPath) {
  const { sql: scopeSql, params: scopeParams } = buildPathScopeClause('file.absolutePath', rootPath)
  const rows = db.prepare(`
    SELECT absolutePath, assetId
    FROM file
    WHERE ${scopeSql}
    ORDER BY absolutePath ASC
  `).all(...scopeParams)

  const missingRows = []
  for (const row of rows) {
    try {
      const statResult = await fs.stat(row.absolutePath)
      if (!statResult.isFile()) {
        missingRows.push(row)
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        missingRows.push(row)
        continue
      }
      if (isSkippableFsError(error)) {
        continue
      }
      throw error
    }
  }

  return missingRows
}

function batchUpdateAbsolutePaths(db, mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { updated: 0 }
  }

  const ts = nowTs()
  const stagedMappings = mappings.map((mapping) => ({
    ...mapping,
    tempAbsolutePath: `/__fauplay_rebind_tmp__/${randomUUID()}`,
  }))

  for (const mapping of stagedMappings) {
    db.prepare(`
      UPDATE file
      SET absolutePath = ?, updatedAt = ?
      WHERE absolutePath = ?
    `).run(mapping.tempAbsolutePath, ts, mapping.fromAbsolutePath)
  }

  for (const mapping of stagedMappings) {
    db.prepare(`
      UPDATE file
      SET absolutePath = ?, fileMtimeMs = ?, lastSeenAt = ?, updatedAt = ?
      WHERE absolutePath = ?
    `).run(mapping.toAbsolutePath, mapping.fileMtimeMs, ts, ts, mapping.tempAbsolutePath)
  }

  return { updated: stagedMappings.length }
}

export async function batchRebindPaths(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const inputMappings = Array.isArray(params.mappings) ? params.mappings : null
  if (!inputMappings) {
    throw new Error('mappings must be an array')
  }

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const items = inputMappings.map((mapping, index) => ({
        index,
        fromRelativePath: '',
        toRelativePath: '',
        fromAbsolutePath: '',
        toAbsolutePath: '',
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
          item.fromAbsolutePath = resolvePathWithinRoot(rootPath, item.fromRelativePath)
        } catch (error) {
          item.reasonCode = 'INVALID_SOURCE_PATH'
          item.error = error instanceof Error ? error.message : 'invalid fromRelativePath'
          continue
        }

        try {
          item.toRelativePath = normalizeRelativePath(rawTo, 'toRelativePath')
          item.toAbsolutePath = resolvePathWithinRoot(rootPath, item.toRelativePath)
        } catch (error) {
          item.reasonCode = 'INVALID_TARGET_PATH'
          item.error = error instanceof Error ? error.message : 'invalid toRelativePath'
          continue
        }

        if (item.fromAbsolutePath === item.toAbsolutePath) {
          item.ok = true
          item.skipped = true
          item.reasonCode = 'NO_CHANGE'
          continue
        }

        if (sourceUseMap.has(item.fromAbsolutePath)) {
          item.reasonCode = 'DUPLICATE_SOURCE'
          item.error = 'duplicate fromRelativePath in mappings'
          continue
        }
        sourceUseMap.set(item.fromAbsolutePath, i)

        if (targetUseMap.has(item.toAbsolutePath)) {
          item.reasonCode = 'DUPLICATE_TARGET'
          item.error = 'duplicate toRelativePath in mappings'
          continue
        }
        targetUseMap.set(item.toAbsolutePath, i)
      }

      const validSourcePaths = items
        .filter((item) => !item.reasonCode && item.skipped !== true)
        .map((item) => item.fromAbsolutePath)
      const validTargetPaths = items
        .filter((item) => !item.reasonCode && item.skipped !== true)
        .map((item) => item.toAbsolutePath)

      const sourceRows = validSourcePaths.length > 0
        ? db.prepare(`
          SELECT absolutePath, fileMtimeMs
          FROM file
          WHERE absolutePath IN (${validSourcePaths.map(() => '?').join(',')})
        `).all(...validSourcePaths)
        : []
      const sourceByPath = new Map(sourceRows.map((row) => [row.absolutePath, row]))

      const targetRows = validTargetPaths.length > 0
        ? db.prepare(`
          SELECT absolutePath
          FROM file
          WHERE absolutePath IN (${validTargetPaths.map(() => '?').join(',')})
        `).all(...validTargetPaths)
        : []
      const targetByPath = new Map(targetRows.map((row) => [row.absolutePath, row]))
      const movingPathSet = new Set(sourceRows.map((row) => row.absolutePath))

      const executableMappings = []
      for (const item of items) {
        if (item.reasonCode || item.skipped === true) continue

        const sourceRow = sourceByPath.get(item.fromAbsolutePath)
        if (!sourceRow) {
          item.reasonCode = 'SOURCE_NOT_FOUND'
          item.error = 'source file entry not found'
          continue
        }

        const targetRow = targetByPath.get(item.toAbsolutePath)
        if (targetRow && !movingPathSet.has(targetRow.absolutePath)) {
          item.reasonCode = 'TARGET_OCCUPIED'
          item.error = 'target path is occupied by another file entry'
          continue
        }

        let targetStat = null
        try {
          targetStat = await fs.stat(item.toAbsolutePath)
        } catch (error) {
          if (!isSkippableFsError(error)) {
            throw error
          }
        }

        if (targetStat && !targetStat.isFile()) {
          item.reasonCode = 'INVALID_TARGET_PATH'
          item.error = 'target path must resolve to a file'
          continue
        }

        executableMappings.push({
          fromAbsolutePath: item.fromAbsolutePath,
          toAbsolutePath: item.toAbsolutePath,
          fileMtimeMs: targetStat && targetStat.isFile() ? toFileMtimeMs(targetStat) : sourceRow.fileMtimeMs,
        })
      }

      if (executableMappings.length > 0) {
        batchUpdateAbsolutePaths(db, executableMappings)
      }

      let updated = 0
      let skipped = 0
      let failed = 0
      for (const item of items) {
        if (item.reasonCode) {
          if (item.reasonCode === 'NO_CHANGE') {
            skipped += 1
          } else {
            failed += 1
          }
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
          ok: item.ok,
          skipped: item.skipped || undefined,
          reasonCode: item.reasonCode || undefined,
          error: item.error || undefined,
        })),
      }
    })
  ))
}

export async function cleanupMissingFiles(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const confirm = params.confirm === true

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const missingRows = await listMissingFileRows(db, rootPath)
      const missingAbsolutePaths = [...new Set(missingRows.map((row) => row.absolutePath))]
      const impact = estimateCleanupImpact(db, missingAbsolutePaths)

      if (!confirm || missingAbsolutePaths.length === 0) {
        return {
          ok: true,
          dryRun: !confirm,
          missingAbsolutePaths,
          impact,
          removed: 0,
        }
      }

      const affectedAssetIds = [...new Set(
        missingRows.map((row) => row.assetId).filter((item) => typeof item === 'string' && item)
      )]
      const placeholders = missingAbsolutePaths.map(() => '?').join(',')
      const cursor = db.prepare(`
        DELETE FROM file
        WHERE absolutePath IN (${placeholders})
      `).run(...missingAbsolutePaths)
      const removed = Number(cursor?.changes ?? 0)

      softDeleteAssetsIfOrphaned(db, affectedAssetIds)
      cleanupEmptyPeople(db)
      refreshPersonCache(db)
      updateFaceAssignmentStatus(db)
      syncVisionFaceTags(db, affectedAssetIds)
      cleanupOrphanTags(db)

      return {
        ok: true,
        dryRun: false,
        missingAbsolutePaths,
        impact,
        removed,
      }
    })
  ))
}
