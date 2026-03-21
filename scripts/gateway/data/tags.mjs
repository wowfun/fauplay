import {
  ANNOTATION_SOURCE,
  CLASSIFY_SOURCE,
  UNANNOTATED_TAG_KEY,
  nowTs,
  resolveRootPath,
  resolveOptionalRootPath,
  normalizeRelativePath,
  toRelativePathWithinRoot,
  buildPathScopeClause,
  parseInteger,
  buildTagKey,
  toTagDto,
  parseFiniteNumber,
} from './common.mjs'
import {
  withDb,
  withTransaction,
  ensureFileEntry,
  getAssetById,
  getFileById,
  resolveFileByRootRelativePath,
  bindTagToAsset,
  removeTagBindingsForAsset,
  cleanupOrphanTags,
} from './storage.mjs'

function buildFileResponse(file, rootPath = null) {
  return {
    fileId: file.id,
    assetId: file.assetId,
    absolutePath: file.absolutePath,
    relativePath: rootPath ? toRelativePathWithinRoot(rootPath, file.absolutePath) : null,
  }
}

function fileMatchesTag(tagSet, tagKey) {
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
      ? includeTagKeys.every((tagKey) => fileMatchesTag(tagSet, tagKey))
      : includeTagKeys.some((tagKey) => fileMatchesTag(tagSet, tagKey))

  if (!includeMatched) return false
  return !excludeTagKeys.some((tagKey) => fileMatchesTag(tagSet, tagKey))
}

export async function setAnnotationValue(params) {
  const rootPath = resolveRootPath(params.rootPath)
  const relativePath = normalizeRelativePath(params.relativePath, 'relativePath')
  const fieldKey = typeof params.fieldKey === 'string' ? params.fieldKey.trim() : ''
  const value = typeof params.value === 'string' ? params.value.trim() : ''
  const source = params.source === 'hotkey' ? 'hotkey' : 'click'

  if (!fieldKey) throw new Error('fieldKey is required')
  if (!value) throw new Error('value is required')

  return withDb(async (db) => (
    withTransaction(db, async () => {
      const file = await ensureFileEntry(db, rootPath, relativePath)
      const appliedAt = nowTs()

      removeTagBindingsForAsset(db, {
        assetId: file.assetId,
        source: ANNOTATION_SOURCE,
        key: fieldKey,
      })
      cleanupOrphanTags(db, ANNOTATION_SOURCE)

      bindTagToAsset(db, {
        assetId: file.assetId,
        key: fieldKey,
        value,
        source: ANNOTATION_SOURCE,
        appliedAt,
        score: null,
      })

      return {
        ok: true,
        fileId: file.id,
        assetId: file.assetId,
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
  const rootPath = resolveOptionalRootPath(params.rootPath)
  const fileId = typeof params.fileId === 'string' ? params.fileId : null
  const relativePath = typeof params.relativePath === 'string' && params.relativePath.trim()
    ? normalizeRelativePath(params.relativePath)
    : null

  return withDb(async (db) => {
    let file = null
    if (fileId) {
      file = getFileById(db, fileId)
    } else if (rootPath && relativePath) {
      file = resolveFileByRootRelativePath(db, rootPath, relativePath)
    }

    if (!file) {
      return {
        ok: true,
        file: null,
      }
    }

    const asset = getAssetById(db, file.assetId)
    if (!asset || asset.deletedAt !== null) {
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
        asset_tag.appliedAt AS appliedAt,
        asset_tag.score AS score
      FROM asset_tag
      INNER JOIN tag ON tag.id = asset_tag.tagId
      WHERE asset_tag.assetId = ?
      ORDER BY asset_tag.appliedAt DESC, tag.source ASC, tag.key ASC, tag.value ASC
    `).all(file.assetId)

    return {
      ok: true,
      file: {
        ...buildFileResponse(file, rootPath),
        tags: tagRows.map(toTagDto),
      },
    }
  })
}

export async function listTagOptions(params) {
  const rootPath = resolveOptionalRootPath(params.rootPath)

  return withDb(async (db) => {
    const { sql: scopeSql, params: scopeParams } = buildPathScopeClause('file.absolutePath', rootPath)
    const rows = db.prepare(`
      SELECT
        tag.key AS key,
        tag.value AS value,
        tag.source AS source,
        COUNT(DISTINCT file.id) AS fileCount
      FROM tag
      INNER JOIN asset_tag ON asset_tag.tagId = tag.id
      INNER JOIN asset ON asset.id = asset_tag.assetId
      INNER JOIN file ON file.assetId = asset.id
      WHERE asset.deletedAt IS NULL
        AND ${scopeSql}
      GROUP BY tag.source, tag.key, tag.value
      ORDER BY tag.source ASC, tag.key ASC, tag.value ASC
    `).all(...scopeParams)

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
  const rootPath = resolveOptionalRootPath(params.rootPath)
  const includeTagKeys = Array.isArray(params.includeTagKeys)
    ? params.includeTagKeys.filter((item) => typeof item === 'string')
    : []
  const excludeTagKeys = Array.isArray(params.excludeTagKeys)
    ? params.excludeTagKeys.filter((item) => typeof item === 'string')
    : []
  const includeMatchMode = params.includeMatchMode === 'and' ? 'and' : 'or'
  const page = Math.max(1, parseInteger(params.page, 1))
  const size = Math.min(5000, Math.max(1, parseInteger(params.size, 500)))

  return withDb(async (db) => {
    const { sql: scopeSql, params: scopeParams } = buildPathScopeClause('file.absolutePath', rootPath)
    const rows = db.prepare(`
      SELECT
        file.id AS fileId,
        file.assetId AS assetId,
        file.absolutePath AS absolutePath,
        tag.id AS tagId,
        tag.key AS key,
        tag.value AS value,
        tag.source AS source,
        asset_tag.appliedAt AS appliedAt,
        asset_tag.score AS score
      FROM file
      INNER JOIN asset ON asset.id = file.assetId
      LEFT JOIN asset_tag ON asset_tag.assetId = asset.id
      LEFT JOIN tag ON tag.id = asset_tag.tagId
      WHERE asset.deletedAt IS NULL
        AND ${scopeSql}
      ORDER BY file.absolutePath ASC
    `).all(...scopeParams)

    const byFile = new Map()
    for (const row of rows) {
      const fileId = row.fileId
      const existing = byFile.get(fileId) ?? {
        fileId,
        assetId: row.assetId,
        absolutePath: row.absolutePath,
        relativePath: rootPath ? toRelativePathWithinRoot(rootPath, row.absolutePath) : null,
        tags: [],
        updatedAt: 0,
      }
      if (row.tagId) {
        const dto = toTagDto(row)
        existing.tags.push(dto)
        existing.updatedAt = Math.max(existing.updatedAt, Number(dto.appliedAt ?? dto.updatedAt ?? 0))
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

    filtered.sort((left, right) => {
      const leftPath = left.relativePath ?? left.absolutePath
      const rightPath = right.relativePath ?? right.absolutePath
      return leftPath.localeCompare(rightPath)
    })

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

  return withDb(async (db) => (
    withTransaction(db, async () => {
      let ingested = 0
      for (const task of tasks) {
        let file = null
        try {
          file = await ensureFileEntry(db, rootPath, task.relativePath)
        } catch {
          continue
        }

        removeTagBindingsForAsset(db, {
          assetId: file.assetId,
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
          bindTagToAsset(db, {
            assetId: file.assetId,
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
