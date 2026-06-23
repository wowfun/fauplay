import { useMemo } from 'react'
import { isImageFile, isVideoFile } from '@/lib/fileSystem'
import type { FileItem } from '@/types'

interface UseWorkspaceFileSelectionSummaryParams {
  filteredFiles: FileItem[]
  activeSurfaceFiles: FileItem[]
  activeSurfaceSelectedPaths: string[]
}

interface WorkspaceFileSelectionSummary {
  totalCount: number
  imageCount: number
  videoCount: number
  selectedGridItems: FileItem[]
  selectedGridMetaFile: FileItem | null
}

export function useWorkspaceFileSelectionSummary({
  filteredFiles,
  activeSurfaceFiles,
  activeSurfaceSelectedPaths,
}: UseWorkspaceFileSelectionSummaryParams): WorkspaceFileSelectionSummary {
  const totalCount = useMemo(() => filteredFiles.length, [filteredFiles])
  const imageCount = useMemo(
    () => filteredFiles.filter((file) => file.kind === 'file' && isImageFile(file.name)).length,
    [filteredFiles]
  )
  const videoCount = useMemo(
    () => filteredFiles.filter((file) => file.kind === 'file' && isVideoFile(file.name)).length,
    [filteredFiles]
  )
  const selectedGridItems = useMemo(() => {
    if (activeSurfaceSelectedPaths.length === 0) return []
    const selectedPathSet = new Set(activeSurfaceSelectedPaths)
    return activeSurfaceFiles.filter((file) => selectedPathSet.has(file.path))
  }, [activeSurfaceFiles, activeSurfaceSelectedPaths])
  const selectedGridMetaFile = useMemo(() => {
    if (selectedGridItems.length !== 1) return null
    return selectedGridItems[0]?.kind === 'file' ? selectedGridItems[0] : null
  }, [selectedGridItems])

  return {
    totalCount,
    imageCount,
    videoCount,
    selectedGridItems,
    selectedGridMetaFile,
  }
}
