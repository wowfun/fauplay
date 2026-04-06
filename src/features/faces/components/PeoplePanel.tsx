import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Users, X } from 'lucide-react'
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
import type { FaceMutationResult, FaceRecord, PersonScope, PersonSummary } from '@/features/faces/types'
import { buildGatewayFaceCropUrl } from '@/lib/gateway'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'

type PanelView = 'people' | 'unassigned' | 'ignored'
type NoticeTone = 'info' | 'error'

interface PeoplePanelProps {
  open: boolean
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
  preferredPersonId?: string | null
  onClose: () => void
}

function displayPersonName(person: Pick<PersonSummary, 'personId' | 'name'>): string {
  return person.name.trim() || `(未命名 ${person.personId.slice(0, 8)})`
}

function statusLabel(status: FaceRecord['status']): string {
  if (status === 'assigned') return '已归属'
  if (status === 'manual_unassigned') return '人工未归属'
  if (status === 'deferred') return '待聚类'
  if (status === 'ignored') return '已忽略'
  return '未归属'
}

function statusBadgeClass(status: FaceRecord['status']): string {
  if (status === 'assigned') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
  if (status === 'manual_unassigned') return 'border-amber-500/40 bg-amber-500/10 text-amber-700'
  if (status === 'deferred') return 'border-sky-500/40 bg-sky-500/10 text-sky-700'
  if (status === 'ignored') return 'border-slate-500/40 bg-slate-500/10 text-slate-700'
  return 'border-orange-500/40 bg-orange-500/10 text-orange-700'
}

function faceCountText(person: PersonSummary, scope: PersonScope): string {
  if (scope === 'global') {
    return `${person.faceCount} 张脸`
  }
  return `当前 ${person.faceCount} / 全局 ${person.globalFaceCount}`
}

function readResultMessage(result: FaceMutationResult): { tone: NoticeTone; message: string } | null {
  if (result.failed <= 0) {
    return {
      tone: 'info',
      message: `已完成 ${result.succeeded} 项`,
    }
  }

  const firstError = result.items.find((item) => !item.ok)?.error
  if (result.succeeded <= 0) {
    return {
      tone: 'error',
      message: firstError || `操作失败（${result.failed} 项）`,
    }
  }

  return {
    tone: 'error',
    message: `已完成 ${result.succeeded} 项，失败 ${result.failed} 项${firstError ? `：${firstError}` : ''}`,
  }
}

interface FaceGridProps {
  faces: FaceRecord[]
  selectedFaceIds: Set<string>
  onToggleFace: (faceId: string) => void
}

