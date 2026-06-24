import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  nowTs,
  resolveRootPath,
  normalizeRelativePath,
  parseInteger,
} from './common.mjs'
import {
  withDb,
  withTransaction,
  ensureFileEntry,
} from './storage.mjs'

const FACE_SCAN_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico'])
const FACE_SCAN_VIDEO_EXTENSIONS = new Set([
  'avi',
  'flv',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'ogg',
  'ts',
  'webm',
  'wmv',
])
const FACE_SCAN_CLUSTER_LIMIT = 2000
const FACE_SCAN_CLUSTER_MIN_FACES = 3
const FACE_SCAN_BATCH_WEIGHT_BUDGET = 50
const FACE_SCAN_IMAGE_WEIGHT = 1
const FACE_SCAN_VIDEO_WEIGHT = 10
const FACE_SCAN_JOB_RECENT_ITEM_LIMIT = 20
const FACE_SCAN_JOB_FAILURE_SUMMARY_LIMIT = 20
const FACE_SCAN_JOB_ITEMS_DEFAULT_LIMIT = 100
const FACE_SCAN_JOB_ITEMS_MAX_LIMIT = 500
const FACE_SCAN_JOB_COMPLETED_RETAIN_LIMIT = 20

function normalizeFaceMediaType(value) {
  return value === 'video' ? 'video' : 'image'
}

export function getFaceScanMediaType(relativePath) {
  const extension = path.extname(relativePath).slice(1).toLowerCase()
  if (FACE_SCAN_VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (FACE_SCAN_IMAGE_EXTENSIONS.has(extension)) return 'image'
  return null
}

function normalizeRelativePathList(value) {
  if (!Array.isArray(value)) {
    throw new Error('relativePaths must be an array')
  }
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => normalizeRelativePath(item, 'relativePaths[]'))
}

function createFaceScanState() {
  return {
    seenPaths: new Set(),
  }
}

function createFaceScanSummary() {
  return {
    scanned: 0,
    skipped: 0,
    failed: 0,
    detectedFaces: 0,
  }
}

function applyFaceScanItemToSummary(summary, item) {
  if (item?.status === 'detected') {
    summary.scanned += 1
    summary.detectedFaces += Math.max(0, parseInteger(item.detected, 0))
    return
  }
  if (item?.status === 'skipped') {
    summary.skipped += 1
    return
  }
  if (item?.status === 'failed') {
    summary.failed += 1
  }
}

function getFaceScanItemWeight(relativePath) {
  return getFaceScanMediaType(relativePath) === 'video'
    ? FACE_SCAN_VIDEO_WEIGHT
    : FACE_SCAN_IMAGE_WEIGHT
}

function buildFaceScanWeightedBatches(relativePaths) {
  const batches = []
  let batch = []
  let weightUsed = 0

  for (const relativePath of relativePaths) {
    const itemWeight = Math.min(FACE_SCAN_BATCH_WEIGHT_BUDGET, getFaceScanItemWeight(relativePath))
    if (batch.length > 0 && weightUsed + itemWeight > FACE_SCAN_BATCH_WEIGHT_BUDGET) {
      batches.push(batch)
      batch = []
      weightUsed = 0
    }
    batch.push(relativePath)
    weightUsed += itemWeight
  }

  if (batch.length > 0) {
    batches.push(batch)
  }

  return batches
}

function toFaceScanJobFailureSummary(items) {
  return items
    .filter((item) => item?.status === 'failed' || item?.ok === false)
    .slice(-FACE_SCAN_JOB_FAILURE_SUMMARY_LIMIT)
    .map((item) => ({
      relativePath: item.relativePath,
      mediaType: item.mediaType ?? null,
      reasonCode: item.reasonCode ?? 'DETECT_FAILED',
      error: item.error ?? null,
    }))
}

function readFaceScanJobItemsPage(job, params = {}) {
  const offset = Math.max(0, parseInteger(params.offset ?? undefined, 0))
  const limit = Math.min(
    FACE_SCAN_JOB_ITEMS_MAX_LIMIT,
    Math.max(1, parseInteger(params.limit ?? undefined, FACE_SCAN_JOB_ITEMS_DEFAULT_LIMIT))
  )
  return {
    ok: true,
    jobId: job.id,
    total: job.items.length,
    offset,
    limit,
    items: job.items.slice(offset, offset + limit),
  }
}

