import { getMimeType } from '@/lib/fileSystem'
import { getFilePreviewKind } from '@/lib/filePreview'
import type { FileItem, TextPreviewPayload } from '@/types'

const LOCAL_RUNTIME_BASE_URL_CONFIG =
  (import.meta.env.VITE_FAUPLAY_RUNTIME_BASE_URL as string | undefined)?.trim()
  || 'http://127.0.0.1:3211'
const DEFAULT_RUNTIME_TIMEOUT_MS = 120000

export interface RuntimeHealthSnapshot {
  status: string
  runtime: string
}

export interface RuntimeGlobalShortcutConfigSnapshot {
  loaded: boolean
  path: string
  config: unknown | null
}

export interface RuntimeLocalRootBinding {
  rootId: string
  rootPath: string
}

export interface RuntimeLocalRootBindingsResponse {
  items: RuntimeLocalRootBinding[]
}

export interface RuntimeLocalRootBindingUpsertRequest {
  rootId: string
  rootPath: string
}

export interface RuntimeDirectoryEntry {
  name: string
  rootRelativePath: string
  kind: 'directory' | 'file'
  isEmpty?: boolean
  entryCount?: number
  size?: number
  lastModifiedMs?: number
}

export interface RuntimeListDirectoryRequest {
  rootPath: string
  rootRelativePath?: string
  flattened?: boolean
  limit?: number
  offset?: number
  nameContains?: string
  entryFilter?: 'all' | 'image' | 'video'
  hideEmptyFolders?: boolean
  sortBy?: 'name' | 'date' | 'size'
  sortOrder?: 'asc' | 'desc'
}

export interface RuntimeTextPreviewRequest {
  rootPath: string
  rootRelativePath: string
  sizeLimitBytes?: number
}

export interface RuntimeFileContentRequest {
  rootPath: string
  rootRelativePath: string
}

export interface RuntimeFileLocator {
  rootPath: string
  rootRelativePath: string
}

export interface RuntimeFileMetadataRequest {
  rootPath: string
  rootRelativePath: string
}

export interface RuntimeFileMetadataResponse {
  rootRelativePath: string
  size: number
  lastModifiedMs?: number
}

export interface RuntimeRootTrashRequest {
  rootPath: string
  rootRelativePath: string | string[]
  dryRun?: boolean
}

export interface RuntimeRootMoveRequest {
  rootPath: string
  sourceRootRelativePath: string
  targetRootRelativePath: string
  dryRun?: boolean
}

export interface RuntimeRootMoveResponse {
  dryRun: boolean
  sourceRootRelativePath: string
  targetRootRelativePath: string
  absolutePath: string
  targetAbsolutePath: string
  ok: boolean
  reason: string | null
  error: string | null
}

export interface RuntimeRootMoveBatchRequest {
  rootPath: string
  rootRelativePaths: string[]
  nameMask?: string
  findText?: string
  replaceText?: string
  searchMode?: 'plain' | 'regex'
  regexFlags?: string
  counterStart?: number | string
  counterStep?: number | string
  counterPad?: number | string
  dryRun?: boolean
}

export interface RuntimeRootMoveBatchItem {
  rootRelativePath: string
  nextRootRelativePath: string | null
  absolutePath: string
  nextAbsolutePath: string | null
  ok: boolean
  skipped: boolean
  reason: string | null
  error: string | null
}

export interface RuntimeRootMoveBatchResponse {
  dryRun: boolean
  total: number
  moved: number
  skipped: number
  failed: number
  items: RuntimeRootMoveBatchItem[]
}

export interface RuntimeDuplicateFilesRequest {
  rootPath: string
  rootRelativePath: string | string[]
}

export interface RuntimeDuplicateSeedSkip {
  rootRelativePath: string
  reason: string
}

export interface RuntimeDuplicateFile {
  name: string
  rootRelativePath: string
  absolutePath: string
  size: number
  lastModifiedMs?: number
}

export interface RuntimeDuplicateSet {
  setId: string
  seedRootRelativePaths: string[]
  files: RuntimeDuplicateFile[]
}

export interface RuntimeDuplicateFilesResponse {
  ok: boolean
  seedCount: number
  skippedSeeds: RuntimeDuplicateSeedSkip[]
  duplicateSetCount: number
  duplicateSets: RuntimeDuplicateSet[]
}

export interface RuntimeRootTrashListRequest {
  rootPath: string
  limit?: number
  offset?: number
}

export interface RuntimeRootTrashEntry {
  name: string
  rootRelativePath: string
  originalRootRelativePath: string
  absolutePath: string
  originalAbsolutePath: string
  size: number
  lastModifiedMs?: number
  deletedAtMs?: number
}

export interface RuntimeRootTrashListResponse {
  entries: RuntimeRootTrashEntry[]
  isTruncated: boolean
  nextOffset: number | null
}

export interface RuntimeGlobalTrashListRequest {
  limit?: number
  offset?: number
}

export interface RuntimeGlobalTrashEntry {
  name: string
  path: string
  absolutePath: string
  size: number
  mimeType: string
  previewKind: NonNullable<FileItem['previewKind']>
  displayPath: string
  deletedAt: number
  sourceType: 'global_recycle'
  recycleId: string
  originalAbsolutePath: string
  lastModifiedMs?: number
}

