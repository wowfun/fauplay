import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { NoticeTone } from '@/features/faces/lib/peoplePanelText'
import { usePeoplePanelDataController } from '@/features/faces/hooks/usePeoplePanelDataController'
import { usePeoplePanelFaceMutationController } from '@/features/faces/hooks/usePeoplePanelFaceMutationController'
import { usePeoplePanelPersonEditController } from '@/features/faces/hooks/usePeoplePanelPersonEditController'
import { usePeoplePanelSourceActions } from '@/features/faces/hooks/usePeoplePanelSourceActions'
import { usePeoplePanelViewController } from '@/features/faces/hooks/usePeoplePanelViewController'
import {
  resolvePeoplePanelPanelState,
  resolvePeoplePanelPersonEditDraftCommit,
  resolvePeoplePanelRenderPlan,
  resolvePeoplePanelSelectionModel,
} from '@/features/faces/lib/peoplePanelModel'
import type { FaceRecord } from '@/features/faces/types'
import { PeopleList } from '@/features/faces/components/PeopleList'
import { PeoplePanelFaceSection } from '@/features/faces/components/PeoplePanelFaceSection'
import { PeoplePanelHeader } from '@/features/faces/components/PeoplePanelHeader'
import { PeoplePanelNotice } from '@/features/faces/components/PeoplePanelNotice'
import { PeoplePanelPersonSummaryCard } from '@/features/faces/components/PeoplePanelPersonSummaryCard'
import { PeoplePanelPersonTools } from '@/features/faces/components/PeoplePanelPersonTools'
import { PeoplePanelViewTabs } from '@/features/faces/components/PeoplePanelViewTabs'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'

interface PeoplePanelProps {
  open: boolean
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
  layoutMode?: 'wide' | 'compact'
  readonly?: boolean
  preferredPersonId?: string | null
  onClose: () => void
  onOpenFaceSource?: (face: FaceRecord) => boolean | Promise<boolean>
  onProjectFaceSources?: (faces: FaceRecord[]) => boolean | Promise<boolean>
}

