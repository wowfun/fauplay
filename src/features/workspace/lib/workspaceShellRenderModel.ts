import type { WorkspacePresentationProfile } from '../types/presentation.ts'

export type WorkspaceShellRenderPlan =
  | {
    kind: 'wide'
    previewHeaderTitleMode: WorkspacePresentationProfile['previewHeaderTitleMode']
    showPreviewUnavailableReasons: boolean
  }
  | {
    kind: 'compact'
    canNavigatePreviewBackward: boolean
    canNavigatePreviewForward: boolean
  }

export interface ResolveWorkspaceShellRenderPlanParams {
  presentationProfile: WorkspacePresentationProfile
  canNavigatePreviewBackward: boolean
  canNavigatePreviewForward: boolean
}

export function resolveWorkspaceShellRenderPlan({
  presentationProfile,
  canNavigatePreviewBackward,
  canNavigatePreviewForward,
}: ResolveWorkspaceShellRenderPlanParams): WorkspaceShellRenderPlan {
  if (presentationProfile.shellKind === 'compact') {
    return {
      kind: 'compact',
      canNavigatePreviewBackward,
      canNavigatePreviewForward,
    }
  }

  return {
    kind: 'wide',
    previewHeaderTitleMode: presentationProfile.previewHeaderTitleMode,
    showPreviewUnavailableReasons: presentationProfile.showPreviewUnavailableReasons,
  }
}
