export interface FileItem {
  name: string
  path: string
  kind: 'file' | 'directory'
  isEmpty?: boolean
  size?: number
  lastModified?: Date
  mimeType?: string
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

export type SortBy = 'name' | 'date' | 'size'
export type SortOrder = 'asc' | 'desc'
export type ThumbnailSizePreset = 'auto' | '256' | '512'

export type FilePreviewKind = 'image' | 'video' | 'text' | 'unsupported'

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
}