export function PeoplePanel({
  open,
  rootHandle,
  rootId,
  layoutMode = 'wide',
  readonly = false,
  preferredPersonId = null,
  onClose,
  onOpenFaceSource,
  onProjectFaceSources,
}: PeoplePanelProps) {
  const context = useMemo(() => ({
    rootHandle,
    rootId,
  }), [rootHandle, rootId])
  const [peopleQuery, setPeopleQuery] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [mergeTargetQuery, setMergeTargetQuery] = useState('')
  const [mergeTargetPersonId, setMergeTargetPersonId] = useState('')
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null)
  const isCompact = layoutMode === 'compact'
  const {
    scope,
    setScope,
    view,
    selectedPersonId,
    setSelectedPersonId,
    selectedFaceIds,
    compactPeopleStage,
    clearSelection,
    handleFaceSelectionChange,
    handleSelectPerson,
    handleShowPeopleList,
    handleSwitchView,
  } = usePeoplePanelViewController({
    open,
    readonly,
    preferredPersonId,
    isCompact,
  })
  const {
    allPeople,
    people,
    faces,
    isLoadingPeople,
    isLoadingFaces,
    setFaces,
    setIsLoadingFaces,
    loadAllPeople,
    loadPeopleList,
    refreshAll,
  } = usePeoplePanelDataController({
    context,
    open,
    scope,
    view,
    peopleQuery,
    selectedPersonId,
    readonly,
    setSelectedPersonId,
    setNotice,
  })
  const {
    selectedPerson,
    selectedFaces,
    mergeTargetCandidates,
    selectedIds,
    assignmentExcludedPersonIds,
    assignmentInputKey,
  } = useMemo(() => resolvePeoplePanelSelectionModel({
    people,
    allPeople,
    selectedPersonId,
    faces,
    selectedFaceIds,
    mergeTargetQuery,
    scope,
    view,
  }), [
    allPeople,
    faces,
    mergeTargetQuery,
    people,
    scope,
    selectedFaceIds,
    selectedPersonId,
    view,
  ])
  const renderPlan = useMemo(() => resolvePeoplePanelRenderPlan({
    isCompact,
    view,
    compactPeopleStage,
    hasSelectedPerson: Boolean(selectedPerson),
    readonly,
  }), [compactPeopleStage, isCompact, readonly, selectedPerson, view])

  const {
    isProjectingSources,
    openFaceSource,
    projectFaceSources,
  } = usePeoplePanelSourceActions({
    selectedFaces,
    onOpenFaceSource,
    onProjectFaceSources,
    setNotice,
  })

  const {
    isSavingRename,
    isMerging,
    saveRename,
    mergeSelectedPerson,
  } = usePeoplePanelPersonEditController({
    context,
    selectedPerson,
    renameDraft,
    mergeTargetPersonId,
    scope,
    loadAllPeople,
    loadPeopleList,
    setFaces,
    setIsLoadingFaces,
    setMergeTargetPersonId,
    setMergeTargetQuery,
    setPeopleQuery,
    setSelectedPersonId,
    setNotice,
  })

  const {
    isMutatingFaces,
    assignSelectedFaces,
    createPersonForSelectedFaces,
    unassignSelectedFaces,
    ignoreSelectedFaces,
    restoreIgnoredFacesForSelection,
    requeueSelectedFaces,
  } = usePeoplePanelFaceMutationController({
    context,
    selectedFaceIds,
    selectedIds,
    clearSelection,
    refreshAll,
    setNotice,
  })

  useEffect(() => {
    if (!open) return
    setNotice(null)
  }, [open])

  useEffect(() => {
    const commit = resolvePeoplePanelPersonEditDraftCommit({
      selectedPersonName: selectedPerson?.name,
    })
    setRenameDraft(commit.renameDraft)
    setMergeTargetPersonId(commit.mergeTargetPersonId)
    setMergeTargetQuery(commit.mergeTargetQuery)
  }, [selectedPerson?.name, selectedPersonId])

  useEffect(() => {
    if (!open) return undefined
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, open])

  const {
    faceSectionState,
    personToolsState,
  } = resolvePeoplePanelPanelState({
    view,
    readonly,
    context,
    scope,
    faces,
    selectedFaceIds,
    selectedIds,
    selectedFaces,
    assignmentExcludedPersonIds,
    assignmentInputKey,
    isLoadingFaces,
    isMutatingFaces,
    isProjectingSources,
    renameDraft,
    mergeTargetQuery,
    mergeTargetCandidates,
    mergeTargetPersonId,
    isSavingRename,
    isMerging,
  })
  const faceSectionActions = {
    onClearSelection: clearSelection,
    onSelectionChange: handleFaceSelectionChange,
    onOpenFaceSource: openFaceSource,
    onAssign: assignSelectedFaces,
    onCreate: createPersonForSelectedFaces,
    onUnassign: unassignSelectedFaces,
    onIgnore: ignoreSelectedFaces,
    onRestoreIgnored: restoreIgnoredFacesForSelection,
    onRequeue: requeueSelectedFaces,
    onProjectSources: projectFaceSources,
  }
  const personToolsActions = {
    onRenameDraftChange: setRenameDraft,
    onSaveRename: () => {
      void saveRename()
    },
    onMergeTargetQueryChange: setMergeTargetQuery,
    onMergeTargetPersonChange: setMergeTargetPersonId,
    onMerge: () => {
      void mergeSelectedPerson()
    },
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose}>
      <div
        className={cn(
          'absolute bg-background shadow-2xl',
          isCompact
            ? 'inset-0 h-full w-full'
            : 'right-0 top-0 h-full w-[1180px] max-w-[98vw] border-l border-border'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <PeoplePanelHeader
            readonly={readonly}
            isCompact={isCompact}
            scope={scope}
            isLoading={isLoadingPeople || isLoadingFaces}
            onScopeChange={setScope}
            onRefresh={() => {
              void refreshAll()
            }}
            onClose={onClose}
          />

          <PeoplePanelNotice isCompact={isCompact} notice={notice} />

          {renderPlan.panelLayout === 'compact' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <PeoplePanelViewTabs
                readonly={readonly}
                view={view}
                layout={renderPlan.viewTabsLayout}
                onSwitchView={handleSwitchView}
              />

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                {renderPlan.showCompactPeopleList && (
                  <PeopleList
                    people={people}
                    query={peopleQuery}
                    selectedPersonId={selectedPersonId}
                    scope={scope}
                    loading={isLoadingPeople}
                    layout="compact"
                    onQueryChange={setPeopleQuery}
                    onSelectPerson={handleSelectPerson}
                  />
                )}

                {renderPlan.showCompactPeopleDetail && (
                  <div className="space-y-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-fit gap-1 px-2"
                      onClick={handleShowPeopleList}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      返回人物列表
                    </Button>

                    <PeoplePanelPersonSummaryCard
                      person={selectedPerson}
                      scope={scope}
                      layout="compact"
                    />

                    {!readonly && selectedPerson && (
                      <PeoplePanelPersonTools
                        layout="compact"
                        state={personToolsState}
                        actions={personToolsActions}
                      />
                    )}

                    <PeoplePanelFaceSection
                      layout="compact-detail"
                      state={faceSectionState}
                      actions={faceSectionActions}
                    />
                  </div>
                )}

                {renderPlan.showCompactReviewFaces && (
                  <PeoplePanelFaceSection
                    layout="compact-review"
                    state={faceSectionState}
                    actions={faceSectionActions}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="w-[300px] shrink-0 border-r border-border">
                <PeoplePanelViewTabs
                  readonly={readonly}
                  view={view}
                  layout={renderPlan.viewTabsLayout}
                  onSwitchView={handleSwitchView}
                />

                {renderPlan.showWidePeopleList && (
                  <PeopleList
                    people={people}
                    query={peopleQuery}
                    selectedPersonId={selectedPersonId}
                    scope={scope}
                    loading={isLoadingPeople}
                    layout="wide"
                    onQueryChange={setPeopleQuery}
                    onSelectPerson={handleSelectPerson}
                  />
                )}
              </div>

              <div className="min-w-0 flex-1 overflow-auto p-4">
                {renderPlan.showWidePersonTools && selectedPerson && (
                  <div className="mb-4 space-y-4 rounded-md border border-border p-4">
                    <PeoplePanelPersonSummaryCard
                      person={selectedPerson}
                      scope={scope}
                      layout="wide"
                    />

                    <PeoplePanelPersonTools
                      layout="wide"
                      state={personToolsState}
                      actions={personToolsActions}
                    />
                  </div>
                )}

                <PeoplePanelFaceSection
                  layout="wide"
                  state={faceSectionState}
                  actions={faceSectionActions}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
