import type { FaceApiContext } from '@/features/faces/api'
import { PersonAssignmentInput } from '@/features/faces/components/PersonAssignmentInput'
import type { FaceRecord, PersonScope } from '@/features/faces/types'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'

type ActionLayout = 'inline' | 'stacked'
type FaceActionHandler = () => Promise<boolean | void> | boolean | void

interface FaceSelectionActionsProps {
  context: FaceApiContext
  scope: PersonScope
  assignmentInputKey: string
  selectedFaceIds: string[]
  selectedFaces: FaceRecord[]
  excludedPersonIds: string[]
  isMutatingFaces: boolean
  isProjectingSources: boolean
  layout?: ActionLayout
  className?: string
  assignmentClassName?: string
  onAssign: (personId: string) => Promise<boolean | void> | boolean | void
  onCreate: (name: string) => Promise<boolean | void> | boolean | void
  onUnassign: FaceActionHandler
  onIgnore: FaceActionHandler
  onRestoreIgnored: FaceActionHandler
  onRequeue: FaceActionHandler
  onProjectSources: FaceActionHandler
}

export function FaceSelectionActions({
  context,
  scope,
  assignmentInputKey,
  selectedFaceIds,
  selectedFaces,
  excludedPersonIds,
  isMutatingFaces,
  isProjectingSources,
  layout = 'inline',
  className,
  assignmentClassName,
  onAssign,
  onCreate,
  onUnassign,
  onIgnore,
  onRestoreIgnored,
  onRequeue,
  onProjectSources,
}: FaceSelectionActionsProps) {
  const selectedCount = selectedFaceIds.length
  const hasIgnoredFace = selectedFaces.some((face) => face.status === 'ignored')
  const hasManualUnassignedFace = selectedFaces.some((face) => face.status === 'manual_unassigned')
  const isStacked = layout === 'stacked'
  const buttonClassName = isStacked ? 'w-full' : undefined

  return (
    <div className={cn('space-y-3 rounded-md border border-border bg-muted/20 p-3', className)}>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">归属到人物</div>
        <PersonAssignmentInput
          key={assignmentInputKey}
          context={context}
          scope={scope}
          querySize={40}
          emptyQuerySize={40}
          className={assignmentClassName}
          disabled={isMutatingFaces || selectedCount === 0}
          excludedPersonIds={excludedPersonIds}
          onAssign={onAssign}
          onCreate={onCreate}
        />
      </div>

      <div className={isStacked ? 'grid grid-cols-1 gap-2' : 'flex flex-wrap gap-2'}>
        <Button
          variant="outline"
          size="sm"
          className={buttonClassName}
          disabled={isMutatingFaces || selectedCount === 0}
          onClick={() => {
            void onUnassign()
          }}
        >
          移出为未归属
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={buttonClassName}
          disabled={isMutatingFaces || selectedCount === 0}
          onClick={() => {
            void onIgnore()
          }}
        >
          标记忽略
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={buttonClassName}
          disabled={isMutatingFaces || !hasIgnoredFace}
          onClick={() => {
            void onRestoreIgnored()
          }}
        >
          恢复忽略
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={buttonClassName}
          disabled={isMutatingFaces || !hasManualUnassignedFace}
          onClick={() => {
            void onRequeue()
          }}
        >
          重新交给聚类
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={buttonClassName}
          disabled={isMutatingFaces || isProjectingSources || selectedCount === 0}
          onClick={() => {
            void onProjectSources()
          }}
        >
          投射源文件
        </Button>
      </div>
    </div>
  )
}
