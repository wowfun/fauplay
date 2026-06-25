import type { FileItem } from '../../../types/index.ts'
import { sortTrashFileItems } from './listingQueryModel.ts'

export interface UnifiedTrashListingItemsParams {
  rootTrashFiles: FileItem[]
  globalTrashFiles: FileItem[]
}

export function toUnifiedTrashListingItems({
  rootTrashFiles,
  globalTrashFiles,
}: UnifiedTrashListingItemsParams): FileItem[] {
  return sortTrashFileItems([...rootTrashFiles, ...globalTrashFiles])
}
