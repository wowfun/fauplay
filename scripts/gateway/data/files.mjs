import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  GLOBAL_CONFIG_DIR,
  computeFingerprintsForFile,
  normalizeRelativePath,
  nowTs,
  pathMatchesRoot,
  resolveRootPath,
  resolvePathWithinRoot,
  statPath,
  toDisplayPath,
  toFileMtimeMs,
  toRelativePathWithinRoot,
} from './common.mjs'
import {
  ensureFileEntry,
  withDb,
} from './storage.mjs'

const SEARCH_SCOPE_VALUES = new Set(['global', 'root'])
const TEXT_PREVIEW_DEFAULT_SIZE_LIMIT_BYTES = 1024 * 1024
const PREVIEW_KIND_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
const PREVIEW_KIND_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'])
const PREVIEW_KIND_TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'xml',
  'csv',
  'log',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'py',
  'sh',
  'bash',
  'zsh',
  'ini',
  'conf',
  'toml',
  'sql',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'java',
  'go',
  'rs',
  'vue',
  'svelte',
])
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  ogg: 'video/ogg',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  csv: 'text/csv',
  log: 'text/plain',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  css: 'text/css',
  scss: 'text/x-scss',
  less: 'text/x-less',
  html: 'text/html',
  htm: 'text/html',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  ini: 'text/plain',
  conf: 'text/plain',
  toml: 'application/toml',
  sql: 'application/sql',
  c: 'text/x-c',
  cc: 'text/x-c++',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  hpp: 'text/x-c++',
  java: 'text/x-java-source',
  go: 'text/x-go',
  rs: 'text/x-rust',
}
const GLOBAL_RECYCLE_DIR = path.join(GLOBAL_CONFIG_DIR, 'recycle')
const GLOBAL_RECYCLE_FILES_DIR = path.join(GLOBAL_RECYCLE_DIR, 'files')
const GLOBAL_RECYCLE_META_PATH = path.join(GLOBAL_RECYCLE_DIR, 'items.json')

function resolveSearchScope(value) {
  if (typeof value === 'undefined' || value === null || value === '') {
    return 'global'
  }
  if (!SEARCH_SCOPE_VALUES.has(value)) {
    throw new Error('searchScope must be "global" or "root"')
  }
  return value
}

function normalizeRelativePathList(input, fieldName = 'relativePaths') {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string[]`)
  }

  const unique = new Set()
  const paths = []
  for (const item of input) {
    const normalized = normalizeRelativePath(item, fieldName)
    if (unique.has(normalized)) continue
    unique.add(normalized)
    paths.push(normalized)
  }
  return paths
}

function resolveAbsolutePathInput(input, fieldName = 'absolutePath') {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`${fieldName} is required`)
  }
  return resolveRootPath(input)
}

function resolveAbsolutePathList(input, fieldName = 'absolutePaths') {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string[]`)
  }
  const unique = new Set()
  const paths = []
  for (const item of input) {
    const normalized = resolveAbsolutePathInput(item, fieldName)
    if (unique.has(normalized)) continue
    unique.add(normalized)
    paths.push(normalized)
  }
  return paths
}

function getFileExtension(name) {
  return String(name || '').split('.').pop()?.toLowerCase() || ''
}

function getPreviewKind(name) {
  const ext = getFileExtension(name)
  if (PREVIEW_KIND_IMAGE_EXTS.has(ext)) return 'image'
  if (PREVIEW_KIND_VIDEO_EXTS.has(ext)) return 'video'
  if (PREVIEW_KIND_TEXT_EXTS.has(ext)) return 'text'
  return 'unsupported'
}

function getMimeType(name) {
  return MIME_BY_EXTENSION[getFileExtension(name)] || 'application/octet-stream'
}

function identityKey(identity) {
  return `${identity.size}:${identity.fingerprint}:${identity.fpMethod}`
}

