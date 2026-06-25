import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { FileItem } from '@/types'
import {
  resolveWorkspaceDirectoryEntryInteraction,
  resolveWorkspaceShellPresentationTransition,
  type WorkspaceDirectoryEntryInteractionIntent,
} from '@/features/workspace/lib/workspaceShellInteractionModel'
import type { WorkspaceActiveSurface } from '@/features/workspace/lib/projectionTabRecords'
import type { WorkspacePresentationProfile } from '@/features/workspace/types/presentation'

interface UseWorkspaceShellInteractionHandlersOptions {
  shellKind: WorkspacePresentationProfile['shellKind']
  supportsPersistentPreviewPane: boolean
  showPreviewPane: boolean
  selectedFile: FileItem | null
  previewFile: FileItem | null
  closePreviewPane: () => void
  openFileInModal: (file: FileItem) => void
  setActiveSurface: Dispatch<SetStateAction<WorkspaceActiveSurface>>
  navigateToDirectory: (dirName: string) => Promise<void>
  setDirectoryFocusedPath: Dispatch<SetStateAction<string | null>>
  openFileInPrimaryTarget: (file: FileItem) => void
  openFileInSecondaryTarget: (file: FileItem) => void
}

interface WorkspaceShellInteractionHandlers {
  handleDirectoryClick: (dirName: string) => void
  handleDirectoryFileClick: (file: FileItem) => void
  handleDirectoryFileDoubleClick: (file: FileItem) => void
}

export function useWorkspaceShellInteractionHandlers({
  shellKind,
  supportsPersistentPreviewPane,
  showPreviewPane,
  selectedFile,
  previewFile,
  closePreviewPane,
  openFileInModal,
  setActiveSurface,
  navigateToDirectory,
  setDirectoryFocusedPath,
  openFileInPrimaryTarget,
  openFileInSecondaryTarget,
}: UseWorkspaceShellInteractionHandlersOptions): WorkspaceShellInteractionHandlers {
  const previousShellKindRef = useRef(shellKind)

  useEffect(() => {
    const previousShellKind = previousShellKindRef.current
    previousShellKindRef.current = shellKind

    const transition = resolveWorkspaceShellPresentationTransition({
      previousShellKind,
      currentShellKind: shellKind,
      supportsPersistentPreviewPane,
      showPreviewPane,
      selectedFile,
      previewFile,
    })
    if (transition.kind === 'none') return

    closePreviewPane()
    if (transition.openFileInLightbox) {
      openFileInModal(transition.openFileInLightbox)
    }
  }, [
    closePreviewPane,
    openFileInModal,
    previewFile,
    selectedFile,
    shellKind,
    showPreviewPane,
    supportsPersistentPreviewPane,
  ])

  const handleDirectoryInteractionIntent = useCallback((intent: WorkspaceDirectoryEntryInteractionIntent) => {
    if (intent.kind === 'none') return
    setActiveSurface({ kind: 'directory' })

    if (intent.kind === 'navigate-directory') {
      void navigateToDirectory(intent.dirName)
      return
    }

    setDirectoryFocusedPath(intent.focusedPath)
    if (intent.target === 'secondary') {
      openFileInSecondaryTarget(intent.file)
    } else {
      openFileInPrimaryTarget(intent.file)
    }
  }, [
    navigateToDirectory,
    openFileInPrimaryTarget,
    openFileInSecondaryTarget,
    setActiveSurface,
    setDirectoryFocusedPath,
  ])

  const handleDirectoryClick = useCallback((dirName: string) => {
    handleDirectoryInteractionIntent(resolveWorkspaceDirectoryEntryInteraction({
      kind: 'directory-name-click',
      dirName,
    }))
  }, [handleDirectoryInteractionIntent])

  const handleDirectoryFileClick = useCallback((file: FileItem) => {
    handleDirectoryInteractionIntent(resolveWorkspaceDirectoryEntryInteraction({
      kind: 'entry-click',
      item: file,
    }))
  }, [handleDirectoryInteractionIntent])

  const handleDirectoryFileDoubleClick = useCallback((file: FileItem) => {
    handleDirectoryInteractionIntent(resolveWorkspaceDirectoryEntryInteraction({
      kind: 'entry-double-click',
      item: file,
    }))
  }, [handleDirectoryInteractionIntent])

  return {
    handleDirectoryClick,
    handleDirectoryFileClick,
    handleDirectoryFileDoubleClick,
  }
}