export interface RuntimeGlobalTrashListResponse {
  entries: RuntimeGlobalTrashEntry[]
  isTruncated: boolean
  nextOffset: number | null
}

export interface RuntimeGlobalTrashMoveRequest {
  absolutePath: string | string[]
  dryRun?: boolean
}

export interface RuntimeGlobalTrashMoveItem {
  sourceType: 'global_recycle'
  recycleId: string
  absolutePath: string
  nextAbsolutePath: string | null
  deletedAt?: number
  ok: boolean
  reason: string | null
  error: string | null
}

export interface RuntimeGlobalTrashMoveResponse {
  dryRun: boolean
  total: number
  moved: number
  failed: number
  items: RuntimeGlobalTrashMoveItem[]
}

export interface RuntimeGlobalTrashRestoreRequest {
  recycleId: string | string[]
  dryRun?: boolean
}

export interface RuntimeGlobalTrashFileContentRequest {
  recycleId: string
}

export interface RuntimeGlobalTrashTextPreviewRequest {
  recycleId: string
  sizeLimitBytes?: number
}

export interface RuntimeGlobalTrashFileMetadataRequest {
  recycleId: string
}

export interface RuntimeGlobalTrashFileMetadataResponse {
  recycleId: string
  size: number
  lastModifiedMs?: number
}

export interface RuntimeGlobalTrashRestoreItem {
  sourceType: 'global_recycle'
  recycleId: string
  absolutePath: string
  originalAbsolutePath: string
  nextAbsolutePath: string | null
  ok: boolean
  reason: string | null
  error: string | null
}

export interface RuntimeGlobalTrashRestoreResponse {
  dryRun: boolean
  total: number
  restored: number
  failed: number
  items: RuntimeGlobalTrashRestoreItem[]
}

export interface RuntimeRootTrashItem {
  rootRelativePath: string
  nextRootRelativePath: string | null
  absolutePath: string
  nextAbsolutePath: string | null
  ok: boolean
  reason: string | null
  error: string | null
}

export interface RuntimeRootTrashResponse {
  dryRun: boolean
  total: number
  completed: number
  failed: number
  items: RuntimeRootTrashItem[]
}

export interface RuntimeListDirectoryResponse {
  entries: RuntimeDirectoryEntry[]
  isTruncated: boolean
  nextOffset: number | null
}

export class RuntimeApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'RuntimeApiError'
    this.status = status
  }
}

function getLocalRuntimeBaseUrl(): string {
  return LOCAL_RUNTIME_BASE_URL_CONFIG
}

function normalizeEndpointPath(endpointPath: string): string {
  return endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
}

function buildRuntimeUrl(endpointPath: string): string {
  return new URL(
    normalizeEndpointPath(endpointPath),
    `${getLocalRuntimeBaseUrl().replace(/\/+$/, '')}/`,
  ).toString()
}

