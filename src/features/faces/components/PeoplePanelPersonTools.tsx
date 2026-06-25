import type { PeoplePanelPersonToolsState } from '@/features/faces/lib/peoplePanelModel'
import { PersonMergeTargetList } from '@/features/faces/components/PersonMergeTargetList'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'

export interface PeoplePanelPersonToolsActions {
  onRenameDraftChange: (value: string) => void
  onSaveRename: () => void
  onMergeTargetQueryChange: (value: string) => void
  onMergeTargetPersonChange: (personId: string) => void
  onMerge: () => void
}

interface PeoplePanelPersonToolsProps {
  layout: 'compact' | 'wide'
  state: PeoplePanelPersonToolsState
  actions: PeoplePanelPersonToolsActions
}

export function PeoplePanelPersonTools({
  layout,
  state,
  actions,
}: PeoplePanelPersonToolsProps) {
  const {
    scope,
    renameDraft,
    mergeTargetQuery,
    mergeTargetCandidates,
    mergeTargetPersonId,
    isSavingRename,
    isMerging,
  } = state
  const {
    onRenameDraftChange,
    onSaveRename,
    onMergeTargetQueryChange,
    onMergeTargetPersonChange,
    onMerge,
  } = actions
  const mergeDescription = '当前人物会被合并到目标人物，当前人物将消失。'

  if (layout === 'compact') {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">重命名</div>
          <div className="flex flex-col gap-2">
            <Input
              value={renameDraft}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              placeholder="人物名称，可留空"
              disabled={isSavingRename}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={isSavingRename}
              onClick={onSaveRename}
            >
              保存
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">将当前人物并入</div>
          <div className="text-xs text-muted-foreground">{mergeDescription}</div>
          <Input
            value={mergeTargetQuery}
            onChange={(event) => onMergeTargetQueryChange(event.target.value)}
            placeholder="搜索目标人物"
            disabled={isMerging}
          />
          <PersonMergeTargetList
            people={mergeTargetCandidates}
            selectedPersonId={mergeTargetPersonId}
            scope={scope}
            disabled={isMerging}
            layout="compact"
            onSelectPerson={onMergeTargetPersonChange}
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isMerging || !mergeTargetPersonId}
            onClick={onMerge}
          >
            并入该人物
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-3">
      <div className="min-w-[280px] flex-1">
        <div className="mb-2 text-xs font-medium text-muted-foreground">重命名</div>
        <div className="flex gap-2">
          <Input
            value={renameDraft}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            placeholder="人物名称，可留空"
            disabled={isSavingRename}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={isSavingRename}
            onClick={onSaveRename}
          >
            保存
          </Button>
        </div>
      </div>

      <div className="min-w-[360px] flex-[1.4] space-y-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground">将当前人物并入</div>
          <div className="mt-1 text-xs text-muted-foreground">{mergeDescription}</div>
        </div>
        <Input
          value={mergeTargetQuery}
          onChange={(event) => onMergeTargetQueryChange(event.target.value)}
          placeholder="搜索目标人物"
          disabled={isMerging}
        />
        <PersonMergeTargetList
          people={mergeTargetCandidates}
          selectedPersonId={mergeTargetPersonId}
          scope={scope}
          disabled={isMerging}
          layout="wide"
          onSelectPerson={onMergeTargetPersonChange}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={isMerging || !mergeTargetPersonId}
          onClick={onMerge}
        >
          并入该人物
        </Button>
      </div>
    </div>
  )
}
