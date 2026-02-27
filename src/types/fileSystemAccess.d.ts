declare global {
  interface Window {
    showDirectoryPicker: (options?: FilePickerOptions) => Promise<FileSystemDirectoryHandle>
  }

  interface FilePickerOptions {
    mode?: 'read' | 'readwrite'
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
  }

  interface FileSystemDirectoryHandle extends FileSystemHandle {
    kind: 'directory'
    name: string
    getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle>
    getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle>
    values(): AsyncIterableIterator<FileSystemHandle>
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  }

  interface FileSystemGetFileOptions {
    create?: boolean
  }

  interface FileSystemGetDirectoryOptions {
    create?: boolean
  }

  interface FileSystemFileHandle extends FileSystemHandle {
    kind: 'file'
    name: string
    getFile(): Promise<File>
  }

  interface FileSystemHandle {
    kind: 'file' | 'directory'
    name: string
  }
}

export {}
