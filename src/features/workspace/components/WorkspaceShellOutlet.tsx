import type { ComponentProps } from 'react'
import { CompactWorkspaceShell } from '@/features/workspace/components/CompactWorkspaceShell'
import { resolveWorkspaceShellRenderPlan } from '@/features/workspace/lib/workspaceShellRenderModel'
import type { WorkspacePresentationProfile } from '@/features/workspace/types/presentation'
import { ExplorerWorkspaceLayout } from '@/layouts/ExplorerWorkspaceLayout'

interface WorkspaceShellOutletProps {
  shellProps: ComponentProps<typeof ExplorerWorkspaceLayout>
  presentationProfile: WorkspacePresentationProfile
  canNavigatePreviewBackward: boolean
  canNavigatePreviewForward: boolean
  onNavigatePreviewBackward: () => void
  onNavigatePreviewForward: () => void
}

export function WorkspaceShellOutlet({
  shellProps,
  presentationProfile,
  canNavigatePreviewBackward,
  canNavigatePreviewForward,
  onNavigatePreviewBackward,
  onNavigatePreviewForward,
}: WorkspaceShellOutletProps) {
  const renderPlan = resolveWorkspaceShellRenderPlan({
    presentationProfile,
    canNavigatePreviewBackward,
    canNavigatePreviewForward,
  })

  if (renderPlan.kind === 'compact') {
    return (
      <CompactWorkspaceShell
        {...shellProps}
        presentationProfile={presentationProfile}
        canNavigatePreviewBackward={renderPlan.canNavigatePreviewBackward}
        canNavigatePreviewForward={renderPlan.canNavigatePreviewForward}
        onNavigatePreviewBackward={onNavigatePreviewBackward}
        onNavigatePreviewForward={onNavigatePreviewForward}
      />
    )
  }

  return (
    <ExplorerWorkspaceLayout
      {...shellProps}
      previewHeaderTitleMode={renderPlan.previewHeaderTitleMode}
      showPreviewUnavailableReasons={renderPlan.showPreviewUnavailableReasons}
    />
  )
}
