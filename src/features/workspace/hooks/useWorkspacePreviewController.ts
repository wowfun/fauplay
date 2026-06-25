import { useCallback, useEffect, useMemo } from 'react'
import { usePreviewTraversal } from '@/features/preview/hooks/usePreviewTraversal'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
import { useActivePreviewVideoControls } from '@/features/workspace/hooks/useActivePreviewVideoControls'
import { useWorkspaceBrowserHistory } from '@/features/workspace/hooks/useWorkspaceBrowserHistory'
import { useWorkspacePreviewPaneWidth } from '@/features/workspace/hooks/useWorkspacePreviewPaneWidth'
import {
  preloadWorkspacePreviewModulesSoon,
  useWorkspacePreviewOpenActions,
} from '@/features/workspace/hooks/useWorkspacePreviewOpenActions'
import { resolveWorkspacePreviewCapabilityModel } from '@/features/workspace/lib/workspacePreviewCapabilityModel'
import type { WorkspacePresentationProfile } from '@/features/workspace/types/presentation'
import type { AccessProvider } from '@/lib/accessState'
import type { RuntimeToolDescriptor } from '@/lib/runtimeApi/toolDescriptors'
import type { FileItem, ThumbnailSizePreset } from '@/types'

interface UseWorkspacePreviewControllerParams {
  accessProvider: AccessProvider
  rootId: string
  currentPath: string
  filteredFiles: FileItem[]
  activeSurfaceFiles: FileItem[]
  thumbnailSizePreset: ThumbnailSizePreset
  pluginTools: RuntimeToolDescriptor[]
  presentationProfile: WorkspacePresentationProfile
  navigateToPath: (
    targetPath: string,
    options?: { resetFlattenView?: boolean }
  ) => Promise<boolean>
}

export function useWorkspacePreviewController({
  accessProvider,
  rootId,
  currentPath,
  filteredFiles,
  activeSurfaceFiles,
  thumbnailSizePreset,
  pluginTools,
  presentationProfile,
  navigateToPath,
}: UseWorkspacePreviewControllerParams) {
  const previewTraversal = usePreviewTraversal({ filteredFiles: activeSurfaceFiles })
  const {
    selectedFile,
    previewFile,
    showPreviewPane,
    videoSeekStepSec,
    videoPlaybackRate,
    closePreviewPane,
    openFileInModal,
    showFileInPane,
    navigateMediaFromPane,
    navigateMediaFromModal,
    canNavigateMediaFromPane,
    canNavigateMediaFromModal,
  } = previewTraversal
  const previewPaneWidth = useWorkspacePreviewPaneWidth({
    showPreviewPane,
    thumbnailSizePreset,
  })
  const {
    activePreviewFile: activePreviewFileForTagShortcuts,
    previewNavigationSurface,
    hasActiveVideoPreview,
    canRunTagShortcuts: canRunPreviewTagShortcuts,
    canSoftDelete: canSoftDeleteActivePreview,
  } = useMemo(() => resolveWorkspacePreviewCapabilityModel({
    previewFile,
    selectedFile,
    showPreviewPane,
    pluginTools,
  }), [pluginTools, previewFile, selectedFile, showPreviewPane])
  const canNavigatePreviewBackward = previewNavigationSurface === 'lightbox'
    ? canNavigateMediaFromModal
    : canNavigateMediaFromPane
  const canNavigatePreviewForward = previewNavigationSurface === 'lightbox'
    ? canNavigateMediaFromModal
    : canNavigateMediaFromPane
  const handleNavigatePreviewBackward = useCallback(() => {
    if (previewNavigationSurface === 'lightbox') {
      navigateMediaFromModal('prev')
      return
    }
    navigateMediaFromPane('prev')
  }, [navigateMediaFromModal, navigateMediaFromPane, previewNavigationSurface])
  const handleNavigatePreviewForward = useCallback(() => {
    if (previewNavigationSurface === 'lightbox') {
      navigateMediaFromModal('next')
      return
    }
    navigateMediaFromPane('next')
  }, [navigateMediaFromModal, navigateMediaFromPane, previewNavigationSurface])
  const { getMatchingPreviewTagShortcut } = useResolvedPreviewTagShortcuts({
    rootId,
    relativePath: activePreviewFileForTagShortcuts?.kind === 'file'
      ? activePreviewFileForTagShortcuts.path
      : null,
    enabled: canRunPreviewTagShortcuts,
  })
  const activePreviewVideoControls = useActivePreviewVideoControls({
    preferredSurface: previewNavigationSurface === 'lightbox' ? 'lightbox' : 'panel',
    seekStepSec: videoSeekStepSec,
    playbackRate: videoPlaybackRate,
    enabled: hasActiveVideoPreview,
  })
  const previewOpenActions = useWorkspacePreviewOpenActions({
    presentationProfile,
    closePreviewPane,
    openFileInModal,
    showFileInPane,
  })

  useWorkspaceBrowserHistory({
    accessProvider,
    rootId,
    currentPath,
    supportsPersistentPreviewPane: presentationProfile.supportsPersistentPreviewPane,
    filteredFiles,
    selectedFile,
    previewFile,
    showPreviewPane,
    navigateToPath,
    closePreviewModal: previewTraversal.closePreviewModal,
    closePreviewPane,
    openFileInModal,
    openFileInPaneOrFullscreenFallback: previewOpenActions.openFileInPaneOrFullscreenFallback,
  })

  useEffect(() => {
    return preloadWorkspacePreviewModulesSoon()
  }, [])

  return {
    ...previewTraversal,
    ...previewPaneWidth,
    ...activePreviewVideoControls,
    ...previewOpenActions,
    activePreviewFileForTagShortcuts,
    hasActiveVideoPreview,
    canRunPreviewTagShortcuts,
    canSoftDeleteActivePreview,
    canNavigatePreviewBackward,
    canNavigatePreviewForward,
    handleNavigatePreviewBackward,
    handleNavigatePreviewForward,
    getMatchingPreviewTagShortcut,
  }
}
