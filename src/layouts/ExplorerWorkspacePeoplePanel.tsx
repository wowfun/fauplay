import { lazy, Suspense, useEffect, useState } from 'react'
import type { FaceRecord } from '@/features/faces/types'

const PeoplePanel = lazy(async () => {
  const mod = await import('@/features/faces/components/PeoplePanel')
  return { default: mod.PeoplePanel }
})

interface ExplorerWorkspacePeoplePanelProps {
  accessProvider: 'local-browser' | 'remote-readonly'
  showPeoplePanel: boolean
  peoplePanelPreferredPersonId: string | null
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  onClosePeoplePanel: () => void
  onOpenFaceSource: (face: FaceRecord) => boolean | Promise<boolean>
  onProjectFaceSources: (faces: FaceRecord[]) => boolean | Promise<boolean>
}

export function ExplorerWorkspacePeoplePanel({
  accessProvider,
  showPeoplePanel,
  peoplePanelPreferredPersonId,
  rootHandle,
  rootId,
  onClosePeoplePanel,
  onOpenFaceSource,
  onProjectFaceSources,
}: ExplorerWorkspacePeoplePanelProps) {
  const [hasOpenedPeoplePanel, setHasOpenedPeoplePanel] = useState(showPeoplePanel)

  useEffect(() => {
    if (showPeoplePanel) {
      setHasOpenedPeoplePanel(true)
    }
  }, [showPeoplePanel])

  if (!hasOpenedPeoplePanel) return null

  return (
    <Suspense fallback={null}>
      <PeoplePanel
        open={showPeoplePanel}
        rootHandle={rootHandle}
        rootId={rootId ?? ''}
        layoutMode="wide"
        readonly={accessProvider === 'remote-readonly'}
        preferredPersonId={peoplePanelPreferredPersonId}
        onClose={onClosePeoplePanel}
        onOpenFaceSource={onOpenFaceSource}
        onProjectFaceSources={onProjectFaceSources}
      />
    </Suspense>
  )
}
