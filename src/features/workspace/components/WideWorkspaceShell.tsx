import type { ComponentProps } from 'react'
import { ExplorerWorkspaceLayout } from '@/layouts/ExplorerWorkspaceLayout'
import type { WorkspacePresentationProfile } from '@/features/workspace/types/presentation'

type WideWorkspaceShellProps = ComponentProps<typeof ExplorerWorkspaceLayout> & {
  presentationProfile: WorkspacePresentationProfile
}

export function WideWorkspaceShell({
  presentationProfile,
  ...props
}: WideWorkspaceShellProps) {
  return (
    <ExplorerWorkspaceLayout
      {...props}
      previewHeaderTitleMode={presentationProfile.previewHeaderTitleMode}
      showPreviewUnavailableReasons={presentationProfile.showPreviewUnavailableReasons}
    />
  )
}