function createTimeoutError(timeoutMs: number): RuntimeApiError {
  return new RuntimeApiError(`Fauplay Runtime request timed out after ${timeoutMs}ms`)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toFiniteNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

async function callRuntimeJson(
  endpointPath: string,
  timeoutMs = DEFAULT_RUNTIME_TIMEOUT_MS,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<unknown> {
  const endpoint = buildRuntimeUrl(endpointPath)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const requestInit: RequestInit = {
      method,
      signal: controller.signal,
    }
    if (typeof body !== 'undefined') {
      requestInit.headers = {
        'Content-Type': 'application/json',
      }
      requestInit.body = JSON.stringify(body)
    }
    const response = await fetch(endpoint, {
      ...requestInit,
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      const message = isObject(payload) && typeof payload.error === 'string'
        ? payload.error
        : `Fauplay Runtime request failed: ${response.status}`
      throw new RuntimeApiError(message, response.status)
    }

    return payload
  } catch (error) {
    if (isAbortError(error)) {
      throw createTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function callRuntimeHttp<T = unknown>(
  endpointPath: string,
  body: unknown = {},
  timeoutMs?: number,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'POST',
): Promise<T> {
  return callRuntimeJson(
    endpointPath,
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_RUNTIME_TIMEOUT_MS,
    method,
    method === 'GET' ? undefined : body,
  ) as Promise<T>
}

function parseRuntimeHealthSnapshot(payload: unknown): RuntimeHealthSnapshot {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime health response was invalid')
  }

  return {
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    runtime: typeof payload.runtime === 'string' ? payload.runtime : 'unknown',
  }
}

function parseRuntimeGlobalShortcutConfigSnapshot(payload: unknown): RuntimeGlobalShortcutConfigSnapshot {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime global shortcuts response was invalid')
  }

  const loaded = payload.loaded === true
  const path = typeof payload.path === 'string' && payload.path.trim()
    ? payload.path
    : 'Fauplay Runtime global shortcuts'

  return {
    loaded,
    path,
    config: loaded ? (payload.config ?? null) : null,
  }
}

function parseRuntimeLocalRootBinding(payload: unknown): RuntimeLocalRootBinding {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime Local Root Binding response was invalid')
  }

  const rootId = typeof payload.rootId === 'string' ? payload.rootId.trim() : ''
  const rootPath = typeof payload.rootPath === 'string' ? payload.rootPath.trim() : ''
  if (!rootId || !rootPath) {
    throw new RuntimeApiError('Fauplay Runtime Local Root Binding response was invalid')
  }

  return {
    rootId,
    rootPath,
  }
}

function parseRuntimeLocalRootBindingsResponse(payload: unknown): RuntimeLocalRootBindingsResponse {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime Local Root Bindings response was invalid')
  }

  return {
    items: Array.isArray(payload.items)
      ? payload.items.map(parseRuntimeLocalRootBinding)
      : [],
  }
}

function parseRuntimeDirectoryEntry(value: unknown): RuntimeDirectoryEntry | null {
  if (!isObject(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const kind = value.kind === 'directory' || value.kind === 'file' ? value.kind : null
  if (!name || !rootRelativePath || !kind) return null

  return {
    name,
    rootRelativePath,
    kind,
    isEmpty: kind === 'directory' && typeof value.isEmpty === 'boolean'
      ? value.isEmpty
      : undefined,
    entryCount: kind === 'directory'
      ? toFiniteNumber(value.entryCount)
      : undefined,
    size: kind === 'file' ? toFiniteNumber(value.size) : undefined,
    lastModifiedMs: toFiniteNumber(value.lastModifiedMs),
  }
}

function parseRuntimeListDirectoryResponse(payload: unknown): RuntimeListDirectoryResponse {
  if (!isObject(payload)) {
    return {
      entries: [],
      isTruncated: false,
      nextOffset: null,
    }
  }

  const entries = Array.isArray(payload.entries)
    ? payload.entries
      .map((entry) => parseRuntimeDirectoryEntry(entry))
      .filter((entry): entry is RuntimeDirectoryEntry => entry !== null)
    : []

  return {
    entries,
    isTruncated: payload.isTruncated === true,
    nextOffset: typeof payload.nextOffset === 'number' && Number.isFinite(payload.nextOffset)
      ? payload.nextOffset
      : null,
  }
}

function normalizeRootRelativePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

function joinRootPath(rootPath: string, rootRelativePath: string): string | undefined {
  const normalizedRootPath = rootPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedRootRelativePath = normalizeRootRelativePath(rootRelativePath)
  if (!normalizedRootPath || !normalizedRootRelativePath) {
    return undefined
  }
  return `${normalizedRootPath}/${normalizedRootRelativePath}`
}

export async function loadRuntimeHealth(timeoutMs?: number): Promise<RuntimeHealthSnapshot> {
  const payload = await callRuntimeJson('/v1/health', timeoutMs)
  return parseRuntimeHealthSnapshot(payload)
}

export async function loadRuntimeGlobalShortcutConfig(
  timeoutMs?: number,
): Promise<RuntimeGlobalShortcutConfigSnapshot> {
  const payload = await callRuntimeJson('/v1/config/shortcuts', timeoutMs)
  return parseRuntimeGlobalShortcutConfigSnapshot(payload)
}

export async function listRuntimeLocalRootBindings(
  timeoutMs?: number,
): Promise<RuntimeLocalRootBindingsResponse> {
  const payload = await callRuntimeJson('/v1/local-root-bindings', timeoutMs)
  return parseRuntimeLocalRootBindingsResponse(payload)
}

export async function upsertRuntimeLocalRootBinding(
  request: RuntimeLocalRootBindingUpsertRequest,
  timeoutMs?: number,
): Promise<RuntimeLocalRootBinding> {
  const query = new URLSearchParams({
    rootId: request.rootId,
    rootPath: request.rootPath,
  })
  const payload = await callRuntimeJson(`/v1/local-root-bindings?${query.toString()}`, timeoutMs, 'PUT')
  return parseRuntimeLocalRootBinding(payload)
}

export async function listRuntimeLocalDirectory(
  request: RuntimeListDirectoryRequest,
  timeoutMs?: number,
): Promise<RuntimeListDirectoryResponse> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath ?? '',
  })
  if (request.flattened === true) {
    query.set('flattened', 'true')
  }
  if (typeof request.limit === 'number' && Number.isFinite(request.limit) && request.limit > 0) {
    query.set('limit', String(Math.trunc(request.limit)))
  }
  if (typeof request.offset === 'number' && Number.isFinite(request.offset) && request.offset > 0) {
    query.set('offset', String(Math.trunc(request.offset)))
  }
  const nameContains = request.nameContains?.trim()
  if (nameContains) {
    query.set('nameContains', nameContains)
  }
  if (request.entryFilter === 'image' || request.entryFilter === 'video') {
    query.set('entryFilter', request.entryFilter)
  }
  if (request.hideEmptyFolders === true) {
    query.set('hideEmptyFolders', 'true')
  }
  if (request.sortBy === 'date' || request.sortBy === 'size') {
    query.set('sortBy', request.sortBy)
  }
  if (request.sortOrder === 'desc') {
    query.set('sortOrder', 'desc')
  }
  const payload = await callRuntimeJson(`/v1/local-directory?${query.toString()}`, timeoutMs)
  return parseRuntimeListDirectoryResponse(payload)
}

