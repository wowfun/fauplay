import { isImageFile, isVideoFile } from '../../../lib/filePreview.ts'
import type { FileItem, FilterState } from '../../../types/index.ts'

export function filterExplorerListingFiles(files: FileItem[], filter: FilterState): FileItem[] {
  let result = [...files]

  if (filter.hideEmptyFolders) {
    result = result.filter((file) => file.kind === 'file' || !file.isEmpty)
  }

  if (filter.search) {
    const search = filter.search.toLowerCase()
    result = result.filter((file) => file.name.toLowerCase().includes(search))
  }

  if (filter.type !== 'all') {
    result = result.filter((file) => {
      if (filter.type === 'image') return file.kind === 'directory' || isImageFile(file.name)
      if (filter.type === 'video') return file.kind === 'directory' || isVideoFile(file.name)
      return true
    })
  }

  result.sort((left, right) => compareExplorerListingFiles(left, right, filter))
  return result
}

function compareExplorerListingFiles(left: FileItem, right: FileItem, filter: FilterState): number {
  if (left.kind === 'directory' && right.kind === 'file') return -1
  if (left.kind === 'file' && right.kind === 'directory') return 1

  let cmp = 0
  switch (filter.sortBy) {
    case 'name':
      cmp = left.name.localeCompare(right.name)
      break
    case 'date':
      if (!left.lastModified || !right.lastModified) {
        cmp = left.name.localeCompare(right.name)
      } else {
        cmp = left.lastModified.getTime() - right.lastModified.getTime()
      }
      break
    case 'size':
      if (typeof left.size !== 'number' || typeof right.size !== 'number') {
        cmp = left.name.localeCompare(right.name)
      } else {
        cmp = left.size - right.size
      }
      break
    case 'annotationTime':
      cmp = left.name.localeCompare(right.name)
      break
  }

  return filter.sortOrder === 'asc' ? cmp : -cmp
}
