import type { AccessProvider } from '@/lib/accessState'

export type ViewportMode = 'wide' | 'compact'

export type InputMode = 'keyboard' | 'touch' | 'hybrid'

export type WorkspaceAccessMode = 'full-access' | 'remote-readonly'

export interface WorkspacePreviewNavigationUi {
  showButtons: boolean
  enableImageSwipe: boolean
}

export interface WorkspacePresentationProfile {
  viewportMode: ViewportMode
  inputMode: InputMode
  accessMode: WorkspaceAccessMode
  shellKind: ViewportMode
  primaryFileOpenTarget: 'pane' | 'fullscreen'
  supportsPersistentPreviewPane: boolean
  toolbarKind: ViewportMode
  peoplePanelKind: 'side-panel' | 'overlay'
  resultPanelKind: 'bottom-panel' | 'overlay'
  previewNavigationUi: WorkspacePreviewNavigationUi
  previewHeaderTitleMode: 'actionable' | 'static'
  showPreviewUnavailableReasons: boolean
  pluginRegionKind: 'sidebar' | 'overlay' | 'hidden'
}

export function toWorkspaceAccessMode(accessProvider: AccessProvider): WorkspaceAccessMode {
  return accessProvider === 'remote-readonly' ? 'remote-readonly' : 'full-access'
}