function isFaceScanJobTerminal(job) {
  return job.status === 'canceled' || job.status === 'succeeded' || job.status === 'failed'
}

function touchFaceScanJob(job) {
  job.updatedAt = nowTs()
}

function toFaceScanJobSnapshot(job, options = {}) {
  const includeRecentItems = options.includeRecentItems !== false
  return {
    ok: job.status !== 'failed',
    jobId: job.id,
    status: job.status,
    total: job.total,
    unique: job.unique,
    processed: job.processed,
    scanned: job.scanned,
    skipped: job.skipped,
    failed: job.failed,
    detectedFaces: job.detectedFaces,
    currentPath: job.currentPath,
    batchIndex: job.batchIndex,
    batchCount: job.batchCount,
    preCluster: job.preCluster,
    postCluster: job.postCluster,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    recentItems: includeRecentItems ? job.items.slice(-FACE_SCAN_JOB_RECENT_ITEM_LIMIT) : [],
    failureSummary: toFaceScanJobFailureSummary(job.items),
  }
}

export function markAssetFaceDetection(db, { assetId, mediaType, status, faceCount = 0, error = null }) {
  if (typeof assetId !== 'string' || !assetId) return
  const ts = nowTs()
  db.prepare(`
    INSERT INTO asset_face_detection(assetId, mediaType, status, detectedAt, faceCount, error, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(assetId) DO UPDATE SET
      mediaType = excluded.mediaType,
      status = excluded.status,
      detectedAt = excluded.detectedAt,
      faceCount = excluded.faceCount,
      error = excluded.error,
      updatedAt = excluded.updatedAt
  `).run(
    assetId,
    normalizeFaceMediaType(mediaType),
    status === 'success' ? 'success' : 'failed',
    status === 'success' ? ts : null,
    Math.max(0, parseInteger(faceCount, 0)),
    typeof error === 'string' && error.trim() ? error.trim().slice(0, 500) : null,
    ts
  )
}

async function resolveFaceScanAsset(rootPath, relativePath, mediaType) {
  return withDb(async (db) => (
    withTransaction(db, async () => {
      const file = await ensureFileEntry(db, rootPath, relativePath)
      const detection = db.prepare(`
        SELECT status, faceCount, detectedAt
        FROM asset_face_detection
        WHERE assetId = ?
      `).get(file.assetId) ?? null
      return {
        assetId: file.assetId,
        mediaType,
        detection,
      }
    })
  ))
}

async function markFaceScanFailure(assetId, mediaType, error) {
  if (!assetId) return
  await withDb(async (db) => (
    withTransaction(db, async () => {
      markAssetFaceDetection(db, {
        assetId,
        mediaType,
        status: 'failed',
        error: error instanceof Error ? error.message : 'face detection failed',
      })
    })
  ))
}

