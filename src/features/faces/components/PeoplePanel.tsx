import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, RefreshCw, Users, X } from 'lucide-react'
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
import type { FaceMutationResult, FaceRecord, PersonScope, PersonSummary } from '@/features/faces/types'
import { FaceGrid } from '@/features/faces/components/FaceGrid'
import { FaceSelectionActions } from '@/features/faces/components/FaceSelectionActions'
import { FaceCropImage } from '@/features/faces/components/FaceCropImage'
import { PeopleList } from '@/features/faces/components/PeopleList'
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
  const [compactPeopleStage, setCompactPeopleStage] = useState<'list' | 'detail'>('list')
  const previousFaceSelectionScopeKeyRef = useRef<string | null>(null)
  const isCompact = layoutMode === 'compact'
  const faceSelectionScopeKey = useMemo(
    () => `${scope}:${view}:${selectedPersonId ?? ''}`,
    [scope, selectedPersonId, view]
  )

  const selectedPerson = useMemo(
    () => (
      people.find((person) => person.personId === selectedPersonId)
      ?? allPeople.find((person) => person.personId === selectedPersonId)
      ?? null
    ),
    [allPeople, people, selectedPersonId]
  )
  const selectedFaces = useMemo(
    () => faces.filter((face) => selectedFaceIds.has(face.faceId)),
    [faces, selectedFaceIds]
  )
  const mergeTargetCandidates = useMemo(
    () => {
      const query = mergeTargetQuery.trim().toLowerCase()
      return allPeople
        .filter((person) => {
          if (person.personId === selectedPersonId) return false
          if (!query) return true
          return (
            getPersonDisplayName(person).toLowerCase().includes(query)
            || person.personId.toLowerCase().includes(query)
            || (person.featureAssetPath ?? '').toLowerCase().includes(query)
          )
        })
        .slice(0, 40)
    },
    [allPeople, mergeTargetQuery, selectedPersonId]
  )

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
    if (!readonly) return
    setScope('root')
    setView('people')
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
    if (!open || !preferredPersonId) return
    setView('people')
    clearSelection()
    setSelectedPersonId(preferredPersonId)
    if (isCompact) {
      setCompactPeopleStage('detail')
    }
  }, [clearSelection, isCompact, open, preferredPersonId])

  useEffect(() => {
    if (!isCompact || !open) return
    if (view !== 'people') return
    if (!selectedPersonId) {
      setCompactPeopleStage('list')
    }
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
    setSelectedPersonId(personId)
    if (isCompact) {
      setCompactPeopleStage('detail')
    }
  }, [isCompact])

  const handleShowPeopleList = useCallback(() => {
    if (!isCompact) return
    setCompactPeopleStage('list')
  }, [isCompact])

  const handleSwitchView = useCallback((nextView: PanelView) => {
    setView(nextView)
    clearSelection()
    if (isCompact) {
      setCompactPeopleStage(nextView === 'people' ? 'list' : 'detail')
    }
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

  const selectedIds = useMemo(() => [...selectedFaceIds], [selectedFaceIds])
  const assignmentExcludedPersonIds = useMemo(
    () => (view === 'people' && selectedPersonId ? [selectedPersonId] : []),
    [selectedPersonId, view]
  )
  const assignmentInputKey = useMemo(
    () => `${scope}:${view}:${selectedPersonId ?? ''}`,
    [scope, selectedPersonId, view]
  )
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
  const showCompactPeopleList = isCompact && view === 'people' && compactPeopleStage === 'list'
  const showCompactPeopleDetail = isCompact && view === 'people' && compactPeopleStage === 'detail'

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
          <div className={cn('border-b border-border', isCompact ? 'px-3 py-3' : 'px-4 py-3')}>
            <div className={cn('flex items-center justify-between gap-3', isCompact && 'flex-wrap')}>
              <div className="flex min-w-0 items-center gap-2">
                <Users className="h-4 w-4 shrink-0" />
                <h2 className="truncate text-sm font-semibold">{readonly ? '人物浏览' : '人物管理'}</h2>
              </div>
              <div className={cn('flex items-center gap-2', isCompact && 'w-full flex-wrap justify-end')}>
                {readonly ? (
                  <div className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground">
                    当前 Root
                  </div>
                ) : (
                  <div className="rounded-md border border-border p-1">
                    <button
                      type="button"
                      className={cn(
                        'rounded px-2 py-1 text-xs',
                        scope === 'global' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                      )}
                      onClick={() => setScope('global')}
                    >
                      全局
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded px-2 py-1 text-xs',
                        scope === 'root' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                      )}
                      onClick={() => setScope('root')}
                    >
                      当前 Root
                    </button>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={isLoadingPeople || isLoadingFaces}
                  onClick={() => {
                    void refreshAll()
                  }}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', (isLoadingPeople || isLoadingFaces) && 'animate-spin')} />
                  刷新
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="关闭">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {notice && (
            <div
              className={cn(
                isCompact ? 'mx-3 mt-3' : 'mx-4 mt-3',
                'rounded-md px-3 py-2 text-sm',
                notice.tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'
              )}
            >
              {notice.message}
            </div>
          )}

          {isCompact ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border px-3 py-2">
                <div className={cn('grid gap-2', readonly ? 'grid-cols-1' : 'grid-cols-3')}>
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-3 py-2 text-left text-sm',
                      view === 'people' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                    )}
                    onClick={() => handleSwitchView('people')}
                  >
                    人物
                  </button>
                  {!readonly && (
                    <>
                      <button
                        type="button"
                        className={cn(
                          'rounded-md px-3 py-2 text-left text-sm',
                          view === 'unassigned' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                        )}
                        onClick={() => handleSwitchView('unassigned')}
                      >
                        未归属
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'rounded-md px-3 py-2 text-left text-sm',
                          view === 'ignored' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                        )}
                        onClick={() => handleSwitchView('ignored')}
                      >
                        误检 / 忽略
                      </button>
                    </>
                  )}
                </div>
              </div>

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
                <div className="border-b border-border p-2">
                  <button
                    type="button"
                    className={cn(
                      'mb-1 w-full rounded-md px-3 py-2 text-left text-sm',
                      view === 'people' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                    )}
                    onClick={() => handleSwitchView('people')}
                  >
                    人物
                  </button>
                  {!readonly && (
                    <>
                      <button
                        type="button"
                        className={cn(
                          'mb-1 w-full rounded-md px-3 py-2 text-left text-sm',
                          view === 'unassigned' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                        )}
                        onClick={() => handleSwitchView('unassigned')}
                      >
                        未归属
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'w-full rounded-md px-3 py-2 text-left text-sm',
                          view === 'ignored' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                        )}
                        onClick={() => handleSwitchView('ignored')}
                      >
                        误检 / 忽略
                      </button>
                    </>
                  )}
                </div>

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
