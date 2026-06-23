import {
  ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY,
  ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY,
  ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
  type FileItem,
  type FilterState,
} from '@/types'
import {
  getFileAnnotationTagKeys,
  getFileAnnotationUpdatedAt,
} from '@/features/preview/utils/annotationDisplayStore'
import { getFileReviewFilterTagKeys } from '@/features/faces/utils/reviewFilterTagStore'

interface FileAnnotationFilterTags {
  annotationTagKeys: string[]
  virtualTagKeys: string[]
}

interface FilterWorkspaceFilesParams {
  files: FileItem[]
  filter: FilterState
  rootId: string
  filterFiles: (files: FileItem[], filter: FilterState) => FileItem[]
  annotationDisplayStoreVersion: unknown
  reviewFilterTagStoreVersion: unknown
}

function isAnnotationBooleanFilterActive(filter: FilterState): boolean {
  return filter.annotationIncludeTagKeys.length > 0 || filter.annotationExcludeTagKeys.length > 0
}

function fileMatchesAnnotationTag(
  annotationTagSet: Set<string>,
  virtualTagSet: Set<string>,
  tagKey: string
): boolean {
  if (tagKey === ANNOTATION_FILTER_UNANNOTATED_TAG_KEY) {
    return annotationTagSet.size === 0
  }
  if (
    tagKey === ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY
    || tagKey === ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY
  ) {
    return virtualTagSet.has(tagKey)
  }
  return annotationTagSet.has(tagKey)
}

function matchesBooleanAnnotationFilter(filter: FilterState, fileTags: FileAnnotationFilterTags): boolean {
  const includeTagKeys = filter.annotationIncludeTagKeys
  const excludeTagKeys = filter.annotationExcludeTagKeys
  if (includeTagKeys.length === 0 && excludeTagKeys.length === 0) {
    return true
  }

  const annotationTagSet = new Set(fileTags.annotationTagKeys)
  const virtualTagSet = new Set(fileTags.virtualTagKeys)
  const includeMatched = includeTagKeys.length === 0
    ? true
    : filter.annotationIncludeMatchMode === 'and'
      ? includeTagKeys.every((tagKey) => fileMatchesAnnotationTag(annotationTagSet, virtualTagSet, tagKey))
      : includeTagKeys.some((tagKey) => fileMatchesAnnotationTag(annotationTagSet, virtualTagSet, tagKey))

  if (!includeMatched) return false

  return !excludeTagKeys.some((tagKey) => fileMatchesAnnotationTag(annotationTagSet, virtualTagSet, tagKey))
}

function compareByNameWithSortOrder(left: FileItem, right: FileItem, sortOrder: FilterState['sortOrder']): number {
  const cmp = left.name.localeCompare(right.name)
  return sortOrder === 'asc' ? cmp : -cmp
}

function sortFilesByAnnotationTime(
  files: FileItem[],
  rootId: string,
  sortOrder: FilterState['sortOrder']
): FileItem[] {
  const next = [...files]
  next.sort((left, right) => {
    if (left.kind === 'directory' && right.kind === 'file') return -1
    if (left.kind === 'file' && right.kind === 'directory') return 1
    if (left.kind === 'directory' && right.kind === 'directory') {
      return compareByNameWithSortOrder(left, right, sortOrder)
    }

    const leftUpdatedAt = getFileAnnotationUpdatedAt(rootId, left.path)
    const rightUpdatedAt = getFileAnnotationUpdatedAt(rootId, right.path)
    const leftAnnotated = leftUpdatedAt !== null
    const rightAnnotated = rightUpdatedAt !== null

    // Unannotated items always stay at the bottom regardless of sort order.
    if (leftAnnotated !== rightAnnotated) {
      return leftAnnotated ? -1 : 1
    }
    if (!leftAnnotated && !rightAnnotated) {
      return compareByNameWithSortOrder(left, right, sortOrder)
    }

    if (leftUpdatedAt !== rightUpdatedAt) {
      const cmp = (leftUpdatedAt ?? 0) - (rightUpdatedAt ?? 0)
      return sortOrder === 'asc' ? cmp : -cmp
    }
    return compareByNameWithSortOrder(left, right, sortOrder)
  })
  return next
}

export function filterWorkspaceFiles({
  files,
  filter,
  rootId,
  filterFiles,
  annotationDisplayStoreVersion,
  reviewFilterTagStoreVersion,
}: FilterWorkspaceFilesParams): FileItem[] {
  // Depend on external store versions so filtering reflects latest tag snapshots.
  void annotationDisplayStoreVersion
  void reviewFilterTagStoreVersion

  let nextFilteredFiles = filterFiles(files, filter)
  if (isAnnotationBooleanFilterActive(filter)) {
    nextFilteredFiles = nextFilteredFiles.filter((file) => {
      if (file.kind !== 'file') return true
      return matchesBooleanAnnotationFilter(filter, {
        annotationTagKeys: getFileAnnotationTagKeys(rootId, file.path),
        virtualTagKeys: getFileReviewFilterTagKeys(rootId, file.path),
      })
    })
  }

  if (filter.sortBy === 'annotationTime') {
    return sortFilesByAnnotationTime(nextFilteredFiles, rootId, filter.sortOrder)
  }

  return nextFilteredFiles
}