export function createFaceScanRuntime({
  callVisionInference,
  clusterPendingFaces,
  saveDetectedFaces,
}) {
  const faceScanJobs = new Map()
  const faceScanJobQueue = []
  let activeFaceScanJobId = null

  function getFaceScanJobOrThrow(jobId) {
    const normalizedJobId = typeof jobId === 'string' ? jobId.trim() : ''
    const job = normalizedJobId ? faceScanJobs.get(normalizedJobId) : null
    if (!job) {
      const error = new Error('Face scan job not found')
      error.code = 'FACE_SCAN_JOB_NOT_FOUND'
      error.statusCode = 404
      throw error
    }
    return job
  }

  function pruneCompletedFaceScanJobs() {
    const completed = [...faceScanJobs.values()]
      .filter((job) => isFaceScanJobTerminal(job))
      .sort((a, b) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt))
    for (const job of completed.slice(FACE_SCAN_JOB_COMPLETED_RETAIN_LIMIT)) {
      faceScanJobs.delete(job.id)
    }
  }

  async function scanFaceAssetItem(runtime, params, state) {
    const { rootPath, relativePath, onlyUndetected } = params

    if (state.seenPaths.has(relativePath)) {
      return {
        ok: true,
        status: 'skipped',
        reasonCode: 'DUPLICATE_PATH',
        relativePath,
      }
    }
    state.seenPaths.add(relativePath)

    const mediaType = getFaceScanMediaType(relativePath)
    if (!mediaType) {
      return {
        ok: true,
        status: 'skipped',
        reasonCode: 'UNSUPPORTED_MEDIA',
        relativePath,
      }
    }

    let target = null
    try {
      target = await resolveFaceScanAsset(rootPath, relativePath, mediaType)
      if (onlyUndetected && target.detection?.status === 'success') {
        return {
          ok: true,
          status: 'skipped',
          reasonCode: 'ALREADY_DETECTED',
          relativePath,
          assetId: target.assetId,
          mediaType,
          faceCount: Number(target.detection.faceCount ?? 0),
        }
      }

      const inferred = await callVisionInference(runtime, {
        rootPath,
        relativePath,
      })
      const persisted = await saveDetectedFaces({
        rootPath: inferred.rootPath,
        relativePath: inferred.relativePath,
        facePayloads: inferred.faces,
      })

      return {
        ok: true,
        status: 'detected',
        relativePath,
        assetId: persisted.assetId,
        mediaType,
        detected: persisted.created,
        inferenceDetected: inferred.detected,
      }
    } catch (error) {
      if (target?.assetId) {
        try {
          await markFaceScanFailure(target.assetId, mediaType, error)
        } catch {
          // Keep the per-item error as the primary batch result.
        }
      }
      return {
        ok: false,
        status: 'failed',
        reasonCode: 'DETECT_FAILED',
        relativePath,
        ...(target?.assetId ? { assetId: target.assetId } : {}),
        mediaType,
        error: error instanceof Error ? error.message : '人脸检测失败',
      }
    }
  }

  async function runFaceScanJob(job) {
    if (job.cancelRequested) {
      job.status = 'canceled'
      job.finishedAt = nowTs()
      touchFaceScanJob(job)
      return
    }

    job.status = 'running'
    job.startedAt = nowTs()
    touchFaceScanJob(job)

    const state = createFaceScanState()
    try {
      if (job.preClusterEnabled) {
        job.preCluster = await clusterPendingFaces({
          limit: FACE_SCAN_CLUSTER_LIMIT,
          minFaces: FACE_SCAN_CLUSTER_MIN_FACES,
        })
        touchFaceScanJob(job)
      }

      const batches = buildFaceScanWeightedBatches(job.relativePaths)
      job.batchCount = batches.length
      touchFaceScanJob(job)

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        job.batchIndex = batchIndex + 1
        for (const relativePath of batches[batchIndex]) {
          if (job.cancelRequested) {
            job.status = 'canceled'
            job.currentPath = null
            job.finishedAt = nowTs()
            touchFaceScanJob(job)
            return
          }

          job.currentPath = relativePath
          touchFaceScanJob(job)
          const item = await scanFaceAssetItem(job.runtime, {
            rootPath: job.rootPath,
            relativePath,
            onlyUndetected: job.onlyUndetected,
          }, state)
          applyFaceScanItemToSummary(job, item)
          job.processed += 1
          job.items.push(item)
          touchFaceScanJob(job)
        }
      }

      job.currentPath = null
      if (job.cancelRequested) {
        job.status = 'canceled'
        job.finishedAt = nowTs()
        touchFaceScanJob(job)
        return
      }

      if (job.runCluster && job.detectedFaces > 0) {
        job.postCluster = await clusterPendingFaces({
          limit: Math.max(1, job.detectedFaces),
          minFaces: FACE_SCAN_CLUSTER_MIN_FACES,
        })
      }
      job.status = 'succeeded'
      job.finishedAt = nowTs()
      touchFaceScanJob(job)
    } catch (error) {
      job.status = 'failed'
      job.currentPath = null
      job.error = error instanceof Error ? error.message : '人脸扫描任务失败'
      job.finishedAt = nowTs()
      touchFaceScanJob(job)
    }
  }

  function pumpFaceScanJobQueue() {
    if (activeFaceScanJobId) return

    while (faceScanJobQueue.length > 0) {
      const jobId = faceScanJobQueue.shift()
      const job = faceScanJobs.get(jobId)
      if (!job || job.status === 'canceled') continue

      activeFaceScanJobId = job.id
      void runFaceScanJob(job)
        .finally(() => {
          activeFaceScanJobId = null
          pruneCompletedFaceScanJobs()
          pumpFaceScanJobQueue()
        })
      return
    }
  }

  function createDetectAssetsJob(runtime, params) {
    const rootPath = resolveRootPath(params.rootPath)
    const relativePaths = normalizeRelativePathList(params.relativePaths)
    if (relativePaths.length === 0) {
      throw new Error('relativePaths must contain at least one path')
    }

    const now = nowTs()
    const batches = buildFaceScanWeightedBatches(relativePaths)
    const job = {
      id: randomUUID(),
      runtime,
      rootPath,
      relativePaths,
      onlyUndetected: params.onlyUndetected !== false,
      runCluster: params.runCluster !== false,
      preClusterEnabled: params.runCluster !== false && params.preCluster !== false,
      status: 'queued',
      total: relativePaths.length,
      unique: new Set(relativePaths).size,
      processed: 0,
      scanned: 0,
      skipped: 0,
      failed: 0,
      detectedFaces: 0,
      currentPath: null,
      batchIndex: 0,
      batchCount: batches.length,
      preCluster: null,
      postCluster: null,
      error: null,
      cancelRequested: false,
      items: [],
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      finishedAt: null,
    }

    pruneCompletedFaceScanJobs()
    faceScanJobs.set(job.id, job)
    faceScanJobQueue.push(job.id)
    pumpFaceScanJobQueue()
    return toFaceScanJobSnapshot(job, { includeRecentItems: false })
  }

  function getDetectAssetsJob(jobId) {
    return toFaceScanJobSnapshot(getFaceScanJobOrThrow(jobId))
  }

  function cancelDetectAssetsJob(jobId) {
    const job = getFaceScanJobOrThrow(jobId)
    if (isFaceScanJobTerminal(job)) {
      return toFaceScanJobSnapshot(job)
    }

    job.cancelRequested = true
    if (job.status === 'queued') {
      job.status = 'canceled'
      job.finishedAt = nowTs()
      const queueIndex = faceScanJobQueue.indexOf(job.id)
      if (queueIndex >= 0) {
        faceScanJobQueue.splice(queueIndex, 1)
      }
    } else {
      job.status = 'canceling'
    }
    touchFaceScanJob(job)
    return toFaceScanJobSnapshot(job)
  }

  function listDetectAssetsJobItems(jobId, params = {}) {
    return readFaceScanJobItemsPage(getFaceScanJobOrThrow(jobId), params)
  }

  async function detectAssets(runtime, params) {
    const rootPath = resolveRootPath(params.rootPath)
    const relativePaths = normalizeRelativePathList(params.relativePaths)
    if (relativePaths.length === 0) {
      throw new Error('relativePaths must contain at least one path')
    }

    const onlyUndetected = params.onlyUndetected !== false
    const runCluster = params.runCluster !== false
    const preClusterEnabled = runCluster && params.preCluster !== false
    const items = []
    const state = createFaceScanState()
    const summary = createFaceScanSummary()

    const preCluster = preClusterEnabled
      ? await clusterPendingFaces({
        limit: FACE_SCAN_CLUSTER_LIMIT,
        minFaces: FACE_SCAN_CLUSTER_MIN_FACES,
      })
      : null

    for (const relativePath of relativePaths) {
      const item = await scanFaceAssetItem(runtime, {
        rootPath,
        relativePath,
        onlyUndetected,
      }, state)
      applyFaceScanItemToSummary(summary, item)
      items.push(item)
    }

    const postCluster = runCluster && summary.detectedFaces > 0
      ? await clusterPendingFaces({
        limit: Math.max(1, summary.detectedFaces),
        minFaces: FACE_SCAN_CLUSTER_MIN_FACES,
      })
      : null

    return {
      ok: summary.failed === 0,
      total: relativePaths.length,
      unique: state.seenPaths.size,
      scanned: summary.scanned,
      skipped: summary.skipped,
      failed: summary.failed,
      detectedFaces: summary.detectedFaces,
      preCluster,
      postCluster,
      items,
    }
  }

  return {
    cancelDetectAssetsJob,
    createDetectAssetsJob,
    detectAssets,
    getDetectAssetsJob,
    listDetectAssetsJobItems,
  }
}
