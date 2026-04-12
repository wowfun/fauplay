export type FilePreviewKind = 'image' | 'video' | 'text' | 'unsupported'

export interface FileItem {
  name: string
  path: string
  kind: 'file' | 'directory'
  isEmpty?: boolean
  size?: number
  lastModified?: Date
  lastModifiedMs?: number
  mimeType?: string
  remoteRootId?: string
  absolutePath?: string
  displayPath?: string
  previewKind?: FilePreviewKind
  sourceType?: string
  sourceRootPath?: string
  sourceRelativePath?: string
  groupId?: string
  groupRank?: number
  isCurrentFile?: boolean
  deletedAt?: number
  recycleId?: string
  originalAbsolutePath?: string
}

export interface DirectoryHandle {
  name: string
  kind: 'directory'
  getFile(): Promise<File>
  getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<DirectoryHandle>
  values(): AsyncIterableIterator<FileSystemHandle>
}

export interface FileState {
  handle: FileSystemDirectoryHandle | null
  files: FileItem[]
  currentPath: string
  isLoading: boolean
  error: string | null
}

export type ViewMode = 'grid' | 'list'

export type SortBy = 'name' | 'date' | 'size' | 'annotationTime'
export type SortOrder = 'asc' | 'desc'
export type ThumbnailSizePreset = 'auto' | '256' | '512'
export type AnnotationFilterMode = 'all' | 'boolean'
export type AnnotationIncludeMatchMode = 'or' | 'and'
export const ANNOTATION_FILTER_UNANNOTATED_TAG_KEY = '__ANNOTATION_UNANNOTATED__'

export interface AnnotationFilterTagOption {
  tagKey: string
  key: string
  value: string
  sources: string[]
  hasMetaAnnotation: boolean
  representativeSource: string
  fileCount?: number
}

export type ResultProjectionEntry = 'auto' | 'manual'
export type ResultProjectionOrderingMode = 'listed' | 'group_contiguous' | 'mixed'
export type ResultPanelDisplayMode = 'normal' | 'maximized'

export interface ResultProjectionOrdering {
  mode: ResultProjectionOrderingMode
  keys?: string[]
}

export interface ResultProjection {
  id: string
  title: string
  entry: ResultProjectionEntry
  ordering?: ResultProjectionOrdering
  files: FileItem[]
}

export type TextPreviewStatus = 'idle' | 'loading' | 'ready' | 'too_large' | 'binary' | 'error'

export interface TextPreviewPayload {
  status: TextPreviewStatus
  content: string | null
  fileSizeBytes: number | null
  sizeLimitBytes: number
  error: string | null
}

export interface FilterState {
  search: string
  type: 'all' | 'image' | 'video'
  hideEmptyFolders: boolean
  sortBy: SortBy
  sortOrder: SortOrder
  annotationFilterMode: AnnotationFilterMode
  annotationIncludeMatchMode: AnnotationIncludeMatchMode
  annotationIncludeTagKeys: string[]
  annotationExcludeTagKeys: string[]
}

export interface AddressPathHistoryEntry {
  rootId: string
  rootName: string
  path: string
  visitedAt: number
}

export interface FavoriteFolderEntry {
  rootId: string
  rootName: string
  path: string
  favoritedAt: number
}

export interface CachedRootEntry {
  rootId: string
  rootName: string
  lastUsedAt: number
  boundRootPath?: string
}
