import type { FileItem } from '@/types'

export interface WorkspaceProjectionInteraction {
  openFileInPrimaryTarget: (file: FileItem) => void
  openFileInSecondaryTarget: (file: FileItem) => void
  alignPreviewToPath: (path: string | null) => void
}
