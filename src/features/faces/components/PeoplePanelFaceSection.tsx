import type { FaceApiContext } from '@/features/faces/api'
import { FaceGrid } from '@/features/faces/components/FaceGrid'
import { FaceSelectionActions } from '@/features/faces/components/FaceSelectionActions'
import {
  resolvePeoplePanelFaceSectionModel,
  type PeoplePanelFaceSectionLayout,
} from '@/features/faces/lib/peoplePanelModel'
import type { PanelView } from '@/features/faces/lib/peoplePanelText'
import type { FaceRecord, PersonScope } from '@/features/faces/types'
import { Button } from '@/ui/Button'

type FaceActionHandler = () => Promise<boolean | void> | boolean | void

export interface PeoplePanelFaceSectionState {
  view: PanelView
  readonly: boolean
  context: FaceApiContext
  scope: PersonScope
  faces: FaceRecord[]
  selectedFaceIds: Set<string>
  selectedIds: string[]
  selectedFaces: FaceRecord[]
  excludedPersonIds: string[]
  assignmentInputKey: string
  isLoadingFaces: boolean
  isMutatingFaces: boolean
  isProjectingSources: boolean
}

export interface PeoplePanelFaceSectionActions {
  onClearSelection: () => void
  onSelectionChange: (faceIds: string[]) => void
  onOpenFaceSource: (face: FaceRecord) => boolean | Promise<boolean>
  onAssign: (personId: string) => Promise<boolean | void> | boolean | void
  onCreate: (name: string) => Promise<boolean | void> | boolean | void
  onUnassign: FaceActionHandler
  onIgnore: FaceActionHandler
  onRestoreIgnored: FaceActionHandler
  onRequeue: FaceActionHandler
  onProjectSources: FaceActionHandler
}

interface PeoplePanelFaceSectionProps {
  layout: PeoplePanelFaceSectionLayout
  state: PeoplePanelFaceSectionState
  actions: PeoplePanelFaceSectionActions
}

export function PeoplePanelFaceSection({
  layout,
  state,
  actions,
}: PeoplePanelFaceSectionProps) {
  const {
    view,
    readonly,
    context,
    scope,
    faces,
    selectedFaceIds,
    selectedIds,
    selectedFaces,
    excludedPersonIds,
    assignmentInputKey,
    isLoadingFaces,
    isMutatingFaces,
    isProjectingSources,
  } = state
  const {
    onClearSelection,
    onSelectionChange,
    onOpenFaceSource,
    onAssign,
    onCreate,
    onUnassign,
    onIgnore,
    onRestoreIgnored,
    onRequeue,
    onProjectSources,
  } = actions

  const section = resolvePeoplePanelFaceSectionModel({
    layout,
    view,
    readonly,
    selectedFaceCount: selectedFaceIds.size,
    faceCount: faces.length,
    assignmentInputKey,
  })

  return (
    <div className={layout === 'wide'
      ? 'mb-4 rounded-md border border-border p-4'
      : 'rounded-xl border border-border bg-card p-4'}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{section.title}</div>
          <div className="text-xs text-muted-foreground">{section.subtitle}</div>
        </div>
        {selectedFaceIds.size > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            清空选择
          </Button>
        )}
      </div>

      {!readonly && (
        <FaceSelectionActions
          className="mb-4"
          assignmentClassName={section.assignmentClassName ?? undefined}
          layout={section.actionLayout}
          assignmentInputKey={section.assignmentInputKey}
          context={context}
          scope={scope}
          selectedFaceIds={selectedIds}
          selectedFaces={selectedFaces}
          excludedPersonIds={excludedPersonIds}
          isMutatingFaces={isMutatingFaces}
          isProjectingSources={isProjectingSources}
          onAssign={onAssign}
          onCreate={onCreate}
          onUnassign={onUnassign}
          onIgnore={onIgnore}
          onRestoreIgnored={onRestoreIgnored}
          onRequeue={onRequeue}
          onProjectSources={onProjectSources}
        />
      )}

      {isLoadingFaces ? (
        <div className="py-8 text-sm text-muted-foreground">人脸数据加载中...</div>
      ) : (
        <FaceGrid
          compact={section.compactGrid}
          faces={faces}
          selectedFaceIds={selectedFaceIds}
          onSelectionChange={onSelectionChange}
          onOpenFaceSource={onOpenFaceSource}
        />
      )}
    </div>
  )
}