function toAssetIdentity(snapshot) {
  return {
    size: Number(snapshot.size ?? 0),
    fingerprint: String(snapshot.fingerprint || ''),
    fpMethod: String(snapshot.fpMethod || ''),
  }
}

function isIdentityEqual(left, right) {
  return identityKey(left) === identityKey(right)
}

function containsNullByte(buffer) {
  for (const byte of buffer) {
    if (byte === 0) {
      return true
    }
  }
  return false
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function statExistingFile(targetPath) {
  try {
    const result = await statPath(targetPath)
    return result.isFile() ? result : null
  } catch {
    return null
  }
}

function getIndexedFileSnapshot(db, absolutePath) {
  return db.prepare(`
    SELECT
      file.absolutePath AS absolutePath,
      file.assetId AS assetId,
      file.fileMtimeMs AS fileMtimeMs,
      asset.size AS size,
      asset.fingerprint AS fingerprint,
      asset.fpMethod AS fpMethod
    FROM file
    JOIN asset ON asset.id = file.assetId
    WHERE file.absolutePath = ?
  `).get(absolutePath) ?? null
}

function listIndexedFilesByAssetId(db, assetId) {
  return db.prepare(`
    SELECT
      file.absolutePath AS absolutePath,
      file.assetId AS assetId,
      file.fileMtimeMs AS fileMtimeMs,
      asset.size AS size,
      asset.fingerprint AS fingerprint,
      asset.fpMethod AS fpMethod
    FROM file
    JOIN asset ON asset.id = file.assetId
    WHERE file.assetId = ?
  `).all(assetId)
}

async function resolveSnapshotStatus(snapshot, absolutePath) {
  const statResult = await statExistingFile(absolutePath)
  if (!statResult) {
    return {
      statResult: null,
      status: 'missing',
    }
  }

  if (!snapshot) {
    return {
      statResult,
      status: 'missing',
    }
  }

  return {
    statResult,
    status: toFileMtimeMs(statResult) === Number(snapshot.fileMtimeMs ?? -1) ? 'fresh' : 'stale',
  }
}

async function resolveCurrentIdentity(absolutePath, snapshot, statResult) {
  if (!statResult) return null
  if (snapshot && toFileMtimeMs(statResult) === Number(snapshot.fileMtimeMs ?? -1)) {
    return toAssetIdentity(snapshot)
  }
  return computeFingerprintsForFile(absolutePath, {
    exactEnabled: false,
    similarImageEnabled: false,
  }, statResult)
}

async function buildProjectionFileItem({
  absolutePath,
  statResult,
  currentRootPath = null,
  groupId = null,
  groupRank = null,
  isCurrentFile = false,
  sourceType = 'duplicate_file',
  deletedAt = null,
  recycleId = null,
  originalAbsolutePath = null,
}) {
  const normalizedAbsolutePath = resolveAbsolutePathInput(absolutePath)
  const resolvedStat = statResult ?? await statPath(normalizedAbsolutePath)
  const name = path.basename(normalizedAbsolutePath)
  const sourceRelativePath = currentRootPath
    ? toRelativePathWithinRoot(currentRootPath, normalizedAbsolutePath)
    : null
  const filePath = sourceRelativePath || normalizedAbsolutePath
  const fileLastModifiedMs = toFileMtimeMs(resolvedStat)

  return {
    path: filePath,
    absolutePath: normalizedAbsolutePath,
    name,
    kind: 'file',
    size: Number(resolvedStat.size) || 0,
    lastModifiedMs: fileLastModifiedMs,
    mimeType: getMimeType(name),
    previewKind: getPreviewKind(name),
    displayPath: currentRootPath ? toDisplayPath(currentRootPath, normalizedAbsolutePath) : normalizedAbsolutePath,
    sourceType,
    ...(currentRootPath ? { sourceRootPath: currentRootPath } : {}),
    ...(sourceRelativePath ? { sourceRelativePath } : {}),
    ...(groupId ? { groupId } : {}),
    ...(typeof groupRank === 'number' ? { groupRank } : {}),
    ...(isCurrentFile ? { isCurrentFile: true } : {}),
    ...(typeof deletedAt === 'number' ? { deletedAt } : {}),
    ...(recycleId ? { recycleId } : {}),
    ...(originalAbsolutePath ? { originalAbsolutePath } : {}),
  }
}

function compareProjectionItemByDisplayPath(left, right) {
  const leftDisplayPath = String(left.displayPath || left.absolutePath || '')
  const rightDisplayPath = String(right.displayPath || right.absolutePath || '')
  const leftLastModified = Number(left.lastModifiedMs ?? 0)
  const rightLastModified = Number(right.lastModifiedMs ?? 0)
  if (leftLastModified !== rightLastModified) {
    return rightLastModified - leftLastModified
  }
  return leftDisplayPath.localeCompare(rightDisplayPath)
}

async function buildVerifiedDuplicateItems({
  db,
  seedAbsolutePath,
  seedSnapshot,
  seedStatus,
  currentRootPath,
  searchScope,
}) {
  const { statResult: seedStatResult } = await resolveSnapshotStatus(seedSnapshot, seedAbsolutePath)
  if (!seedSnapshot || !seedStatResult) {
    return {
      groupKey: null,
      assetId: null,
      items: [],
    }
  }

  const seedCurrentIdentity = await resolveCurrentIdentity(seedAbsolutePath, seedSnapshot, seedStatResult)
  if (!seedCurrentIdentity) {
    return {
      groupKey: null,
      assetId: null,
      items: [],
    }
  }

  const indexedCandidates = listIndexedFilesByAssetId(db, seedSnapshot.assetId)
  const verifiedItems = []
  const seenAbsolutePaths = new Set()
  for (const candidateSnapshot of indexedCandidates) {
    if (
      searchScope === 'root'
      && !pathMatchesRoot(currentRootPath, String(candidateSnapshot.absolutePath || ''))
    ) {
      continue
    }

    const candidateAbsolutePath = resolveAbsolutePathInput(candidateSnapshot.absolutePath)
    const candidateStat = await statExistingFile(candidateAbsolutePath)
    if (!candidateStat) continue

    const candidateCurrentIdentity = await resolveCurrentIdentity(
      candidateAbsolutePath,
      candidateSnapshot,
      candidateStat
    )
    if (!candidateCurrentIdentity || !isIdentityEqual(seedCurrentIdentity, candidateCurrentIdentity)) {
      continue
    }

    if (seenAbsolutePaths.has(candidateAbsolutePath)) continue
    seenAbsolutePaths.add(candidateAbsolutePath)
    verifiedItems.push({ absolutePath: candidateAbsolutePath, statResult: candidateStat })
  }

  const storedIdentity = toAssetIdentity(seedSnapshot)
  return {
    groupKey: isIdentityEqual(seedCurrentIdentity, storedIdentity)
      ? `asset:${seedSnapshot.assetId}`
      : `identity:${identityKey(seedCurrentIdentity)}`,
    assetId: seedSnapshot.assetId,
    items: verifiedItems,
    seedStatus,
  }
}

function makeProjectionId(prefix) {
  return `${prefix}:${Date.now()}`
}

export async function ensureFileEntries(payload = {}) {
  const rootPath = resolveRootPath(payload.rootPath)
  const relativePaths = normalizeRelativePathList(payload.relativePaths)

  return withDb(async (db) => {
    const items = []
    let indexed = 0
    let skipped = 0
    let failed = 0

    for (const relativePath of relativePaths) {
      const absolutePath = resolvePathWithinRoot(rootPath, relativePath)
      try {
        const statResult = await statPath(absolutePath)
        if (!statResult.isFile()) {
          failed += 1
          items.push({
            relativePath,
            ok: false,
            reasonCode: 'NOT_FILE',
            error: 'target path must be a file',
          })
          continue
        }

        const existing = getIndexedFileSnapshot(db, absolutePath)
        if (existing && Number(existing.fileMtimeMs ?? -1) === toFileMtimeMs(statResult)) {
          skipped += 1
          items.push({
            relativePath,
            ok: true,
            skipped: true,
            reasonCode: 'INDEX_FRESH',
          })
          continue
        }

        const result = await ensureFileEntry(db, rootPath, relativePath)
        indexed += 1
        items.push({
          relativePath,
          ok: true,
          skipped: false,
          assetId: result.assetId,
          absolutePath: result.absolutePath,
          fileMtimeMs: result.fileMtimeMs,
        })
      } catch (error) {
        failed += 1
        items.push({
          relativePath,
          ok: false,
          reasonCode: 'INDEX_FAILED',
          error: error instanceof Error ? error.message : 'index failed',
        })
      }
    }

    return {
      ok: true,
      total: relativePaths.length,
      indexed,
      skipped,
      failed,
      items,
    }
  })
}

export async function queryDuplicateFiles(payload = {}) {
  const rootPath = resolveRootPath(payload.rootPath)
  const searchScope = resolveSearchScope(payload.searchScope)
  const hasRelativePath = typeof payload.relativePath === 'string' && payload.relativePath.trim()
  const hasRelativePaths = Array.isArray(payload.relativePaths)

  if (hasRelativePath && hasRelativePaths) {
    throw new Error('relativePath and relativePaths are mutually exclusive')
  }
  if (!hasRelativePath && !hasRelativePaths) {
    throw new Error('relativePath or relativePaths is required')
  }

  return withDb(async (db) => {
    if (hasRelativePath) {
      const relativePath = normalizeRelativePath(payload.relativePath)
      const absolutePath = resolvePathWithinRoot(rootPath, relativePath)
      const indexedSnapshot = getIndexedFileSnapshot(db, absolutePath)
      const { status } = await resolveSnapshotStatus(indexedSnapshot, absolutePath)

      let targetStatus = 'fresh'
      if (status !== 'fresh') {
        await ensureFileEntry(db, rootPath, relativePath)
        targetStatus = 'reindexed'
      }

      const freshSnapshot = getIndexedFileSnapshot(db, absolutePath)
      if (!freshSnapshot) {
        throw new Error('failed to resolve indexed file snapshot')
      }

      const verified = await buildVerifiedDuplicateItems({
        db,
        seedAbsolutePath: absolutePath,
        seedSnapshot: freshSnapshot,
        seedStatus: 'fresh',
        currentRootPath: rootPath,
        searchScope,
      })

      const projectionItems = await Promise.all(
        verified.items.map(async ({ absolutePath: candidateAbsolutePath, statResult }) => (
          buildProjectionFileItem({
            absolutePath: candidateAbsolutePath,
            statResult,
            currentRootPath: rootPath,
            isCurrentFile: candidateAbsolutePath === absolutePath,
          })
        ))
      )

      const target = projectionItems.find((item) => item.absolutePath === absolutePath) ?? await buildProjectionFileItem({
        absolutePath,
        currentRootPath: rootPath,
        isCurrentFile: true,
      })
      const duplicates = projectionItems
        .filter((item) => item.absolutePath !== absolutePath)
        .sort((left, right) => {
          const leftPriority = pathMatchesRoot(rootPath, left.absolutePath) ? 0 : 1
          const rightPriority = pathMatchesRoot(rootPath, right.absolutePath) ? 0 : 1
          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority
          }
          return compareProjectionItemByDisplayPath(left, right)
        })

      return {
        ok: true,
        mode: 'file',
        searchScope,
        target,
        duplicateCount: duplicates.length,
        duplicates,
        indexing: {
          strategy: 'implicit_current_file',
          targetStatus,
        },
        ...(duplicates.length > 0
          ? {
            projection: {
              id: makeProjectionId('duplicates:file'),
              title: '重复文件',
              entry: 'auto',
              ordering: {
                mode: 'listed',
                keys: ['isCurrentFile:desc', 'lastModifiedMs:desc', 'displayPath:asc'],
              },
              files: [target, ...duplicates],
            },
          }
          : {}),
      }
    }

    const relativePaths = normalizeRelativePathList(payload.relativePaths)
    const skippedSeeds = []
    const groupMap = new Map()
    let indexedSeedCount = 0
    let needsIndexingCount = 0
    let nextGroupRank = 0

    for (const relativePath of relativePaths) {
      const absolutePath = resolvePathWithinRoot(rootPath, relativePath)
      try {
        const rawStatResult = await statPath(absolutePath)
        if (!rawStatResult.isFile()) {
          skippedSeeds.push({
            relativePath,
            reasonCode: 'NOT_FILE',
          })
          continue
        }
      } catch {
        // Missing files continue through indexed-status handling below.
      }
      const snapshot = getIndexedFileSnapshot(db, absolutePath)
      const { status, statResult } = await resolveSnapshotStatus(snapshot, absolutePath)

      if (!statResult) {
        needsIndexingCount += 1
        skippedSeeds.push({
          relativePath,
          reasonCode: snapshot ? 'STALE_INDEX' : 'MISSING_INDEX',
        })
        continue
      }

      if (!statResult.isFile()) {
        skippedSeeds.push({
          relativePath,
          reasonCode: 'NOT_FILE',
        })
        continue
      }

      if (!snapshot) {
        needsIndexingCount += 1
        skippedSeeds.push({
          relativePath,
          reasonCode: 'MISSING_INDEX',
        })
        continue
      }

      if (status === 'fresh') {
        indexedSeedCount += 1
      } else {
        needsIndexingCount += 1
        skippedSeeds.push({
          relativePath,
          reasonCode: 'STALE_INDEX',
        })
      }

      const verified = await buildVerifiedDuplicateItems({
        db,
        seedAbsolutePath: absolutePath,
        seedSnapshot: snapshot,
        seedStatus: status,
        currentRootPath: rootPath,
        searchScope,
      })
      if (!verified.groupKey || verified.items.length <= 1) {
        continue
      }

      let group = groupMap.get(verified.groupKey)
      if (!group) {
        group = {
          groupId: verified.groupKey,
          assetId: verified.assetId,
          seedRelativePaths: new Set(),
          itemsByAbsolutePath: new Map(),
          groupRank: nextGroupRank,
        }
        groupMap.set(verified.groupKey, group)
        nextGroupRank += 1
      }

      group.seedRelativePaths.add(relativePath)
      for (const item of verified.items) {
        if (group.itemsByAbsolutePath.has(item.absolutePath)) continue
        const projectionItem = await buildProjectionFileItem({
          absolutePath: item.absolutePath,
          statResult: item.statResult,
          currentRootPath: rootPath,
          groupId: group.groupId,
          groupRank: group.groupRank,
        })
        group.itemsByAbsolutePath.set(item.absolutePath, projectionItem)
      }
    }

    const groups = [...groupMap.values()]
      .map((group) => {
        const items = [...group.itemsByAbsolutePath.values()].sort(compareProjectionItemByDisplayPath)
        return {
          groupId: group.groupId,
          assetId: group.assetId,
          seedRelativePaths: [...group.seedRelativePaths].sort((left, right) => left.localeCompare(right)),
          items,
        }
      })
      .filter((group) => group.items.length > 1)
      .sort((left, right) => {
        const leftRank = Number(left.items[0]?.groupRank ?? 0)
        const rightRank = Number(right.items[0]?.groupRank ?? 0)
        return leftRank - rightRank
      })

    const projectionFiles = groups.flatMap((group, groupRank) => (
      group.items.map((item) => ({
        ...item,
        groupRank,
      }))
    ))

    return {
      ok: true,
      mode: 'workspace',
      searchScope,
      seedCount: relativePaths.length,
      indexedSeedCount,
      needsIndexingCount,
      skippedSeeds,
      duplicateGroupCount: groups.length,
      groups,
      ...(projectionFiles.length > 0
        ? {
          projection: {
            id: makeProjectionId('duplicates:workspace'),
            title: '重复文件',
            entry: 'auto',
            ordering: {
              mode: 'group_contiguous',
              keys: ['groupRank:asc', 'lastModifiedMs:desc', 'displayPath:asc'],
            },
            files: projectionFiles,
          },
        }
        : {}),
    }
  })
}

