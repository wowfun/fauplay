import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import {
  listPeople,
  listPersonFaces,
  listReviewFaces,
} from '@/features/faces/api'
import {
  type NoticeTone,
  type PanelView,
} from '@/features/faces/lib/peoplePanelText'
import { usePeoplePanelFaceMutationController } from '@/features/faces/hooks/usePeoplePanelFaceMutationController'
import { usePeoplePanelPersonEditController } from '@/features/faces/hooks/usePeoplePanelPersonEditController'
import { usePeoplePanelSourceActions } from '@/features/faces/hooks/usePeoplePanelSourceActions'
import {
  type CompactPeopleStage,
  resolvePeoplePanelCompactEmptySelectionStage,
  resolvePeoplePanelFaceSelectionScopeCommit,
  resolvePeoplePanelListStage,
  resolvePeoplePanelPersonEditDraftCommit,
  resolvePeoplePanelPersonSelection,
  resolvePeoplePanelPreferredPersonFocus,
  resolvePeoplePanelPeopleListRefreshPlan,
  resolvePeoplePanelRenderPlan,
  resolvePeoplePanelReadonlyMode,
  resolvePeoplePanelSelectionModel,
  resolvePeoplePanelViewSwitch,
} from '@/features/faces/lib/peoplePanelModel'
import {
  loadPeoplePanelFaces,
  resolvePeoplePanelFacesLoadCommit,
  type PeoplePanelFacesLoaders,
} from '@/features/faces/lib/peoplePanelFacesLoad'
import {
  loadPeoplePanelAllPeople,
  loadPeoplePanelPeopleList,
  resolvePeoplePanelAllPeopleLoadCommit,
  resolvePeoplePanelPeopleListLoadCommit,
} from '@/features/faces/lib/peoplePanelPeopleLoad'
import type { FaceRecord, PersonScope, PersonSummary } from '@/features/faces/types'
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

