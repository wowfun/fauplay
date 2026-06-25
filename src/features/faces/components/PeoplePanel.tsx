import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import {
  listPeople,
  listPersonFaces,
  listReviewFaces,
  mergePeople,
  renamePerson,
} from '@/features/faces/api'
import {
  faceCountText,
  type NoticeTone,
  type PanelView,
} from '@/features/faces/lib/peoplePanelText'
import { usePeoplePanelFaceMutationController } from '@/features/faces/hooks/usePeoplePanelFaceMutationController'
import { usePeoplePanelSourceActions } from '@/features/faces/hooks/usePeoplePanelSourceActions'
import {
  type CompactPeopleStage,
  resolvePeoplePanelCompactEmptySelectionStage,
  resolvePeoplePanelFacesLoadPlan,
  resolvePeoplePanelListStage,
  resolvePeoplePanelPersonSelection,
  resolvePeoplePanelPreferredPersonFocus,
  resolvePeoplePanelRefreshedPeopleSelection,
  resolvePeoplePanelReadonlyMode,
  resolvePeoplePanelSelectionModel,
  resolvePeoplePanelViewSwitch,
} from '@/features/faces/lib/peoplePanelModel'
import type { FaceRecord, PersonScope, PersonSummary } from '@/features/faces/types'
import { FaceCropImage } from '@/features/faces/components/FaceCropImage'
import { PeopleList } from '@/features/faces/components/PeopleList'
import { PeoplePanelFaceSection } from '@/features/faces/components/PeoplePanelFaceSection'
import { PeoplePanelHeader } from '@/features/faces/components/PeoplePanelHeader'
import { PeoplePanelNotice } from '@/features/faces/components/PeoplePanelNotice'
import { PeoplePanelPersonTools } from '@/features/faces/components/PeoplePanelPersonTools'
import { PeoplePanelViewTabs } from '@/features/faces/components/PeoplePanelViewTabs'
import { getPersonDisplayName } from '@/features/faces/utils/personDisplayName'
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
  const [isSavingRename, setIsSavingRename] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
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
    showCompactPeopleList,
    showCompactPeopleDetail,
  } = useMemo(() => resolvePeoplePanelSelectionModel({
    people,
    allPeople,
    selectedPersonId,
    faces,
    selectedFaceIds,
    mergeTargetQuery,
    scope,
    view,
    isCompact,
    compactPeopleStage,
  }), [
    allPeople,
    compactPeopleStage,
    faces,
    isCompact,
    mergeTargetQuery,
    people,
    scope,
    selectedFaceIds,
    selectedPersonId,
    view,
  ])

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
    const items = await listPeople(context, {
      scope,
      size: 400,
    })
    setAllPeople(items)
  }, [context, scope])

  const loadPeopleList = useCallback(async (query = '') => {
    const requestId = ++peopleListRequestIdRef.current
    const trimmedQuery = query.trim()
    setIsLoadingPeople(true)
    try {
      const items = await listPeople(context, {
        scope,
        query: trimmedQuery || undefined,
        size: 300,
      })
      if (requestId !== peopleListRequestIdRef.current) return
      setPeople(items)
      setSelectedPersonId((previous) => resolvePeoplePanelRefreshedPeopleSelection({
        previousSelectedPersonId: previous,
        people: items,
      }))
    } catch (error) {
      if (requestId !== peopleListRequestIdRef.current) return
      setPeople([])
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '人物列表读取失败',
      })
    } finally {
      if (requestId === peopleListRequestIdRef.current) {
        setIsLoadingPeople(false)
      }
    }
  }, [context, scope])

  const loadCurrentFaces = useCallback(async () => {
    setIsLoadingFaces(true)
    try {
      const plan = resolvePeoplePanelFacesLoadPlan({
        view,
        selectedPersonId,
        readonly,
        scope,
      })
      if (plan.kind === 'empty') {
        setFaces([])
        return
      }
      if (plan.kind === 'person') {
        setFaces(await listPersonFaces(context, {
          personId: plan.personId,
          scope: plan.scope,
        }))
        return
      }

      setFaces(await listReviewFaces(context, {
        scope: plan.scope,
        bucket: plan.bucket,
        size: plan.size,
      }))
    } catch (error) {
      setFaces([])
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '人脸列表读取失败',
      })
    } finally {
      setIsLoadingFaces(false)
    }
  }, [context, readonly, scope, selectedPersonId, view])

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      loadAllPeople(),
      loadPeopleList(peopleQuery),
      loadCurrentFaces(),
    ])
  }, [loadAllPeople, loadCurrentFaces, loadPeopleList, peopleQuery])

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
    if (!open || view !== 'people') return
    const timeoutId = window.setTimeout(() => {
      void loadPeopleList(peopleQuery)
    }, peopleQuery.trim() ? 180 : 0)

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
    if (!open) return
    if (previousFaceSelectionScopeKeyRef.current === faceSelectionScopeKey) return
    previousFaceSelectionScopeKeyRef.current = faceSelectionScopeKey
    clearSelection()
  }, [clearSelection, faceSelectionScopeKey, open])

  useEffect(() => {
    setRenameDraft(selectedPerson?.name || '')
    setMergeTargetPersonId('')
    setMergeTargetQuery('')
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

  const handleSaveRename = useCallback(async () => {
    if (!selectedPerson) return
    const nextName = renameDraft.trim()
    if (nextName === selectedPerson.name) return

    setIsSavingRename(true)
    setNotice(null)
    try {
      await renamePerson(context, {
        personId: selectedPerson.personId,
        name: nextName,
      })
      setNotice({
        tone: 'info',
        message: '人物名称已更新',
      })
      await Promise.allSettled([loadAllPeople(), loadPeopleList()])
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '人物重命名失败',
      })
    } finally {
      setIsSavingRename(false)
    }
  }, [context, loadAllPeople, loadPeopleList, renameDraft, selectedPerson])

  const handleMerge = useCallback(async () => {
    if (!selectedPerson || !mergeTargetPersonId || selectedPerson.personId === mergeTargetPersonId) return

    const sourcePersonId = selectedPerson.personId
    const targetPersonId = mergeTargetPersonId

    setIsMerging(true)
    setNotice(null)
    try {
      await mergePeople(context, {
        targetPersonId,
        sourcePersonIds: [sourcePersonId],
      })
      setNotice({
        tone: 'info',
        message: '人物已合并',
      })
      setMergeTargetPersonId('')
      setMergeTargetQuery('')
      setPeopleQuery('')
      setSelectedPersonId(targetPersonId)
      setIsLoadingFaces(true)
      const loadTargetFaces = listPersonFaces(context, {
        personId: targetPersonId,
        scope,
      })
        .then((items) => {
          setFaces(items)
        })
        .catch((error) => {
          setFaces([])
          setNotice({
            tone: 'error',
            message: error instanceof Error ? error.message : '人脸列表读取失败',
          })
        })
        .finally(() => {
          setIsLoadingFaces(false)
        })
      await Promise.allSettled([
        loadAllPeople(),
        loadPeopleList(''),
        loadTargetFaces,
      ])
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '人物合并失败',
      })
    } finally {
      setIsMerging(false)
    }
  }, [context, loadAllPeople, loadPeopleList, mergeTargetPersonId, scope, selectedPerson])

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

          {isCompact ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <PeoplePanelViewTabs
                readonly={readonly}
                view={view}
                layout="compact"
                onSwitchView={handleSwitchView}
              />

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                {showCompactPeopleList && (
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

                {showCompactPeopleDetail && (
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

                    {selectedPerson ? (
                      <div className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-start gap-3">
                          {selectedPerson.featureFaceId ? (
                            <FaceCropImage
                              faceId={selectedPerson.featureFaceId}
                              size={88}
                              padding={0.35}
                              alt={getPersonDisplayName(selectedPerson)}
                              className="h-[88px] w-[88px] shrink-0 rounded-lg border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
                              无代表脸
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-semibold">{getPersonDisplayName(selectedPerson)}</div>
                            <div className="mt-1 text-sm text-muted-foreground">{faceCountText(selectedPerson, scope)}</div>
                            {selectedPerson.featureAssetPath && (
                              <div className="mt-2 truncate text-xs text-muted-foreground" title={selectedPerson.featureAssetPath}>
                                {selectedPerson.featureAssetPath}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
                        尚未选择人物
                      </div>
                    )}

                    {!readonly && selectedPerson && (
                      <PeoplePanelPersonTools
                        layout="compact"
                        scope={scope}
                        renameDraft={renameDraft}
                        mergeTargetQuery={mergeTargetQuery}
                        mergeTargetCandidates={mergeTargetCandidates}
                        mergeTargetPersonId={mergeTargetPersonId}
                        isSavingRename={isSavingRename}
                        isMerging={isMerging}
                        onRenameDraftChange={setRenameDraft}
                        onSaveRename={() => {
                          void handleSaveRename()
                        }}
                        onMergeTargetQueryChange={setMergeTargetQuery}
                        onMergeTargetPersonChange={setMergeTargetPersonId}
                        onMerge={() => {
                          void handleMerge()
                        }}
                      />
                    )}

                    <PeoplePanelFaceSection
                      layout="compact-detail"
                      view={view}
                      readonly={readonly}
                      context={context}
                      scope={scope}
                      faces={faces}
                      selectedFaceIds={selectedFaceIds}
                      selectedIds={selectedIds}
                      selectedFaces={selectedFaces}
                      excludedPersonIds={assignmentExcludedPersonIds}
                      assignmentInputKey={assignmentInputKey}
                      isLoadingFaces={isLoadingFaces}
                      isMutatingFaces={isMutatingFaces}
                      isProjectingSources={isProjectingSources}
                      onClearSelection={clearSelection}
                      onSelectionChange={handleFaceSelectionChange}
                      onOpenFaceSource={openFaceSource}
                      onAssign={assignSelectedFaces}
                      onCreate={createPersonForSelectedFaces}
                      onUnassign={unassignSelectedFaces}
                      onIgnore={ignoreSelectedFaces}
                      onRestoreIgnored={restoreIgnoredFacesForSelection}
                      onRequeue={requeueSelectedFaces}
                      onProjectSources={projectFaceSources}
                    />
                  </div>
                )}

                {isCompact && view !== 'people' && (
                  <PeoplePanelFaceSection
                    layout="compact-review"
                    view={view}
                    readonly={readonly}
                    context={context}
                    scope={scope}
                    faces={faces}
                    selectedFaceIds={selectedFaceIds}
                    selectedIds={selectedIds}
                    selectedFaces={selectedFaces}
                    excludedPersonIds={assignmentExcludedPersonIds}
                    assignmentInputKey={assignmentInputKey}
                    isLoadingFaces={isLoadingFaces}
                    isMutatingFaces={isMutatingFaces}
                    isProjectingSources={isProjectingSources}
                    onClearSelection={clearSelection}
                    onSelectionChange={handleFaceSelectionChange}
                    onOpenFaceSource={openFaceSource}
                    onAssign={assignSelectedFaces}
                    onCreate={createPersonForSelectedFaces}
                    onUnassign={unassignSelectedFaces}
                    onIgnore={ignoreSelectedFaces}
                    onRestoreIgnored={restoreIgnoredFacesForSelection}
                    onRequeue={requeueSelectedFaces}
                    onProjectSources={projectFaceSources}
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
                  layout="wide"
                  onSwitchView={handleSwitchView}
                />

                {view === 'people' && (
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
                {view === 'people' && selectedPerson && !readonly && (
                  <div className="mb-4 space-y-4 rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-semibold">{getPersonDisplayName(selectedPerson)}</div>
                        <div className="text-sm text-muted-foreground">{faceCountText(selectedPerson, scope)}</div>
                      </div>
                      {selectedPerson.featureFaceId && (
                        <FaceCropImage
                          faceId={selectedPerson.featureFaceId}
                          size={112}
                          padding={0.35}
                          alt={getPersonDisplayName(selectedPerson)}
                          className="h-20 w-20 rounded-md border border-border object-cover"
                        />
                      )}
                    </div>

                    <PeoplePanelPersonTools
                      layout="wide"
                      scope={scope}
                      renameDraft={renameDraft}
                      mergeTargetQuery={mergeTargetQuery}
                      mergeTargetCandidates={mergeTargetCandidates}
                      mergeTargetPersonId={mergeTargetPersonId}
                      isSavingRename={isSavingRename}
                      isMerging={isMerging}
                      onRenameDraftChange={setRenameDraft}
                      onSaveRename={() => {
                        void handleSaveRename()
                      }}
                      onMergeTargetQueryChange={setMergeTargetQuery}
                      onMergeTargetPersonChange={setMergeTargetPersonId}
                      onMerge={() => {
                        void handleMerge()
                      }}
                    />
                  </div>
                )}

                <PeoplePanelFaceSection
                  layout="wide"
                  view={view}
                  readonly={readonly}
                  context={context}
                  scope={scope}
                  faces={faces}
                  selectedFaceIds={selectedFaceIds}
                  selectedIds={selectedIds}
                  selectedFaces={selectedFaces}
                  excludedPersonIds={assignmentExcludedPersonIds}
                  assignmentInputKey={assignmentInputKey}
                  isLoadingFaces={isLoadingFaces}
                  isMutatingFaces={isMutatingFaces}
                  isProjectingSources={isProjectingSources}
                  onClearSelection={clearSelection}
                  onSelectionChange={handleFaceSelectionChange}
                  onOpenFaceSource={openFaceSource}
                  onAssign={assignSelectedFaces}
                  onCreate={createPersonForSelectedFaces}
                  onUnassign={unassignSelectedFaces}
                  onIgnore={ignoreSelectedFaces}
                  onRestoreIgnored={restoreIgnoredFacesForSelection}
                  onRequeue={requeueSelectedFaces}
                  onProjectSources={projectFaceSources}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
