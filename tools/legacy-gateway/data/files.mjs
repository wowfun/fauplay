import fs from 'node:fs/promises'
import path from 'node:path'
import {
  resolveRootPath,
  statPath,
} from './common.mjs'
import {
  getMimeType,
} from './file-preview-kind.mjs'

const TEXT_PREVIEW_DEFAULT_SIZE_LIMIT_BYTES = 1024 * 1024

function containsNullByte(buffer) {
  for (const byte of buffer) {
    if (byte === 0) {
      return true
    }
  }
  return false
}

function resolveAbsolutePathInput(input, fieldName = 'absolutePath') {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`${fieldName} is required`)
  }
  return resolveRootPath(input)
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
      : TEXT_PREVIEW_DEFAULT_SIZE_LIMIT_BYTES,
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