const peoplePanelFacesLoaders = {
  listPersonFaces,
  listReviewFaces,
} satisfies PeoplePanelFacesLoaders

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
  const peopleListRequestIdRef = useRef(0)
  const context = useMemo(() => ({
    rootHandle,
    rootId,
  }), [rootHandle, rootId])
  const [scope, setScope] = useState<PersonScope>(readonly ? 'root' : 'global')
  const [view, setView] = useState<PanelView>('people')
  const [allPeople, setAllPeople] = useState<PersonSummary[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [faces, setFaces] = useState<FaceRecord[]>([])
  const [selectedFaceIds, setSelectedFaceIds] = useState<Set<string>>(new Set())
  const [peopleQuery, setPeopleQuery] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [mergeTargetQuery, setMergeTargetQuery] = useState('')
  const [mergeTargetPersonId, setMergeTargetPersonId] = useState('')
  const [isLoadingPeople, setIsLoadingPeople] = useState(false)
  const [isLoadingFaces, setIsLoadingFaces] = useState(false)
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null)
  const [compactPeopleStage, setCompactPeopleStage] = useState<CompactPeopleStage>('list')
  const previousFaceSelectionScopeKeyRef = useRef<string | null>(null)
  const isCompact = layoutMode === 'compact'
  const {
    selectedPerson,
    selectedFaces,
    mergeTargetCandidates,
    selectedIds,
    assignmentExcludedPersonIds,
    assignmentInputKey,
    faceSelectionScopeKey,
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

  const clearSelection = useCallback(() => {
    setSelectedFaceIds(new Set())
  }, [])

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

  const loadAllPeople = useCallback(async () => {
    const result = await loadPeoplePanelAllPeople({
      context,
      scope,
      listPeople,
    })
    const commit = resolvePeoplePanelAllPeopleLoadCommit(result)
    if (commit.allPeople) {
      setAllPeople(commit.allPeople)
    }
    if (commit.notice) {
      setNotice(commit.notice)
    }
  }, [context, scope])

  const loadPeopleList = useCallback(async (query = '') => {
    const requestId = ++peopleListRequestIdRef.current
    setIsLoadingPeople(true)
    const result = await loadPeoplePanelPeopleList({
      context,
      scope,
      query,
      listPeople,
    })
    if (requestId !== peopleListRequestIdRef.current) return

    const commit = resolvePeoplePanelPeopleListLoadCommit(result, {
      previousSelectedPersonId: null,
    })
    setPeople(commit.people)
    if (commit.notice) {
      setNotice(commit.notice)
    }
    setSelectedPersonId((previous) => {
      const selectionCommit = resolvePeoplePanelPeopleListLoadCommit(result, {
        previousSelectedPersonId: previous,
      })
      return selectionCommit.nextSelectedPersonId === undefined
        ? previous
        : selectionCommit.nextSelectedPersonId
    })
    setIsLoadingPeople(false)
  }, [context, scope])

  const loadCurrentFaces = useCallback(async () => {
    setIsLoadingFaces(true)
    const result = await loadPeoplePanelFaces({
      context,
      view,
      selectedPersonId,
      readonly,
      scope,
      loaders: peoplePanelFacesLoaders,
    })
    const commit = resolvePeoplePanelFacesLoadCommit(result)
    setFaces(commit.faces)
    if (commit.notice) {
      setNotice(commit.notice)
    }
    setIsLoadingFaces(false)
  }, [context, readonly, scope, selectedPersonId, view])

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      loadAllPeople(),
      loadPeopleList(peopleQuery),
      loadCurrentFaces(),
    ])
  }, [loadAllPeople, loadCurrentFaces, loadPeopleList, peopleQuery])

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
    const readonlyMode = resolvePeoplePanelReadonlyMode(readonly)
    if (!readonlyMode) return
    setScope(readonlyMode.scope)
    setView(readonlyMode.view)
  }, [readonly])

  useEffect(() => {
    const plan = resolvePeoplePanelPeopleListRefreshPlan({
      open,
      view,
      query: peopleQuery,
    })
    if (!plan) return
    const timeoutId = window.setTimeout(() => {
      void loadPeopleList(peopleQuery)
    }, plan.delayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadPeopleList, open, peopleQuery, view])

  useEffect(() => {
    if (!open) return
    void loadAllPeople()
  }, [loadAllPeople, open])

  useEffect(() => {
    if (!open) return
    void loadCurrentFaces()
  }, [loadCurrentFaces, open])

  useEffect(() => {
    const commit = resolvePeoplePanelFaceSelectionScopeCommit({
      open,
      previousScopeKey: previousFaceSelectionScopeKeyRef.current,
      nextScopeKey: faceSelectionScopeKey,
    })
    previousFaceSelectionScopeKeyRef.current = commit.nextPreviousScopeKey
    if (commit.shouldClearSelection) {
      clearSelection()
    }
  }, [clearSelection, faceSelectionScopeKey, open])

  useEffect(() => {
    const commit = resolvePeoplePanelPersonEditDraftCommit({
      selectedPersonName: selectedPerson?.name,
    })
    setRenameDraft(commit.renameDraft)
    setMergeTargetPersonId(commit.mergeTargetPersonId)
    setMergeTargetQuery(commit.mergeTargetQuery)
  }, [selectedPerson?.name, selectedPersonId])

  useEffect(() => {
    const focus = resolvePeoplePanelPreferredPersonFocus({
      open,
      preferredPersonId,
      isCompact,
    })
    if (!focus) return
    setView(focus.view)
    if (focus.shouldClearSelection) clearSelection()
    setSelectedPersonId(focus.selectedPersonId)
    if (focus.compactPeopleStage) setCompactPeopleStage(focus.compactPeopleStage)
  }, [clearSelection, isCompact, open, preferredPersonId])

  useEffect(() => {
    const nextStage = resolvePeoplePanelCompactEmptySelectionStage({
      isCompact,
      open,
      view,
      selectedPersonId,
    })
    if (!nextStage) return
    setCompactPeopleStage(nextStage)
  }, [isCompact, open, selectedPersonId, view])

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

  const handleFaceSelectionChange = useCallback((faceIds: string[]) => {
    setSelectedFaceIds(new Set(faceIds))
  }, [])

  const handleSelectPerson = useCallback((personId: string) => {
    const selection = resolvePeoplePanelPersonSelection(personId, isCompact)
    setSelectedPersonId(selection.selectedPersonId)
    if (selection.compactPeopleStage) setCompactPeopleStage(selection.compactPeopleStage)
  }, [isCompact])

  const handleShowPeopleList = useCallback(() => {
    const nextStage = resolvePeoplePanelListStage(isCompact)
    if (!nextStage) return
    setCompactPeopleStage(nextStage)
  }, [isCompact])

  const handleSwitchView = useCallback((nextView: PanelView) => {
    const transition = resolvePeoplePanelViewSwitch(nextView, isCompact)
    setView(transition.view)
    if (transition.shouldClearSelection) clearSelection()
    if (transition.compactPeopleStage) setCompactPeopleStage(transition.compactPeopleStage)
  }, [clearSelection, isCompact])

  const faceSectionState = {
    view,
    readonly,
    context,
    scope,
    faces,
    selectedFaceIds,
    selectedIds,
    selectedFaces,
    excludedPersonIds: assignmentExcludedPersonIds,
    assignmentInputKey,
    isLoadingFaces,
    isMutatingFaces,
    isProjectingSources,
  }
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
  const personToolsState = {
    scope,
    renameDraft,
    mergeTargetQuery,
    mergeTargetCandidates,
    mergeTargetPersonId,
    isSavingRename,
    isMerging,
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
