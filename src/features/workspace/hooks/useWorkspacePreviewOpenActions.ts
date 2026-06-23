import { useCallback } from 'react'
import type { WorkspacePresentationProfile } from '@/features/workspace/types/presentation'
import type { FileItem } from '@/types'

let previewPanelModulesPreloaded = false

function preloadPreviewModules(): void {
  if (previewPanelModulesPreloaded) return
  previewPanelModulesPreloaded = true

  const preloaders = [
    () => import('@/features/preview/components/FilePreviewPanel'),
    () => import('@/features/preview/components/FilePreviewCanvas'),
    () => import('@/features/preview/components/PreviewHeaderBar'),
    () => import('@/features/preview/components/PreviewControlGroup'),
    () => import('@/features/preview/components/PreviewTitleRow'),
    () => import('@/features/preview/components/MediaPlaybackControls'),
    () => import('@/features/preview/components/FilePreviewViewport'),
    () => import('@/features/preview/components/PreviewFeedbackOverlay'),
  ]

  for (const load of preloaders) {
    void load().catch(() => {})
  }
}

interface UseWorkspacePreviewOpenActionsParams {
  presentationProfile: WorkspacePresentationProfile
  closePreviewPane: () => void
  openFileInModal: (file: FileItem) => void
  showFileInPane: (file: FileItem) => void
}

interface WorkspacePreviewOpenActions {
  openFileInPrimaryTarget: (file: FileItem) => void
  openFileInSecondaryTarget: (file: FileItem) => void
  openFileInPaneOrFullscreenFallback: (file: FileItem) => void
}

export function useWorkspacePreviewOpenActions({
  presentationProfile,
  closePreviewPane,
  openFileInModal,
  showFileInPane,
}: UseWorkspacePreviewOpenActionsParams): WorkspacePreviewOpenActions {
  const openFileInPrimaryTarget = useCallback((file: FileItem) => {
    if (file.kind !== 'file') return

    preloadPreviewModules()
    if (presentationProfile.primaryFileOpenTarget === 'fullscreen') {
      closePreviewPane()
      openFileInModal(file)
      return
    }

    showFileInPane(file)
  }, [
    closePreviewPane,
    openFileInModal,
    presentationProfile.primaryFileOpenTarget,
    showFileInPane,
  ])

  const openFileInSecondaryTarget = useCallback((file: FileItem) => {
    if (file.kind !== 'file') return

    preloadPreviewModules()
    if (presentationProfile.supportsPersistentPreviewPane && presentationProfile.primaryFileOpenTarget === 'pane') {
      openFileInModal(file)
      return
    }

    closePreviewPane()
    openFileInModal(file)
  }, [
    closePreviewPane,
    openFileInModal,
    presentationProfile.primaryFileOpenTarget,
    presentationProfile.supportsPersistentPreviewPane,
  ])

  const openFileInPaneOrFullscreenFallback = useCallback((file: FileItem) => {
    if (file.kind !== 'file') return

    preloadPreviewModules()
    if (presentationProfile.supportsPersistentPreviewPane) {
      showFileInPane(file)
      return
    }

    closePreviewPane()
    openFileInModal(file)
  }, [
    closePreviewPane,
    openFileInModal,
    presentationProfile.supportsPersistentPreviewPane,
    showFileInPane,
  ])

  return {
    openFileInPrimaryTarget,
    openFileInSecondaryTarget,
    openFileInPaneOrFullscreenFallback,
  }
}

export function preloadWorkspacePreviewModulesSoon(): () => void {
  const timeoutId = window.setTimeout(() => {
    preloadPreviewModules()
  }, 0)

  return () => {
    window.clearTimeout(timeoutId)
  }
}
