import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import {
  nowTs,
  resolveRootPath,
  normalizeRelativePath,
  readMappingPathField,
  resolvePathWithinRoot,
  toRelativePathWithinRoot,
  buildPathScopeClause,
  isSkippableFsError,
  toFileMtimeMs,
  snapshotMatches,
  loadEsSearchConfig,
  searchCandidatesBySizeMtime,
  computeFingerprintsForFile,
} from './common.mjs'
import {
  withDb,
  withTransaction,
  getFileByAbsolutePath,
  getOrCreateAsset,
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

function estimateCleanupImpact(db, targetFileIds) {
  if (!Array.isArray(targetFileIds) || targetFileIds.length === 0) {
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

  const filePlaceholders = targetFileIds.map(() => '?').join(',')
  const assetRows = db.prepare(`
    SELECT DISTINCT assetId
    FROM file
    WHERE id IN (${filePlaceholders})
      AND assetId NOT IN (
        SELECT DISTINCT assetId
        FROM file
        WHERE id NOT IN (${filePlaceholders})
      )
  `).all(...targetFileIds, ...targetFileIds)
  const targetAssetIds = assetRows.map((row) => row.assetId).filter((item) => typeof item === 'string' && item)
  if (targetAssetIds.length === 0) {
    return {
      file: targetFileIds.length,
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
  const duplicateAssetParams = [...targetAssetIds, ...targetAssetIds]

  return {
    file: targetFileIds.length,
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
      duplicateAssetParams
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
      duplicateAssetParams
    ),
  }
}

async function evaluateFileBindingRows(db, rootPath, { applyRebind }) {
  const { sql: scopeSql, params: scopeParams } = buildPathScopeClause('file.absolutePath', rootPath)
  const rows = db.prepare(`
    SELECT
      file.id AS fileId,
      file.assetId AS assetId,
      file.absolutePath AS absolutePath,
      file.fileMtimeMs AS fileMtimeMs,
      asset.size AS assetSize,
      asset.fingerprint AS fingerprint,
      asset.fpMethod AS fpMethod
    FROM file
    INNER JOIN asset ON asset.id = file.assetId
    WHERE ${scopeSql}
    ORDER BY file.absolutePath ASC
  `).all(...scopeParams)

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
  const touchedOldAssetIds = []

  for (const row of rows) {
    const currentRelativePath = toRelativePathWithinRoot(rootPath, row.absolutePath)
    const item = {
      fileId: row.fileId,
      assetId: row.assetId,
      absolutePath: row.absolutePath,
      relativePath: currentRelativePath,
      status: 'active',
      reason: null,
      rebound: false,
      assetChanged: false,
      resolvedAbsolutePath: row.absolutePath,
      resolvedRelativePath: currentRelativePath,
    }

    let statResult = null
    try {
      const currentStat = await fs.stat(row.absolutePath)
      if (currentStat.isFile()) {
        statResult = currentStat
      }
    } catch (error) {
      if (!isSkippableFsError(error)) {
        throw error
      }
    }

    if (statResult) {
      if (snapshotMatches(statResult, row.assetSize, row.fileMtimeMs)) {
        active += 1
        items.push(item)
        if (applyRebind) {
          const ts = nowTs()
          db.prepare(`
            UPDATE file
            SET fileMtimeMs = ?, lastSeenAt = ?, updatedAt = ?
            WHERE id = ?
          `).run(toFileMtimeMs(statResult), ts, ts, row.fileId)
        }
        continue
      }

      try {
        const identity = await computeFingerprintsForFile(row.absolutePath, {
          exactEnabled: false,
          similarImageEnabled: false,
        }, statResult)

        if (
          identity.size === Number(row.assetSize)
          && identity.fpMethod === row.fpMethod
          && identity.fingerprint === row.fingerprint
        ) {
          active += 1
          items.push(item)
          if (applyRebind) {
            const ts = nowTs()
            db.prepare(`
              UPDATE file
              SET fileMtimeMs = ?, lastSeenAt = ?, updatedAt = ?
              WHERE id = ?
            `).run(toFileMtimeMs(statResult), ts, ts, row.fileId)
          }
          continue
        }

        const nextAsset = getOrCreateAsset(db, identity)
        item.assetChanged = nextAsset.id !== row.assetId
        item.resolvedAbsolutePath = row.absolutePath
        item.resolvedRelativePath = currentRelativePath
        active += 1
        items.push(item)
        if (applyRebind) {
          const ts = nowTs()
          db.prepare(`
            UPDATE file
            SET assetId = ?, fileMtimeMs = ?, lastSeenAt = ?, updatedAt = ?
            WHERE id = ?
          `).run(nextAsset.id, toFileMtimeMs(statResult), ts, ts, row.fileId)
          if (row.assetId !== nextAsset.id) {
            touchedOldAssetIds.push(row.assetId)
          }
        }
        continue
      } catch (error) {
        if (!isSkippableFsError(error)) {
          throw error
        }
      }
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
        fileSizeBytes: Number(row.assetSize),
        fileMtimeMs: Number(row.fileMtimeMs),
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
        const candidateIdentity = await computeFingerprintsForFile(candidate.absolutePath, {
          exactEnabled: false,
          similarImageEnabled: false,
        }, candidate.stat)
        if (
          candidateIdentity.size === Number(row.assetSize)
          && candidateIdentity.fpMethod === row.fpMethod
          && candidateIdentity.fingerprint === row.fingerprint
        ) {
          matchedCandidates.push(candidate)
        }
      } catch (error) {
        if (isSkippableFsError(error)) continue
        throw error
      }
    }

    if (matchedCandidates.length === 1) {
      const [matched] = matchedCandidates
      const occupier = getFileByAbsolutePath(db, matched.absolutePath)
      if (occupier?.id && occupier.id !== row.fileId) {
        item.status = 'conflict'
        item.reason = 'ambiguous_rebind'
        conflict += 1
        items.push(item)
        continue
      }

      item.resolvedAbsolutePath = matched.absolutePath
      item.resolvedRelativePath = toRelativePathWithinRoot(rootPath, matched.absolutePath)
      item.rebound = matched.absolutePath !== row.absolutePath
      if (item.rebound) {
        rebound += 1
      }
      active += 1
      items.push(item)

      if (applyRebind) {
        const ts = nowTs()
        db.prepare(`
          UPDATE file
          SET absolutePath = ?, fileMtimeMs = ?, lastSeenAt = ?, updatedAt = ?
          WHERE id = ?
        `).run(
          matched.absolutePath,
          toFileMtimeMs(matched.stat),
          ts,
          ts,
          row.fileId
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

  if (applyRebind && touchedOldAssetIds.length > 0) {
    softDeleteAssetsIfOrphaned(db, touchedOldAssetIds)
    refreshPersonCache(db)
    cleanupEmptyPeople(db)
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
      WHERE id = ?
    `).run(mapping.tempAbsolutePath, ts, mapping.fileId)
  }

  for (const mapping of stagedMappings) {
    db.prepare(`
      UPDATE file
      SET absolutePath = ?, fileMtimeMs = ?, lastSeenAt = ?, updatedAt = ?
      WHERE id = ?
    `).run(mapping.toAbsolutePath, mapping.fileMtimeMs, ts, ts, mapping.fileId)
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
          SELECT id, absolutePath, fileMtimeMs
          FROM file
          WHERE absolutePath IN (${validSourcePaths.map(() => '?').join(',')})
        `).all(...validSourcePaths)
        : []
      const sourceByPath = new Map(sourceRows.map((row) => [row.absolutePath, row]))

      const targetRows = validTargetPaths.length > 0
        ? db.prepare(`
          SELECT id, absolutePath
          FROM file
          WHERE absolutePath IN (${validTargetPaths.map(() => '?').join(',')})
        `).all(...validTargetPaths)
        : []
      const targetByPath = new Map(targetRows.map((row) => [row.absolutePath, row]))
      const movingFileIdSet = new Set(sourceRows.map((row) => row.id))

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
        if (targetRow && !movingFileIdSet.has(targetRow.id)) {
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

        item.fileId = sourceRow.id
        executableMappings.push({
          fileId: sourceRow.id,
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
  return withDb(async (db) => (
    withTransaction(db, async () => evaluateFileBindingRows(db, rootPath, { applyRebind: true }))
  ))
}

export async function refreshFileBindings(params) {
  return reconcileFileBindings(params)
}

export async function cleanupInvalidFileIds(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const confirm = params.confirm === true

  return withDb(async (db) => (
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

      const assetRows = invalidFileIds.length > 0
        ? db.prepare(`
          SELECT DISTINCT assetId
          FROM file
          WHERE id IN (${invalidFileIds.map(() => '?').join(',')})
        `).all(...invalidFileIds)
        : []
      const affectedAssetIds = assetRows.map((row) => row.assetId)

      const placeholders = invalidFileIds.map(() => '?').join(',')
      const cursor = db.prepare(`DELETE FROM file WHERE id IN (${placeholders})`).run(...invalidFileIds)
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
        invalidFileIds,
        impact,
        removed,
      }
    })
  ))
}