export async function loadRuntimeTextPreview(
  request: RuntimeTextPreviewRequest,
  timeoutMs?: number,
): Promise<TextPreviewPayload> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath,
  })
  if (
    typeof request.sizeLimitBytes === 'number'
    && Number.isFinite(request.sizeLimitBytes)
    && request.sizeLimitBytes > 0
  ) {
    query.set('sizeLimitBytes', String(Math.trunc(request.sizeLimitBytes)))
  }

  const payload = await callRuntimeJson(`/v1/text-preview?${query.toString()}`, timeoutMs)
  return parseRuntimeTextPreviewPayload(payload)
}

export async function loadRuntimeGlobalTrashTextPreview(
  request: RuntimeGlobalTrashTextPreviewRequest,
  timeoutMs?: number,
): Promise<TextPreviewPayload> {
  const query = new URLSearchParams({
    recycleId: request.recycleId,
  })
  if (
    typeof request.sizeLimitBytes === 'number'
    && Number.isFinite(request.sizeLimitBytes)
    && request.sizeLimitBytes > 0
  ) {
    query.set('sizeLimitBytes', String(Math.trunc(request.sizeLimitBytes)))
  }

  const payload = await callRuntimeJson(`/v1/global-trash/text-preview?${query.toString()}`, timeoutMs)
  return parseRuntimeTextPreviewPayload(payload)
}

export async function listRuntimeRootTrash(
  request: RuntimeRootTrashListRequest,
  timeoutMs?: number,
): Promise<RuntimeRootTrashListResponse> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
  })
  if (typeof request.limit === 'number' && Number.isFinite(request.limit) && request.limit > 0) {
    query.set('limit', String(Math.trunc(request.limit)))
  }
  if (typeof request.offset === 'number' && Number.isFinite(request.offset) && request.offset > 0) {
    query.set('offset', String(Math.trunc(request.offset)))
  }

  const payload = await callRuntimeJson(`/v1/root-trash?${query.toString()}`, timeoutMs)
  return parseRuntimeRootTrashListResponse(payload)
}

export async function listRuntimeGlobalTrash(
  request: RuntimeGlobalTrashListRequest = {},
  timeoutMs?: number,
): Promise<RuntimeGlobalTrashListResponse> {
  const query = new URLSearchParams()
  if (typeof request.limit === 'number' && Number.isFinite(request.limit) && request.limit > 0) {
    query.set('limit', String(Math.trunc(request.limit)))
  }
  if (typeof request.offset === 'number' && Number.isFinite(request.offset) && request.offset > 0) {
    query.set('offset', String(Math.trunc(request.offset)))
  }

  const queryString = query.toString()
  const payload = await callRuntimeJson(
    queryString ? `/v1/global-trash?${queryString}` : '/v1/global-trash',
    timeoutMs,
  )
  return parseRuntimeGlobalTrashListResponse(payload)
}

export async function moveRuntimePathToRootTrash(
  request: RuntimeRootTrashRequest,
  timeoutMs?: number,
): Promise<RuntimeRootTrashResponse> {
  const payload = await callRuntimeJson(
    `/v1/root-trash/move?${rootTrashQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeRootTrashResponse(payload)
}

export async function moveRuntimeRootPath(
  request: RuntimeRootMoveRequest,
  timeoutMs?: number,
): Promise<RuntimeRootMoveResponse> {
  const payload = await callRuntimeJson(
    `/v1/root-move?${rootMoveQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeRootMoveResponse(payload)
}

export async function moveRuntimeRootPathBatch(
  request: RuntimeRootMoveBatchRequest,
  timeoutMs?: number,
): Promise<RuntimeRootMoveBatchResponse> {
  const payload = await callRuntimeJson(
    '/v1/root-move/batch',
    timeoutMs,
    'POST',
    {
      rootPath: request.rootPath,
      rootRelativePaths: request.rootRelativePaths,
      nameMask: request.nameMask,
      findText: request.findText,
      replaceText: request.replaceText,
      searchMode: request.searchMode,
      regexFlags: request.regexFlags,
      counterStart: request.counterStart,
      counterStep: request.counterStep,
      counterPad: request.counterPad,
      dryRun: request.dryRun === true,
    },
  )
  return parseRuntimeRootMoveBatchResponse(payload)
}

export async function moveRuntimePathToGlobalTrash(
  request: RuntimeGlobalTrashMoveRequest,
  timeoutMs?: number,
): Promise<RuntimeGlobalTrashMoveResponse> {
  const payload = await callRuntimeJson(
    `/v1/global-trash/move?${globalTrashMoveQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeGlobalTrashMoveResponse(payload)
}

export async function restoreRuntimePathFromRootTrash(
  request: RuntimeRootTrashRequest,
  timeoutMs?: number,
): Promise<RuntimeRootTrashResponse> {
  const payload = await callRuntimeJson(
    `/v1/root-trash/restore?${rootTrashQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeRootTrashResponse(payload)
}

export async function restoreRuntimeGlobalTrash(
  request: RuntimeGlobalTrashRestoreRequest,
  timeoutMs?: number,
): Promise<RuntimeGlobalTrashRestoreResponse> {
  const payload = await callRuntimeJson(
    `/v1/global-trash/restore?${globalTrashRestoreQuery(request).toString()}`,
    timeoutMs,
    'POST',
  )
  return parseRuntimeGlobalTrashRestoreResponse(payload)
}

export function buildRuntimeFileContentUrl(request: RuntimeFileContentRequest): string {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath,
  })
  return buildRuntimeUrl(`/v1/file-content?${query.toString()}`)
}

export function buildRuntimeGlobalTrashFileContentUrl(
  request: RuntimeGlobalTrashFileContentRequest,
): string {
  const query = new URLSearchParams({
    recycleId: request.recycleId,
  })
  return buildRuntimeUrl(`/v1/global-trash/file-content?${query.toString()}`)
}

export async function loadRuntimeFileMetadata(
  request: RuntimeFileMetadataRequest,
  timeoutMs?: number,
): Promise<RuntimeFileMetadataResponse> {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    rootRelativePath: request.rootRelativePath,
  })
  const payload = await callRuntimeJson(`/v1/file-metadata?${query.toString()}`, timeoutMs)
  return parseRuntimeFileMetadataResponse(payload)
}