async function ensureGlobalRecycleStorage() {
  await fs.mkdir(GLOBAL_RECYCLE_FILES_DIR, { recursive: true })
}

async function readGlobalRecycleMeta() {
  await ensureGlobalRecycleStorage()
  try {
    const raw = await fs.readFile(GLOBAL_RECYCLE_META_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item) => item && typeof item === 'object')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function writeGlobalRecycleMeta(items) {
  await ensureGlobalRecycleStorage()
  await fs.writeFile(GLOBAL_RECYCLE_META_PATH, JSON.stringify(items, null, 2), 'utf8')
}

async function allocateRestorePath(candidateAbsolutePath) {
  const normalizedCandidate = resolveAbsolutePathInput(candidateAbsolutePath)
  if (!(await pathExists(normalizedCandidate))) {
    return normalizedCandidate
  }

  const parsed = path.parse(normalizedCandidate)
  let suffix = 1
  while (true) {
    const nextPath = path.join(parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`)
    if (!(await pathExists(nextPath))) {
      return nextPath
    }
    suffix += 1
  }
}

async function listRootTrashItems(rootPath) {
  const normalizedRootPath = rootPath ? resolveRootPath(rootPath) : null
  if (!normalizedRootPath) return []

  const trashRoot = path.join(normalizedRootPath, '.trash')
  if (!(await pathExists(trashRoot))) {
    return []
  }

  const items = []
  const stack = [trashRoot]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }

      const statResult = await statPath(absolutePath)
      const relativePath = toRelativePathWithinRoot(normalizedRootPath, absolutePath) ?? absolutePath
      items.push({
        path: relativePath,
        absolutePath,
        name: entry.name,
        kind: 'file',
        size: Number(statResult.size) || 0,
        lastModifiedMs: toFileMtimeMs(statResult),
        mimeType: getMimeType(entry.name),
        previewKind: getPreviewKind(entry.name),
        displayPath: relativePath,
        deletedAt: toFileMtimeMs(statResult),
        sourceType: 'root_trash',
        sourceRootPath: normalizedRootPath,
        sourceRelativePath: relativePath,
        originalAbsolutePath: path.join(
          normalizedRootPath,
          relativePath.replace(/^\.trash\/?/, '')
        ),
      })
    }
  }

  return items
}

export async function moveFilesToRecycle(payload = {}) {
  const absolutePaths = resolveAbsolutePathList(payload.absolutePaths)
  const items = []
  let moved = 0
  let failed = 0

  const metaItems = await readGlobalRecycleMeta()

  for (const absolutePath of absolutePaths) {
    try {
      const statResult = await statPath(absolutePath)
      if (!statResult.isFile()) {
        failed += 1
        items.push({
          absolutePath,
          ok: false,
          reasonCode: 'NOT_FILE',
          error: 'target path must be a file',
        })
        continue
      }

      const recycleId = randomUUID()
      const ext = path.extname(absolutePath)
      const storedAbsolutePath = path.join(GLOBAL_RECYCLE_FILES_DIR, `${recycleId}${ext}`)
      const deletedAt = nowTs()

      await fs.rename(absolutePath, storedAbsolutePath)

      metaItems.push({
        recycleId,
        storedAbsolutePath,
        originalAbsolutePath: absolutePath,
        originalRootPath: null,
        name: path.basename(absolutePath),
        size: Number(statResult.size) || 0,
        mimeType: getMimeType(path.basename(absolutePath)),
        deletedAt,
        createdAt: deletedAt,
        updatedAt: deletedAt,
      })

      moved += 1
      items.push({
        absolutePath,
        ok: true,
        recycleId,
        deletedAt,
      })
    } catch (error) {
      failed += 1
      items.push({
        absolutePath,
        ok: false,
        reasonCode: 'MOVE_FAILED',
        error: error instanceof Error ? error.message : 'failed to move file into recycle',
      })
    }
  }

  await writeGlobalRecycleMeta(metaItems)

  return {
    ok: true,
    total: absolutePaths.length,
    moved,
    failed,
    items,
  }
}

export async function listRecycleItems(payload = {}) {
  const rootPath = typeof payload.rootPath === 'string' && payload.rootPath.trim()
    ? resolveRootPath(payload.rootPath)
    : null
  const includeRootTrash = payload.includeRootTrash !== false
  const includeGlobalRecycle = payload.includeGlobalRecycle !== false

  const items = []
  if (includeRootTrash && rootPath) {
    items.push(...await listRootTrashItems(rootPath))
  }

  if (includeGlobalRecycle) {
    const metaItems = await readGlobalRecycleMeta()
    for (const item of metaItems) {
      const storedAbsolutePath = resolveAbsolutePathInput(item.storedAbsolutePath, 'storedAbsolutePath')
      const statResult = await statExistingFile(storedAbsolutePath)
      if (!statResult) {
        continue
      }
      items.push({
        path: storedAbsolutePath,
        absolutePath: storedAbsolutePath,
        name: String(item.name || path.basename(storedAbsolutePath)),
        kind: 'file',
        size: Number(item.size ?? statResult.size) || 0,
        lastModifiedMs: toFileMtimeMs(statResult),
        mimeType: String(item.mimeType || getMimeType(item.name || storedAbsolutePath)),
        previewKind: getPreviewKind(String(item.name || storedAbsolutePath)),
        displayPath: String(item.originalAbsolutePath || storedAbsolutePath),
        deletedAt: Number(item.deletedAt ?? 0) || 0,
        sourceType: 'global_recycle',
        recycleId: String(item.recycleId || ''),
        originalAbsolutePath: String(item.originalAbsolutePath || ''),
      })
    }
  }

  items.sort((left, right) => {
    const leftDeletedAt = Number(left.deletedAt ?? 0)
    const rightDeletedAt = Number(right.deletedAt ?? 0)
    if (leftDeletedAt !== rightDeletedAt) {
      return rightDeletedAt - leftDeletedAt
    }
    return String(left.sourceType || '').localeCompare(String(right.sourceType || ''))
  })

  return {
    ok: true,
    items,
    ordering: {
      mode: 'mixed',
      keys: ['deletedAt:desc', 'sourceType:asc'],
    },
  }
}

export async function restoreRecycleItems(payload = {}) {
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error('items must be a non-empty array')
  }

  const requestItems = payload.items
  const metaItems = await readGlobalRecycleMeta()
  const nextMetaItems = [...metaItems]
  const resultItems = []
  let restored = 0
  let failed = 0

  for (const item of requestItems) {
    const sourceType = typeof item?.sourceType === 'string' ? item.sourceType : ''
    if (sourceType !== 'root_trash' && sourceType !== 'global_recycle') {
      failed += 1
      resultItems.push({
        sourceType,
        ok: false,
        reasonCode: 'INVALID_SOURCE_TYPE',
        error: 'sourceType must be root_trash or global_recycle',
      })
      continue
    }

    if (sourceType === 'root_trash') {
      try {
        const absolutePath = resolveAbsolutePathInput(item.absolutePath)
        if (!absolutePath.includes('/.trash/')) {
          throw new Error('root trash item must live under .trash')
        }
        const restoredAbsolutePath = await allocateRestorePath(
          absolutePath.replace('/.trash/', '/')
        )
        await fs.mkdir(path.dirname(restoredAbsolutePath), { recursive: true })
        await fs.rename(absolutePath, restoredAbsolutePath)
        restored += 1
        resultItems.push({
          sourceType,
          ok: true,
          nextAbsolutePath: restoredAbsolutePath,
        })
      } catch (error) {
        failed += 1
        resultItems.push({
          sourceType,
          ok: false,
          reasonCode: 'RESTORE_FAILED',
          error: error instanceof Error ? error.message : 'restore failed',
        })
      }
      continue
    }

    const recycleId = typeof item?.recycleId === 'string' ? item.recycleId.trim() : ''
    const metaIndex = nextMetaItems.findIndex((entry) => String(entry.recycleId || '') === recycleId)
    if (!recycleId || metaIndex < 0) {
      failed += 1
      resultItems.push({
        sourceType,
        ok: false,
        reasonCode: 'RECYCLE_ITEM_NOT_FOUND',
        error: 'global recycle item not found',
      })
      continue
    }

    const metaEntry = nextMetaItems[metaIndex]
    try {
      const sourceAbsolutePath = resolveAbsolutePathInput(metaEntry.storedAbsolutePath, 'storedAbsolutePath')
      const targetAbsolutePath = await allocateRestorePath(
        resolveAbsolutePathInput(metaEntry.originalAbsolutePath, 'originalAbsolutePath')
      )
      await fs.mkdir(path.dirname(targetAbsolutePath), { recursive: true })
      await fs.rename(sourceAbsolutePath, targetAbsolutePath)
      nextMetaItems.splice(metaIndex, 1)
      restored += 1
      resultItems.push({
        sourceType,
        ok: true,
        nextAbsolutePath: targetAbsolutePath,
      })
    } catch (error) {
      failed += 1
      resultItems.push({
        sourceType,
        ok: false,
        reasonCode: 'RESTORE_FAILED',
        error: error instanceof Error ? error.message : 'restore failed',
      })
    }
  }

  await writeGlobalRecycleMeta(nextMetaItems)

  return {
    ok: true,
    total: requestItems.length,
    restored,
    failed,
    items: resultItems,
  }
}

export async function readFileContentByAbsolutePath(payload = {}) {
  const absolutePath = resolveAbsolutePathInput(payload.absolutePath)
  const body = await fs.readFile(absolutePath)
  return {
    body,
    contentType: getMimeType(path.basename(absolutePath)),
  }
}

export async function readFileTextPreview(payload = {}) {
  const absolutePath = resolveAbsolutePathInput(payload.absolutePath)
  const statResult = await statPath(absolutePath)
  if (!statResult.isFile()) {
    throw new Error('absolutePath must point to a file')
  }

  const sizeLimitBytes = Math.max(
    1,
    Number.isFinite(Number(payload.sizeLimitBytes))
      ? Math.trunc(Number(payload.sizeLimitBytes))
      : TEXT_PREVIEW_DEFAULT_SIZE_LIMIT_BYTES
  )
  const fileSizeBytes = Number(statResult.size) || 0
  if (fileSizeBytes > sizeLimitBytes) {
    return {
      ok: true,
      status: 'too_large',
      content: null,
      fileSizeBytes,
      sizeLimitBytes,
      error: null,
    }
  }

  const body = await fs.readFile(absolutePath)
  if (containsNullByte(body)) {
    return {
      ok: true,
      status: 'binary',
      content: null,
      fileSizeBytes,
      sizeLimitBytes,
      error: null,
    }
  }

  return {
    ok: true,
    status: 'ready',
    content: body.toString('utf8'),
    fileSizeBytes,
    sizeLimitBytes,
    error: null,
  }
}
