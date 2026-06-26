import path from 'node:path'
import {
  nowTs,
  parseInteger,
} from './common.mjs'

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
function normalizeFaceMediaType(value) {
  return value === 'video' ? 'video' : 'image'
}

export function getFaceScanMediaType(relativePath) {
  const extension = path.extname(relativePath).slice(1).toLowerCase()
  if (FACE_SCAN_VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (FACE_SCAN_IMAGE_EXTENSIONS.has(extension)) return 'image'
  return null
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