export async function loadRuntimeGlobalTrashFileMetadata(
  request: RuntimeGlobalTrashFileMetadataRequest,
  timeoutMs?: number,
): Promise<RuntimeGlobalTrashFileMetadataResponse> {
  const query = new URLSearchParams({
    recycleId: request.recycleId,
  })
  const payload = await callRuntimeJson(`/v1/global-trash/file-metadata?${query.toString()}`, timeoutMs)
  return parseRuntimeGlobalTrashFileMetadataResponse(payload)
}

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

export function buildRuntimeFileContentUrlForItem(file: FileItem): string | null {
  const locator = resolveRuntimeFileLocator(file)
  if (!locator) {
    return null
  }

  return buildRuntimeFileContentUrl(locator)
}

export function buildRuntimeGlobalTrashFileContentUrlForItem(file: FileItem): string | null {
  const recycleId = resolveRuntimeGlobalTrashRecycleId(file)
  if (!recycleId) {
    return null
  }

  return buildRuntimeGlobalTrashFileContentUrl({ recycleId })
}

export function resolveRuntimeGlobalTrashRecycleId(file: FileItem): string | null {
  if (file.sourceType !== 'global_recycle') {
    return null
  }

  const recycleId = typeof file.recycleId === 'string' ? file.recycleId.trim() : ''
  return recycleId || null
}

export function resolveRuntimeFileLocator(
  file: FileItem,
  fallbackRootPath?: string | null,
): RuntimeFileLocator | null {
  const rootPath = typeof file.sourceRootPath === 'string' && file.sourceRootPath.trim()
    ? file.sourceRootPath.trim()
    : (typeof fallbackRootPath === 'string' && fallbackRootPath.trim() ? fallbackRootPath.trim() : '')
  const rawRootRelativePath = typeof file.sourceRelativePath === 'string' && file.sourceRelativePath.trim()
    ? file.sourceRelativePath
    : file.path
  const rootRelativePath = normalizeRootRelativePath(rawRootRelativePath)

  if (!rootPath || !rootRelativePath || isAbsolutePathLike(rootRelativePath)) {
    return null
  }

  return {
    rootPath,
    rootRelativePath,
  }
}

function rootTrashQuery(request: RuntimeRootTrashRequest): URLSearchParams {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
  })
  const rootRelativePaths = Array.isArray(request.rootRelativePath)
    ? request.rootRelativePath
    : [request.rootRelativePath]
  for (const rootRelativePath of rootRelativePaths) {
    query.append('rootRelativePath', rootRelativePath)
  }
  if (request.dryRun === true) {
    query.set('dryRun', 'true')
  }
  return query
}

function rootMoveQuery(request: RuntimeRootMoveRequest): URLSearchParams {
  const query = new URLSearchParams({
    rootPath: request.rootPath,
    sourceRootRelativePath: request.sourceRootRelativePath,
    targetRootRelativePath: request.targetRootRelativePath,
  })
  if (request.dryRun === true) {
    query.set('dryRun', 'true')
  }
  return query
}

function globalTrashMoveQuery(request: RuntimeGlobalTrashMoveRequest): URLSearchParams {
  const query = new URLSearchParams()
  const absolutePaths = Array.isArray(request.absolutePath)
    ? request.absolutePath
    : [request.absolutePath]
  for (const absolutePath of absolutePaths) {
    query.append('absolutePath', absolutePath)
  }
  if (request.dryRun === true) {
    query.set('dryRun', 'true')
  }
  return query
}

function globalTrashRestoreQuery(request: RuntimeGlobalTrashRestoreRequest): URLSearchParams {
  const query = new URLSearchParams()
  const recycleIds = Array.isArray(request.recycleId)
    ? request.recycleId
    : [request.recycleId]
  for (const recycleId of recycleIds) {
    query.append('recycleId', recycleId)
  }
  if (request.dryRun === true) {
    query.set('dryRun', 'true')
  }
  return query
}

