import { callRuntimeJson, isObject, normalizeRootRelativePath, toFiniteNumber } from './core'
import type {
  RuntimeDuplicateFile,
  RuntimeDuplicateFilesRequest,
  RuntimeDuplicateFilesResponse,
  RuntimeDuplicateSeedSkip,
  RuntimeDuplicateSet,
} from './types'

export async function findRuntimeDuplicateFiles(
  request: RuntimeDuplicateFilesRequest,
  timeoutMs?: number,
): Promise<RuntimeDuplicateFilesResponse> {
  const payload = await callRuntimeJson(
    '/v1/duplicate-files',
    timeoutMs,
    'POST',
    {
      rootPath: request.rootPath,
      rootRelativePath: request.rootRelativePath,
    },
  )
  return parseRuntimeDuplicateFilesResponse(payload)
}

function parseRuntimeDuplicateFilesResponse(payload: unknown): RuntimeDuplicateFilesResponse {
  if (!isObject(payload)) {
    return {
      ok: false,
      seedCount: 0,
      skippedSeeds: [],
      duplicateSetCount: 0,
      duplicateSets: [],
    }
  }

  const duplicateSets = Array.isArray(payload.duplicateSets)
    ? payload.duplicateSets
      .map((duplicateSet) => parseRuntimeDuplicateSet(duplicateSet))
      .filter((duplicateSet): duplicateSet is RuntimeDuplicateSet => duplicateSet !== null)
    : []

  return {
    ok: payload.ok === true,
    seedCount: Math.max(0, Math.trunc(toFiniteNumber(payload.seedCount) ?? 0)),
    skippedSeeds: Array.isArray(payload.skippedSeeds)
      ? payload.skippedSeeds
        .map((skip) => parseRuntimeDuplicateSeedSkip(skip))
        .filter((skip): skip is RuntimeDuplicateSeedSkip => skip !== null)
      : [],
    duplicateSetCount: Math.max(
      duplicateSets.length,
      Math.trunc(toFiniteNumber(payload.duplicateSetCount) ?? 0),
    ),
    duplicateSets,
  }
}

function parseRuntimeDuplicateSeedSkip(value: unknown): RuntimeDuplicateSeedSkip | null {
  if (!isObject(value)) return null
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  if (!rootRelativePath) return null

  return {
    rootRelativePath,
    reason: typeof value.reason === 'string' ? value.reason : 'unknown',
  }
}

function parseRuntimeDuplicateSet(value: unknown): RuntimeDuplicateSet | null {
  if (!isObject(value)) return null
  const setId = typeof value.setId === 'string' && value.setId.trim()
    ? value.setId.trim()
    : ''
  if (!setId) return null

  const files = Array.isArray(value.files)
    ? value.files
      .map((file) => parseRuntimeDuplicateFile(file))
      .filter((file): file is RuntimeDuplicateFile => file !== null)
    : []

  if (files.length <= 1) return null

  return {
    setId,
    seedRootRelativePaths: Array.isArray(value.seedRootRelativePaths)
      ? value.seedRootRelativePaths
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeRootRelativePath(item))
        .filter((item) => item.length > 0)
      : [],
    files,
  }
}

function parseRuntimeDuplicateFile(value: unknown): RuntimeDuplicateFile | null {
  if (!isObject(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  if (!name || !rootRelativePath || !absolutePath) return null

  return {
    name,
    rootRelativePath,
    absolutePath,
    size: Math.max(0, Math.trunc(toFiniteNumber(value.size) ?? 0)),
    lastModifiedMs: toFiniteNumber(value.lastModifiedMs),
  }
}
