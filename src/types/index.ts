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

export interface FilterState {
  search: string
  type: 'all' | 'image' | 'video'
  hideEmptyFolders: boolean
  sortBy: SortBy
  sortOrder: SortOrder
}