function parseRuntimeRootMoveResponse(payload: unknown): RuntimeRootMoveResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      sourceRootRelativePath: '',
      targetRootRelativePath: '',
      absolutePath: '',
      targetAbsolutePath: '',
      ok: false,
      reason: null,
      error: 'Fauplay Runtime Root Move response was invalid',
    }
  }

  return {
    dryRun: payload.dryRun === true,
    sourceRootRelativePath: typeof payload.sourceRootRelativePath === 'string'
      ? normalizeRootRelativePath(payload.sourceRootRelativePath)
      : '',
    targetRootRelativePath: typeof payload.targetRootRelativePath === 'string'
      ? normalizeRootRelativePath(payload.targetRootRelativePath)
      : '',
    absolutePath: typeof payload.absolutePath === 'string' ? payload.absolutePath : '',
    targetAbsolutePath: typeof payload.targetAbsolutePath === 'string'
      ? payload.targetAbsolutePath
      : '',
    ok: payload.ok === true,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
    error: typeof payload.error === 'string' ? payload.error : null,
  }
}

function parseRuntimeRootMoveBatchResponse(payload: unknown): RuntimeRootMoveBatchResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      total: 0,
      moved: 0,
      skipped: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    dryRun: payload.dryRun === true,
    total: Math.max(0, Math.trunc(toFiniteNumber(payload.total) ?? 0)),
    moved: Math.max(0, Math.trunc(toFiniteNumber(payload.moved) ?? 0)),
    skipped: Math.max(0, Math.trunc(toFiniteNumber(payload.skipped) ?? 0)),
    failed: Math.max(0, Math.trunc(toFiniteNumber(payload.failed) ?? 0)),
    items: Array.isArray(payload.items)
      ? payload.items
        .map((item) => parseRuntimeRootMoveBatchItem(item))
        .filter((item): item is RuntimeRootMoveBatchItem => item !== null)
      : [],
  }
}

function parseRuntimeRootMoveBatchItem(value: unknown): RuntimeRootMoveBatchItem | null {
  if (!isObject(value)) return null
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  if (!rootRelativePath || !absolutePath) return null

  return {
    rootRelativePath,
    nextRootRelativePath: typeof value.nextRootRelativePath === 'string'
      ? normalizeRootRelativePath(value.nextRootRelativePath)
      : null,
    absolutePath,
    nextAbsolutePath: typeof value.nextAbsolutePath === 'string' ? value.nextAbsolutePath : null,
    ok: value.ok === true,
    skipped: value.skipped === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    error: typeof value.error === 'string' ? value.error : null,
  }
}

function parseRuntimeRootTrashResponse(payload: unknown): RuntimeRootTrashResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      total: 0,
      completed: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    dryRun: payload.dryRun === true,
    total: Math.max(0, Math.trunc(toFiniteNumber(payload.total) ?? 0)),
    completed: Math.max(0, Math.trunc(toFiniteNumber(payload.completed) ?? 0)),
    failed: Math.max(0, Math.trunc(toFiniteNumber(payload.failed) ?? 0)),
    items: Array.isArray(payload.items)
      ? payload.items
        .map((item) => parseRuntimeRootTrashItem(item))
        .filter((item): item is RuntimeRootTrashItem => item !== null)
      : [],
  }
}

function parseRuntimeGlobalTrashMoveResponse(payload: unknown): RuntimeGlobalTrashMoveResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      total: 0,
      moved: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    dryRun: payload.dryRun === true,
    total: Math.max(0, Math.trunc(toFiniteNumber(payload.total) ?? 0)),
    moved: Math.max(0, Math.trunc(toFiniteNumber(payload.moved) ?? 0)),
    failed: Math.max(0, Math.trunc(toFiniteNumber(payload.failed) ?? 0)),
    items: Array.isArray(payload.items)
      ? payload.items
        .map((item) => parseRuntimeGlobalTrashMoveItem(item))
        .filter((item): item is RuntimeGlobalTrashMoveItem => item !== null)
      : [],
  }
}