function FaceGrid({ faces, selectedFaceIds, onToggleFace }: FaceGridProps) {
  if (faces.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        当前视图暂无人脸
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
      {faces.map((face) => {
        const isSelected = selectedFaceIds.has(face.faceId)
        return (
          <button
            key={face.faceId}
            type="button"
            className={cn(
              'rounded-md border p-2 text-left transition-colors',
              isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/60'
            )}
            onClick={() => onToggleFace(face.faceId)}
          >
            <img
              src={buildGatewayFaceCropUrl(face.faceId, { size: 160, padding: 0.35 })}
              alt={face.faceId}
              className="h-36 w-full rounded-md border border-border object-cover"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', statusBadgeClass(face.status))}>
                {statusLabel(face.status)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {face.score.toFixed(2)}
              </span>
            </div>
            <div className="mt-2 truncate text-sm font-medium">
              {face.personId && face.personName ? face.personName : '未归属'}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground" title={face.assetPath || undefined}>
              {face.assetPath || '未知路径'}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function PeoplePanel({
  open,
  rootHandle,
  rootId,
  preferredPersonId = null,
  onClose,
}: PeoplePanelProps) {
  const peopleListRequestIdRef = useRef(0)
  const context = useMemo(() => ({
    rootHandle,
    rootId,
  }), [rootHandle, rootId])
  const [scope, setScope] = useState<PersonScope>('global')
  const [view, setView] = useState<PanelView>('people')
  const [allPeople, setAllPeople] = useState<PersonSummary[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [faces, setFaces] = useState<FaceRecord[]>([])
  const [selectedFaceIds, setSelectedFaceIds] = useState<Set<string>>(new Set())
  const [peopleQuery, setPeopleQuery] = useState('')
  const [targetQuery, setTargetQuery] = useState('')
  const [targetResults, setTargetResults] = useState<PersonSummary[]>([])
  const [selectedTargetPersonId, setSelectedTargetPersonId] = useState('')
  const [newPersonName, setNewPersonName] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [mergeSourcePersonId, setMergeSourcePersonId] = useState('')
  const [isLoadingPeople, setIsLoadingPeople] = useState(false)
  const [isLoadingFaces, setIsLoadingFaces] = useState(false)
  const [isLoadingTargets, setIsLoadingTargets] = useState(false)
  const [isSavingRename, setIsSavingRename] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [isMutatingFaces, setIsMutatingFaces] = useState(false)
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null)

  const selectedPerson = useMemo(
    () => people.find((person) => person.personId === selectedPersonId) ?? null,
    [people, selectedPersonId]
  )
  const selectedFaces = useMemo(
    () => faces.filter((face) => selectedFaceIds.has(face.faceId)),
    [faces, selectedFaceIds]
  )
  const mergeCandidates = useMemo(
    () => allPeople.filter((person) => person.personId !== selectedPersonId),
    [allPeople, selectedPersonId]
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
  }, [context, scope, selectedPersonId, view])

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      loadAllPeople(),
      loadPeopleList(peopleQuery),
      loadCurrentFaces(),
    ])
  }, [loadAllPeople, loadCurrentFaces, loadPeopleList, peopleQuery])

  useEffect(() => {
    if (!open) return
    clearSelection()
    setNotice(null)
  }, [clearSelection, open])

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
    clearSelection()
    void loadCurrentFaces()
  }, [clearSelection, loadCurrentFaces, open])

  useEffect(() => {
    setRenameDraft(selectedPerson?.name || '')
    setMergeSourcePersonId('')
  }, [selectedPerson?.name, selectedPersonId])

  useEffect(() => {
    if (!open || !preferredPersonId) return
    setView('people')
    clearSelection()
    setSelectedPersonId(preferredPersonId)
  }, [clearSelection, open, preferredPersonId])

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

  useEffect(() => {
    if (!open) return
    if (!targetQuery.trim()) {
      setTargetResults(allPeople.filter((person) => person.personId !== selectedPersonId).slice(0, 40))
      setIsLoadingTargets(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setIsLoadingTargets(true)
        try {
          const items = await listPeople(context, {
            scope,
            query: targetQuery.trim(),
            size: 40,
          })
          if (!cancelled) {
            setTargetResults(items.filter((person) => person.personId !== selectedPersonId))
          }
        } catch (error) {
          if (!cancelled) {
            setTargetResults([])
            setNotice({
              tone: 'error',
              message: error instanceof Error ? error.message : '目标人物搜索失败',
            })
          }
        } finally {
          if (!cancelled) {
            setIsLoadingTargets(false)
          }
        }
      })()
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [allPeople, context, open, scope, selectedPersonId, targetQuery])

  const toggleFaceSelection = useCallback((faceId: string) => {
    setSelectedFaceIds((previous) => {
      const next = new Set(previous)
      if (next.has(faceId)) {
        next.delete(faceId)
      } else {
        next.add(faceId)
      }
      return next
    })
  }, [])

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
    if (!selectedPerson || !mergeSourcePersonId) return

    setIsMerging(true)
    setNotice(null)
    try {
      await mergePeople(context, {
        targetPersonId: selectedPerson.personId,
        sourcePersonIds: [mergeSourcePersonId],
      })
      setNotice({
        tone: 'info',
        message: '人物已合并',
      })
      setMergeSourcePersonId('')
      await refreshAll()
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '人物合并失败',
      })
    } finally {
      setIsMerging(false)
    }
  }, [context, mergeSourcePersonId, refreshAll, selectedPerson])

  const runFaceMutation = useCallback(async (task: () => Promise<FaceMutationResult>) => {
    if (selectedFaceIds.size === 0) return
    setIsMutatingFaces(true)
    setNotice(null)
    try {
      const result = await task()
      setNotice(readResultMessage(result))
      clearSelection()
      setSelectedTargetPersonId('')
      setTargetQuery('')
      setNewPersonName('')
      await refreshAll()
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '人脸纠错失败',
      })
    } finally {
      setIsMutatingFaces(false)
    }
  }, [clearSelection, refreshAll, selectedFaceIds.size])

  const selectedIds = useMemo(() => [...selectedFaceIds], [selectedFaceIds])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-[1180px] max-w-[98vw] border-l border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <h2 className="text-sm font-semibold">人物管理</h2>
            </div>
            <div className="flex items-center gap-2">
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

          {notice && (
            <div
              className={cn(
                'mx-4 mt-3 rounded-md px-3 py-2 text-sm',
                notice.tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'
              )}
            >
              {notice.message}
            </div>
          )}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="w-[300px] shrink-0 border-r border-border">
              <div className="border-b border-border p-2">
                <button
                  type="button"
                  className={cn(
                    'mb-1 w-full rounded-md px-3 py-2 text-left text-sm',
                    view === 'people' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                  )}
                  onClick={() => setView('people')}
                >
                  人物
                </button>
                <button
                  type="button"
                  className={cn(
                    'mb-1 w-full rounded-md px-3 py-2 text-left text-sm',
                    view === 'unassigned' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                  )}
                  onClick={() => setView('unassigned')}
                >
                  未归属
                </button>
                <button
                  type="button"
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-sm',
                    view === 'ignored' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                  )}
                  onClick={() => setView('ignored')}
                >
                  误检 / 忽略
                </button>
              </div>

              {view === 'people' && (
                <div className="flex h-[calc(100%-125px)] flex-col">
                  <div className="border-b border-border p-2">
                    <Input
                      value={peopleQuery}
                      onChange={(event) => setPeopleQuery(event.target.value)}
                      placeholder="搜索人物名"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    {isLoadingPeople && (
                      <div className="px-2 py-3 text-sm text-muted-foreground">人物列表加载中...</div>
                    )}
                    {!isLoadingPeople && people.length === 0 && (
                      <div className="px-2 py-3 text-sm text-muted-foreground">暂无人物数据</div>
                    )}
                    {people.map((person) => {
                      const isActive = person.personId === selectedPersonId
                      return (
                        <button
                          key={person.personId}
                          type="button"
                          className={cn(
                            'mb-1 w-full rounded-md border px-3 py-2 text-left transition-colors',
                            isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                          )}
                          onClick={() => setSelectedPersonId(person.personId)}
                        >
                          <div className="truncate text-sm font-medium">
                            {displayPersonName(person)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {faceCountText(person, scope)}
                          </div>
                          {person.featureAssetPath && (
                            <div className="mt-1 truncate text-xs text-muted-foreground" title={person.featureAssetPath}>
                              {person.featureAssetPath}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 overflow-auto p-4">
              {view === 'people' && selectedPerson && (
                <div className="mb-4 space-y-4 rounded-md border border-border p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-semibold">{displayPersonName(selectedPerson)}</div>
                      <div className="text-sm text-muted-foreground">
                        {faceCountText(selectedPerson, scope)}
                      </div>
                    </div>
                    {selectedPerson.featureFaceId && (
                      <img
                        src={buildGatewayFaceCropUrl(selectedPerson.featureFaceId, { size: 112, padding: 0.35 })}
                        alt={selectedPerson.personId}
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

                    <div className="min-w-[280px] flex-1">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">合并到当前人物</div>
                      <div className="flex gap-2">
                        <select
                          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                          value={mergeSourcePersonId}
                          onChange={(event) => setMergeSourcePersonId(event.target.value)}
                          disabled={isMerging}
                        >
                          <option value="">选择要并入的人物</option>
                          {mergeCandidates.map((person) => (
                            <option key={person.personId} value={person.personId}>
                              {displayPersonName(person)}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isMerging || !mergeSourcePersonId}
                          onClick={() => {
                            void handleMerge()
                          }}
                        >
                          合并
                        </Button>
                      </div>
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
                      已选 {selectedFaceIds.size} / 当前 {faces.length}
                    </div>
                  </div>
                  {selectedFaceIds.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearSelection}>
                      清空选择
                    </Button>
                  )}
                </div>

                <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={targetQuery}
                      onChange={(event) => setTargetQuery(event.target.value)}
                      placeholder="搜索目标人物"
                      className="min-w-[220px] flex-1"
                      disabled={isMutatingFaces}
                    />
                    <select
                      className="h-9 min-w-[220px] rounded-md border border-border bg-background px-2 text-sm"
                      value={selectedTargetPersonId}
                      onChange={(event) => setSelectedTargetPersonId(event.target.value)}
                      disabled={isMutatingFaces}
                    >
                      <option value="">
                        {isLoadingTargets ? '人物搜索中...' : '选择目标人物'}
                      </option>
                      {targetResults.map((person) => (
                        <option key={person.personId} value={person.personId}>
                          {displayPersonName(person)}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutatingFaces || selectedIds.length === 0 || !selectedTargetPersonId}
                      onClick={() => {
                        void runFaceMutation(() => assignFaces(context, {
                          faceIds: selectedIds,
                          targetPersonId: selectedTargetPersonId,
                        }))
                      }}
                    >
                      移到该人物
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={newPersonName}
                      onChange={(event) => setNewPersonName(event.target.value)}
                      placeholder="新人物名称，可留空"
                      className="min-w-[220px] flex-1"
                      disabled={isMutatingFaces}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutatingFaces || selectedIds.length === 0}
                      onClick={() => {
                        void runFaceMutation(() => createPersonFromFaces(context, {
                          faceIds: selectedIds,
                          name: newPersonName,
                        }))
                      }}
                    >
                      新建人物并移入
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutatingFaces || selectedIds.length === 0}
                      onClick={() => {
                        void runFaceMutation(() => unassignFaces(context, {
                          faceIds: selectedIds,
                        }))
                      }}
                    >
                      移出为未归属
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutatingFaces || selectedIds.length === 0}
                      onClick={() => {
                        void runFaceMutation(() => ignoreFaces(context, {
                          faceIds: selectedIds,
                        }))
                      }}
                    >
                      标记忽略
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutatingFaces || selectedFaces.every((face) => face.status !== 'ignored')}
                      onClick={() => {
                        void runFaceMutation(() => restoreIgnoredFaces(context, {
                          faceIds: selectedIds,
                        }))
                      }}
                    >
                      恢复忽略
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutatingFaces || selectedFaces.every((face) => face.status !== 'manual_unassigned')}
                      onClick={() => {
                        void runFaceMutation(() => requeueFaces(context, {
                          faceIds: selectedIds,
                        }))
                      }}
                    >
                      重新交给聚类
                    </Button>
                  </div>
                </div>

                {isLoadingFaces ? (
                  <div className="py-8 text-sm text-muted-foreground">人脸数据加载中...</div>
                ) : (
                  <FaceGrid
                    faces={faces}
                    selectedFaceIds={selectedFaceIds}
                    onToggleFace={toggleFaceSelection}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
