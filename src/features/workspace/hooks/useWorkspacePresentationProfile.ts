import { useMemo } from 'react'
import type { AccessProvider } from '@/lib/accessState'
import {
  toWorkspaceAccessMode,
  type InputMode,
  type ViewportMode,
  type WorkspacePresentationProfile,
} from '@/features/workspace/types/presentation'

interface UseWorkspacePresentationProfileOptions {
  accessProvider: AccessProvider
  viewportMode: ViewportMode
  inputMode: InputMode
}

export function useWorkspacePresentationProfile({
  accessProvider,
  viewportMode,
  inputMode,
}: UseWorkspacePresentationProfileOptions): WorkspacePresentationProfile {
  return useMemo(() => {
    const accessMode = toWorkspaceAccessMode(accessProvider)
    const shellKind = viewportMode
    const isCompact = shellKind === 'compact'
    const isRemoteReadonly = accessMode === 'remote-readonly'

    return {
      viewportMode,
      inputMode,
      accessMode,
      shellKind,
      primaryFileOpenTarget: isCompact ? 'fullscreen' : 'pane',
      supportsPersistentPreviewPane: !isCompact,
      toolbarKind: shellKind,
      peoplePanelKind: isCompact ? 'overlay' : 'side-panel',
      resultPanelKind: isCompact ? 'overlay' : 'bottom-panel',
      previewNavigationUi: {
        showButtons: isCompact || inputMode !== 'keyboard',
        enableImageSwipe: isCompact && inputMode !== 'keyboard',
      },
      previewHeaderTitleMode: isRemoteReadonly ? 'static' : 'actionable',
      showPreviewUnavailableReasons: !isRemoteReadonly,
      pluginRegionKind: isRemoteReadonly
        ? 'hidden'
        : isCompact
          ? 'overlay'
          : 'sidebar',
    }
  }, [accessProvider, inputMode, viewportMode])
}
