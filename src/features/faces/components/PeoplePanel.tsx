import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import {
  assignFaces,
  createPersonFromFaces,
  ignoreFaces,
  listPeople,
  listPersonFaces,
  listReviewFaces,
  mergePeople,
  renamePerson,
  requeueFaces,
  restoreIgnoredFaces,
  unassignFaces,
} from '@/features/faces/api'
import {
  faceCountText,
  readFaceMutationResultMessage,
  type NoticeTone,
  type PanelView,
} from '@/features/faces/lib/peoplePanelText'
import {
  type CompactPeopleStage,
  resolvePeoplePanelCompactEmptySelectionStage,
  resolvePeoplePanelListStage,
  resolvePeoplePanelPersonSelection,
  resolvePeoplePanelPreferredPersonFocus,
  resolvePeoplePanelReadonlyMode,
  resolvePeoplePanelSelectionModel,
  resolvePeoplePanelViewSwitch,
} from '@/features/faces/lib/peoplePanelModel'
import type { FaceMutationResult, FaceRecord, PersonScope, PersonSummary } from '@/features/faces/types'
import { FaceGrid } from '@/features/faces/components/FaceGrid'
import { FaceSelectionActions } from '@/features/faces/components/FaceSelectionActions'
import { FaceCropImage } from '@/features/faces/components/FaceCropImage'
import { PeopleList } from '@/features/faces/components/PeopleList'
import { PeoplePanelHeader } from '@/features/faces/components/PeoplePanelHeader'
import { PeoplePanelNotice } from '@/features/faces/components/PeoplePanelNotice'
import { PeoplePanelViewTabs } from '@/features/faces/components/PeoplePanelViewTabs'
import { PersonMergeTargetList } from '@/features/faces/components/PersonMergeTargetList'
import { getPersonDisplayName } from '@/features/faces/utils/personDisplayName'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'

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
  const [isMutatingFaces, setIsMutatingFaces] = useState(false)
  const [isProjectingSources, setIsProjectingSources] = useState(false)
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
      setSelectedPersonId((previous) => {
        if (previous && items.some((item) => item.personId === previous)) {
          return previous
        }
        return items[0]?.personId ?? null
      })
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
      if (view === 'people') {
        if (!selectedPersonId) {
          setFaces([])
          return
        }
        setFaces(await listPersonFaces(context, {
          personId: selectedPersonId,
          scope,
        }))
        return
      }

      if (readonly) {
        setFaces([])
        return
      }

      setFaces(await listReviewFaces(context, {
        scope,
        bucket: view === 'ignored' ? 'ignored' : 'unassigned',
        size: 500,
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

  const handleOpenFaceSource = useCallback(async (face: FaceRecord) => {
    if (!onOpenFaceSource) {
      setNotice({
        tone: 'error',
        message: '当前上下文不支持打开来源文件',
      })
      return false
    }

    try {
      const opened = await onOpenFaceSource(face)
      if (!opened) {
        setNotice({
          tone: 'error',
          message: '该人脸来源不在当前 Root 内，暂不支持跳转',
        })
      }
      return opened
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '来源文件打开失败',
      })
      return false
    }
  }, [onOpenFaceSource])

  const handleProjectFaceSources = useCallback(async () => {
    if (selectedFaces.length === 0) return
    if (!onProjectFaceSources) {
      setNotice({
        tone: 'error',
        message: '当前上下文不支持投射源文件',
      })
      return
    }

    setIsProjectingSources(true)
    setNotice(null)
    try {
      const projected = await onProjectFaceSources(selectedFaces)
      if (!projected) {
        setNotice({
          tone: 'error',
          message: '没有可投射的源文件',
        })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '源文件投射失败',
      })
    } finally {
      setIsProjectingSources(false)
    }
  }, [onProjectFaceSources, selectedFaces])

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

  const runFaceMutation = useCallback(async (task: () => Promise<FaceMutationResult>) => {
    if (selectedFaceIds.size === 0) return false
    setIsMutatingFaces(true)
    setNotice(null)
    try {
      const result = await task()
      setNotice(readFaceMutationResultMessage(result))
      clearSelection()
      await refreshAll()
      return true
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '人脸纠错失败',
      })
      return false
    } finally {
      setIsMutatingFaces(false)
    }
  }, [clearSelection, refreshAll, selectedFaceIds.size])

  const handleAssignSelectedFaces = useCallback(async (personId: string) => {
    if (selectedIds.length === 0) return false
    return runFaceMutation(() => assignFaces(context, {
      faceIds: selectedIds,
      targetPersonId: personId,
    }))
  }, [context, runFaceMutation, selectedIds])
  const handleCreatePersonForSelectedFaces = useCallback(async (name: string) => {
    if (selectedIds.length === 0) return false
    return runFaceMutation(() => createPersonFromFaces(context, {
      faceIds: selectedIds,
      name,
    }))
  }, [context, runFaceMutation, selectedIds])
  const handleUnassignSelectedFaces = useCallback(async () => {
    return runFaceMutation(() => unassignFaces(context, {
      faceIds: selectedIds,
    }))
  }, [context, runFaceMutation, selectedIds])
  const handleIgnoreSelectedFaces = useCallback(async () => {
    return runFaceMutation(() => ignoreFaces(context, {
      faceIds: selectedIds,
    }))
  }, [context, runFaceMutation, selectedIds])
  const handleRestoreIgnoredFaces = useCallback(async () => {
    return runFaceMutation(() => restoreIgnoredFaces(context, {
      faceIds: selectedIds,
    }))
  }, [context, runFaceMutation, selectedIds])
  const handleRequeueSelectedFaces = useCallback(async () => {
    return runFaceMutation(() => requeueFaces(context, {
      faceIds: selectedIds,
    }))
  }, [context, runFaceMutation, selectedIds])
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
                      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">重命名</div>
                          <div className="flex flex-col gap-2">
                            <Input
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              placeholder="人物名称，可留空"
                              disabled={isSavingRename}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              disabled={isSavingRename}
                              onClick={() => {
                                void handleSaveRename()
                              }}
                            >
                              保存
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">将当前人物并入</div>
                          <div className="text-xs text-muted-foreground">
                            当前人物会被合并到目标人物，当前人物将消失。
                          </div>
                          <Input
                            value={mergeTargetQuery}
                            onChange={(event) => setMergeTargetQuery(event.target.value)}
                            placeholder="搜索目标人物"
                            disabled={isMerging}
                          />
                          <PersonMergeTargetList
                            people={mergeTargetCandidates}
                            selectedPersonId={mergeTargetPersonId}
                            scope={scope}
                            disabled={isMerging}
                            layout="compact"
                            onSelectPerson={setMergeTargetPersonId}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            disabled={isMerging || !mergeTargetPersonId}
                            onClick={() => {
                              void handleMerge()
                            }}
                          >
                            并入该人物
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">人物详情</div>
                          <div className="text-xs text-muted-foreground">
                            {readonly ? '双击人脸可打开来源文件' : `已选 ${selectedFaceIds.size} / 当前 ${faces.length}`}
                          </div>
                        </div>
                        {selectedFaceIds.size > 0 && (
                          <Button variant="ghost" size="sm" onClick={clearSelection}>
                            清空选择
                          </Button>
                        )}
                      </div>

                      {!readonly && (
                        <FaceSelectionActions
                          className="mb-4"
                          layout="stacked"
                          assignmentInputKey={`compact-detail:${assignmentInputKey}`}
                          context={context}
                          scope={scope}
                          selectedFaceIds={selectedIds}
                          selectedFaces={selectedFaces}
                          excludedPersonIds={assignmentExcludedPersonIds}
                          isMutatingFaces={isMutatingFaces}
                          isProjectingSources={isProjectingSources}
                          onAssign={handleAssignSelectedFaces}
                          onCreate={handleCreatePersonForSelectedFaces}
                          onUnassign={handleUnassignSelectedFaces}
                          onIgnore={handleIgnoreSelectedFaces}
                          onRestoreIgnored={handleRestoreIgnoredFaces}
                          onRequeue={handleRequeueSelectedFaces}
                          onProjectSources={handleProjectFaceSources}
                        />
                      )}

                      {isLoadingFaces ? (
                        <div className="py-8 text-sm text-muted-foreground">人脸数据加载中...</div>
                      ) : (
                        <FaceGrid
                          compact
                          faces={faces}
                          selectedFaceIds={selectedFaceIds}
                          onSelectionChange={handleFaceSelectionChange}
                          onOpenFaceSource={handleOpenFaceSource}
                        />
                      )}
                    </div>
                  </div>
                )}

                {isCompact && view !== 'people' && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          {view === 'ignored' ? '误检 / 忽略池' : '未归属池'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          已选 {selectedFaceIds.size} / 当前 {faces.length}
                        </div>
                      </div>
                      {selectedFaceIds.size > 0 && (
                        <Button variant="ghost" size="sm" onClick={clearSelection}>
                          清空选择
                        </Button>
                      )}
                    </div>

                    <FaceSelectionActions
                      className="mb-4"
                      layout="stacked"
                      assignmentInputKey={`compact-review:${assignmentInputKey}`}
                      context={context}
                      scope={scope}
                      selectedFaceIds={selectedIds}
                      selectedFaces={selectedFaces}
                      excludedPersonIds={assignmentExcludedPersonIds}
                      isMutatingFaces={isMutatingFaces}
                      isProjectingSources={isProjectingSources}
                      onAssign={handleAssignSelectedFaces}
                      onCreate={handleCreatePersonForSelectedFaces}
                      onUnassign={handleUnassignSelectedFaces}
                      onIgnore={handleIgnoreSelectedFaces}
                      onRestoreIgnored={handleRestoreIgnoredFaces}
                      onRequeue={handleRequeueSelectedFaces}
                      onProjectSources={handleProjectFaceSources}
                    />

                    {isLoadingFaces ? (
                      <div className="py-8 text-sm text-muted-foreground">人脸数据加载中...</div>
                    ) : (
                      <FaceGrid
                        compact
                        faces={faces}
                        selectedFaceIds={selectedFaceIds}
                        onSelectionChange={handleFaceSelectionChange}
                        onOpenFaceSource={handleOpenFaceSource}
                      />
                    )}
                  </div>
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

                    <div className="flex flex-wrap gap-3">
                      <div className="min-w-[280px] flex-1">
                        <div className="mb-2 text-xs font-medium text-muted-foreground">重命名</div>
                        <div className="flex gap-2">
                          <Input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            placeholder="人物名称，可留空"
                            disabled={isSavingRename}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isSavingRename}
                            onClick={() => {
                              void handleSaveRename()
                            }}
                          >
                            保存
                          </Button>
                        </div>
                      </div>

                      <div className="min-w-[360px] flex-[1.4] space-y-2">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">将当前人物并入</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            当前人物会被合并到目标人物，当前人物将消失。
                          </div>
                        </div>
                        <Input
                          value={mergeTargetQuery}
                          onChange={(event) => setMergeTargetQuery(event.target.value)}
                          placeholder="搜索目标人物"
                          disabled={isMerging}
                        />
                        <PersonMergeTargetList
                          people={mergeTargetCandidates}
                          selectedPersonId={mergeTargetPersonId}
                          scope={scope}
                          disabled={isMerging}
                          layout="wide"
                          onSelectPerson={setMergeTargetPersonId}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isMerging || !mergeTargetPersonId}
                          onClick={() => {
                            void handleMerge()
                          }}
                        >
                          并入该人物
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mb-4 rounded-md border border-border p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {view === 'people'
                          ? '人物详情'
                          : view === 'ignored'
                            ? '误检 / 忽略池'
                            : '未归属池'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {readonly ? '双击人脸可打开来源文件' : `已选 ${selectedFaceIds.size} / 当前 ${faces.length}`}
                      </div>
                    </div>
                    {selectedFaceIds.size > 0 && (
                      <Button variant="ghost" size="sm" onClick={clearSelection}>
                        清空选择
                      </Button>
                    )}
                  </div>

                  {!readonly && (
                    <FaceSelectionActions
                      className="mb-4"
                      assignmentClassName="max-w-[560px]"
                      assignmentInputKey={`wide:${assignmentInputKey}`}
                      context={context}
                      scope={scope}
                      selectedFaceIds={selectedIds}
                      selectedFaces={selectedFaces}
                      excludedPersonIds={assignmentExcludedPersonIds}
                      isMutatingFaces={isMutatingFaces}
                      isProjectingSources={isProjectingSources}
                      onAssign={handleAssignSelectedFaces}
                      onCreate={handleCreatePersonForSelectedFaces}
                      onUnassign={handleUnassignSelectedFaces}
                      onIgnore={handleIgnoreSelectedFaces}
                      onRestoreIgnored={handleRestoreIgnoredFaces}
                      onRequeue={handleRequeueSelectedFaces}
                      onProjectSources={handleProjectFaceSources}
                    />
                  )}

                  {isLoadingFaces ? (
                    <div className="py-8 text-sm text-muted-foreground">人脸数据加载中...</div>
                  ) : (
                    <FaceGrid
                      faces={faces}
                      selectedFaceIds={selectedFaceIds}
                      onSelectionChange={handleFaceSelectionChange}
                      onOpenFaceSource={handleOpenFaceSource}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
