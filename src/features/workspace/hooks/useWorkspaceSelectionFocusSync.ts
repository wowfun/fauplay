import { useEffect, type RefObject } from 'react'
import type { FileBrowserGridHandle } from '@/features/explorer/components/FileBrowserGrid'
import type { WorkspaceActiveSurface } from '@/features/workspace/lib/projectionTabRecords'
import type { FileItem, ResultProjection } from '@/types'

interface UseWorkspaceSelectionFocusSyncParams {
  selectedFile: FileItem | null
  activeSurface: WorkspaceActiveSurface
  projectionTabs: ResultProjection[]
  setProjectionFocusedPathById: (
    update: (previous: Record<string, string | null>) => Record<string, string | null>
  ) => void
  setDirectoryFocusedPath: (
    update: (previous: string | null) => string | null
  ) => void
  directoryFileGridRef: RefObject<FileBrowserGridHandle>
  projectionFileGridRef: RefObject<FileBrowserGridHandle>
}

export function useWorkspaceSelectionFocusSync({
  selectedFile,
  activeSurface,
  projectionTabs,
  setProjectionFocusedPathById,
  setDirectoryFocusedPath,
  directoryFileGridRef,
  projectionFileGridRef,
}: UseWorkspaceSelectionFocusSyncParams): void {
  useEffect(() => {
    if (selectedFile?.kind !== 'file') return
    if (activeSurface.kind === 'projection') {
      const activeProjection = projectionTabs.find((projection) => projection.id === activeSurface.tabId) ?? null
      if (!activeProjection || !activeProjection.files.some((file) => file.path === selectedFile.path)) {
        return
      }
      setProjectionFocusedPathById((previous) => (
        previous[activeSurface.tabId] === selectedFile.path
          ? previous
          : {
            ...previous,
            [activeSurface.tabId]: selectedFile.path,
          }
      ))
      return
    }
    setDirectoryFocusedPath((previous) => (previous === selectedFile.path ? previous : selectedFile.path))
  }, [activeSurface, projectionTabs, selectedFile, setDirectoryFocusedPath, setProjectionFocusedPathById])

  useEffect(() => {
    const activeGridRef = activeSurface.kind === 'projection' ? projectionFileGridRef : directoryFileGridRef
    activeGridRef.current?.syncSelectedPath(selectedFile?.path ?? null, {
      scroll: true,
      focus: false,
    })
  }, [activeSurface, directoryFileGridRef, projectionFileGridRef, selectedFile])
}