function parseRuntimeGlobalTrashRestoreResponse(payload: unknown): RuntimeGlobalTrashRestoreResponse {
  if (!isObject(payload)) {
    return {
      dryRun: false,
      total: 0,
      restored: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    dryRun: payload.dryRun === true,
    total: Math.max(0, Math.trunc(toFiniteNumber(payload.total) ?? 0)),
    restored: Math.max(0, Math.trunc(toFiniteNumber(payload.restored) ?? 0)),
    failed: Math.max(0, Math.trunc(toFiniteNumber(payload.failed) ?? 0)),
    items: Array.isArray(payload.items)
      ? payload.items
        .map((item) => parseRuntimeGlobalTrashRestoreItem(item))
        .filter((item): item is RuntimeGlobalTrashRestoreItem => item !== null)
      : [],
  }
}

function parseRuntimeRootTrashListResponse(payload: unknown): RuntimeRootTrashListResponse {
  if (!isObject(payload)) {
    return {
      entries: [],
      isTruncated: false,
      nextOffset: null,
    }
  }

  return {
    entries: Array.isArray(payload.entries)
      ? payload.entries
        .map((entry) => parseRuntimeRootTrashEntry(entry))
        .filter((entry): entry is RuntimeRootTrashEntry => entry !== null)
      : [],
    isTruncated: payload.isTruncated === true,
    nextOffset: typeof payload.nextOffset === 'number' && Number.isFinite(payload.nextOffset)
      ? payload.nextOffset
      : null,
  }
}

function parseRuntimeGlobalTrashListResponse(payload: unknown): RuntimeGlobalTrashListResponse {
  if (!isObject(payload)) {
    return {
      entries: [],
      isTruncated: false,
      nextOffset: null,
    }
  }

  return {
    entries: Array.isArray(payload.entries)
      ? payload.entries
        .map((entry) => parseRuntimeGlobalTrashEntry(entry))
        .filter((entry): entry is RuntimeGlobalTrashEntry => entry !== null)
      : [],
    isTruncated: payload.isTruncated === true,
    nextOffset: typeof payload.nextOffset === 'number' && Number.isFinite(payload.nextOffset)
      ? payload.nextOffset
      : null,
  }
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

function parseRuntimeGlobalTrashMoveItem(value: unknown): RuntimeGlobalTrashMoveItem | null {
  if (!isObject(value)) return null
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  if (!absolutePath) return null

  return {
    sourceType: 'global_recycle',
    recycleId: typeof value.recycleId === 'string' ? value.recycleId : '',
    absolutePath,
    nextAbsolutePath: typeof value.nextAbsolutePath === 'string' ? value.nextAbsolutePath : null,
    deletedAt: toFiniteNumber(value.deletedAt),
    ok: value.ok === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    error: typeof value.error === 'string' ? value.error : null,
  }
}

function parseRuntimeGlobalTrashRestoreItem(value: unknown): RuntimeGlobalTrashRestoreItem | null {
  if (!isObject(value)) return null
  const recycleId = typeof value.recycleId === 'string' ? value.recycleId.trim() : ''
  if (!recycleId) return null

  return {
    sourceType: 'global_recycle',
    recycleId,
    absolutePath: typeof value.absolutePath === 'string' ? value.absolutePath : '',
    originalAbsolutePath: typeof value.originalAbsolutePath === 'string'
      ? value.originalAbsolutePath
      : '',
    nextAbsolutePath: typeof value.nextAbsolutePath === 'string' ? value.nextAbsolutePath : null,
    ok: value.ok === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    error: typeof value.error === 'string' ? value.error : null,
  }
}

function parseRuntimeGlobalTrashEntry(value: unknown): RuntimeGlobalTrashEntry | null {
  if (!isObject(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath.trim() : ''
  const path = typeof value.path === 'string' && value.path.trim()
    ? value.path.trim()
    : absolutePath
  if (!name || !absolutePath || !path) return null

  return {
    name,
    path,
    absolutePath,
    size: Math.max(0, Math.trunc(toFiniteNumber(value.size) ?? 0)),
    mimeType: typeof value.mimeType === 'string' && value.mimeType.trim()
      ? value.mimeType
      : getMimeType(name),
    previewKind: parseRuntimePreviewKind(value.previewKind),
    displayPath: typeof value.displayPath === 'string' && value.displayPath.trim()
      ? value.displayPath
      : absolutePath,
    deletedAt: Math.max(0, Math.trunc(toFiniteNumber(value.deletedAt) ?? 0)),
    sourceType: 'global_recycle',
    recycleId: typeof value.recycleId === 'string' ? value.recycleId : '',
    originalAbsolutePath: typeof value.originalAbsolutePath === 'string'
      ? value.originalAbsolutePath
      : '',
    lastModifiedMs: toFiniteNumber(value.lastModifiedMs),
  }
}

function parseRuntimePreviewKind(value: unknown): NonNullable<FileItem['previewKind']> {
  return (
    value === 'image'
    || value === 'video'
    || value === 'text'
    || value === 'unsupported'
  ) ? value : 'unsupported'
}

function parseRuntimeRootTrashEntry(value: unknown): RuntimeRootTrashEntry | null {
  if (!isObject(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const originalRootRelativePath = typeof value.originalRootRelativePath === 'string'
    ? normalizeRootRelativePath(value.originalRootRelativePath)
    : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  const originalAbsolutePath = typeof value.originalAbsolutePath === 'string'
    ? value.originalAbsolutePath
    : ''
  if (!name || !rootRelativePath || !originalRootRelativePath || !absolutePath || !originalAbsolutePath) {
    return null
  }

  return {
    name,
    rootRelativePath,
    originalRootRelativePath,
    absolutePath,
    originalAbsolutePath,
    size: Math.max(0, Math.trunc(toFiniteNumber(value.size) ?? 0)),
    lastModifiedMs: toFiniteNumber(value.lastModifiedMs),
    deletedAtMs: toFiniteNumber(value.deletedAtMs),
  }
}

function parseRuntimeRootTrashItem(value: unknown): RuntimeRootTrashItem | null {
  if (!isObject(value)) return null
  const rootRelativePath = typeof value.rootRelativePath === 'string'
    ? normalizeRootRelativePath(value.rootRelativePath)
    : ''
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : ''
  if (!rootRelativePath || !absolutePath) return null

  return {
    rootRelativePath,
    nextRootRelativePath: typeof value.nextRootRelativePath === 'string'
      ? normalizeRootRelativePath(value.nextRootRelativePath)
      : null,
    absolutePath,
    nextAbsolutePath: typeof value.nextAbsolutePath === 'string' ? value.nextAbsolutePath : null,
    ok: value.ok === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    error: typeof value.error === 'string' ? value.error : null,
  }
}

function parseRuntimeTextPreviewPayload(payload: unknown): TextPreviewPayload {
  if (!isObject(payload)) {
    return {
      status: 'error',
      content: null,
      fileSizeBytes: null,
      sizeLimitBytes: 0,
      error: 'Fauplay Runtime text preview response was invalid',
    }
  }

  const status = (
    payload.status === 'ready'
    || payload.status === 'too_large'
    || payload.status === 'binary'
    || payload.status === 'error'
  ) ? payload.status : 'error'

  return {
    status,
    content: typeof payload.content === 'string' ? payload.content : null,
    fileSizeBytes: typeof payload.fileSizeBytes === 'number' && Number.isFinite(payload.fileSizeBytes)
      ? payload.fileSizeBytes
      : null,
    sizeLimitBytes: typeof payload.sizeLimitBytes === 'number' && Number.isFinite(payload.sizeLimitBytes)
      ? payload.sizeLimitBytes
      : 0,
    error: typeof payload.error === 'string' ? payload.error : null,
  }
}

function parseRuntimeFileMetadataResponse(payload: unknown): RuntimeFileMetadataResponse {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime File Metadata response was invalid')
  }

  const rootRelativePath = typeof payload.rootRelativePath === 'string'
    ? normalizeRootRelativePath(payload.rootRelativePath)
    : ''
  const size = toFiniteNumber(payload.size)
  if (!rootRelativePath || typeof size !== 'number') {
    throw new RuntimeApiError('Fauplay Runtime File Metadata response was invalid')
  }

  return {
    rootRelativePath,
    size,
    lastModifiedMs: toFiniteNumber(payload.lastModifiedMs),
  }
}

function parseRuntimeGlobalTrashFileMetadataResponse(
  payload: unknown,
): RuntimeGlobalTrashFileMetadataResponse {
  if (!isObject(payload)) {
    throw new RuntimeApiError('Fauplay Runtime Global Trash File Metadata response was invalid')
  }

  const recycleId = typeof payload.recycleId === 'string' ? payload.recycleId.trim() : ''
  const size = toFiniteNumber(payload.size)
  if (!recycleId || typeof size !== 'number') {
    throw new RuntimeApiError('Fauplay Runtime Global Trash File Metadata response was invalid')
  }

  return {
    recycleId,
    size,
    lastModifiedMs: toFiniteNumber(payload.lastModifiedMs),
  }
}

export function toRuntimeFileItems(entries: RuntimeDirectoryEntry[], rootPath?: string | null): FileItem[] {
  const normalizedRootPath = typeof rootPath === 'string' && rootPath.trim()
    ? rootPath.trim()
    : null

  return entries.map((entry) => {
    const lastModified = typeof entry.lastModifiedMs === 'number'
      ? new Date(entry.lastModifiedMs)
      : undefined
    const absolutePath = normalizedRootPath && entry.kind === 'file'
      ? joinRootPath(normalizedRootPath, entry.rootRelativePath)
      : undefined

    return {
      name: entry.name,
      path: entry.rootRelativePath,
      kind: entry.kind,
      isEmpty: entry.isEmpty,
      entryCount: entry.entryCount,
      size: entry.size,
      lastModified,
      lastModifiedMs: entry.lastModifiedMs,
      mimeType: entry.kind === 'file' ? getMimeType(entry.name) : undefined,
      displayPath: entry.rootRelativePath,
      absolutePath,
      sourceRootPath: normalizedRootPath ?? undefined,
      sourceRelativePath: entry.rootRelativePath,
    }
  })
}

export function toRuntimeRootTrashFileItems(
  entries: RuntimeRootTrashEntry[],
  rootPath: string,
): FileItem[] {
  return entries.map((entry) => {
    const lastModifiedMs = typeof entry.lastModifiedMs === 'number'
      ? entry.lastModifiedMs
      : entry.deletedAtMs
    const lastModified = typeof lastModifiedMs === 'number'
      ? new Date(lastModifiedMs)
      : undefined

    return {
      name: entry.name,
      path: entry.rootRelativePath,
      kind: 'file',
      absolutePath: entry.absolutePath,
      size: entry.size,
      mimeType: getMimeType(entry.name),
      previewKind: getFilePreviewKind(entry.name),
      displayPath: entry.rootRelativePath,
      deletedAt: entry.deletedAtMs,
      sourceType: 'root_trash',
      sourceRootPath: rootPath,
      sourceRelativePath: entry.rootRelativePath,
      originalAbsolutePath: entry.originalAbsolutePath,
      lastModifiedMs,
      lastModified,
    }
  })
}

export function toRuntimeGlobalTrashFileItems(entries: RuntimeGlobalTrashEntry[]): FileItem[] {
  return entries.map((entry) => {
    const lastModifiedMs = typeof entry.lastModifiedMs === 'number'
      ? entry.lastModifiedMs
      : entry.deletedAt
    const lastModified = typeof lastModifiedMs === 'number'
      ? new Date(lastModifiedMs)
      : undefined

    return {
      name: entry.name,
      path: entry.path,
      kind: 'file',
      absolutePath: entry.absolutePath,
      size: entry.size,
      mimeType: entry.mimeType,
      previewKind: entry.previewKind,
      displayPath: entry.displayPath,
      deletedAt: entry.deletedAt,
      sourceType: entry.sourceType,
      recycleId: entry.recycleId || undefined,
      originalAbsolutePath: entry.originalAbsolutePath || undefined,
      lastModifiedMs,
      lastModified,
    }
  })
}
