import type { FileItem } from '@/types'

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
