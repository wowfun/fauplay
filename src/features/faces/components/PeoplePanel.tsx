import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
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
import type { FaceMutationResult, FaceRecord, PersonScope, PersonSummary } from '@/features/faces/types'
import { GatewayFaceCropImage } from '@/features/faces/components/GatewayFaceCropImage'
import { PersonAssignmentInput } from '@/features/faces/components/PersonAssignmentInput'
import { cn } from '@/lib/utils'
import { GRID_SELECTABLE_ITEM_ATTR, useGridSelection } from '@/hooks/useGridSelection'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'

type PanelView = 'people' | 'unassigned' | 'ignored'
type NoticeTone = 'info' | 'error'

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

function faceCountText(person: PersonSummary, scope: PersonScope): string {
  if (scope === 'global') {
    return `${person.faceCount} 张脸`
  }
  return `当前 ${person.faceCount} / 全局 ${person.globalFaceCount}`
}

function formatFrameTsMs(frameTsMs: number | null): string | null {
  if (typeof frameTsMs !== 'number' || !Number.isFinite(frameTsMs) || frameTsMs < 0) return null
  const totalSeconds = Math.floor(frameTsMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
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
  onSelectionChange: (faceIds: string[]) => void
  onOpenFaceSource?: (face: FaceRecord) => boolean | Promise<boolean>
  compact?: boolean
}

function getFaceSelectionId(face: FaceRecord): string {
  return face.faceId
}

function FaceGrid({
  faces,
  selectedFaceIds,
  onSelectionChange,
  onOpenFaceSource,
  compact = false,
}: FaceGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedFaceIdsRef = useRef<Set<string>>(selectedFaceIds)
  const preClickSelectionRef = useRef<Set<string> | null>(null)
  const singleClickTimeoutRef = useRef<number | null>(null)
  const {
    selectedIdSet,
    marqueeRect,
    replaceSelection,
    toggleSelection,
    setAnchorId,
    selectRangeToId,
    handleMarqueePointerDown,
    shouldSuppressClick,
  } = useGridSelection({
    items: faces,
    getId: getFaceSelectionId,
    selectedIds: selectedFaceIds,
    onSelectionChange,
    containerRef,
  })

  useEffect(() => {
    selectedFaceIdsRef.current = selectedFaceIds
  }, [selectedFaceIds])

  const clearPendingSingleClick = useCallback(() => {
    if (singleClickTimeoutRef.current !== null) {
      window.clearTimeout(singleClickTimeoutRef.current)
      singleClickTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => clearPendingSingleClick()
  }, [clearPendingSingleClick])

  const handleFaceClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>, faceId: string) => {
    if (shouldSuppressClick()) {
      clearPendingSingleClick()
      return
    }

    if (event.detail > 1) {
      clearPendingSingleClick()
      return
    }

    const isRangeSelection = event.shiftKey
    const isToggleSelection = event.ctrlKey || event.metaKey
    preClickSelectionRef.current = new Set(selectedFaceIdsRef.current)
    clearPendingSingleClick()
    singleClickTimeoutRef.current = window.setTimeout(() => {
      singleClickTimeoutRef.current = null
      if (isRangeSelection) {
        selectRangeToId(faceId)
        return
      }

      setAnchorId(faceId)
      if (isToggleSelection) {
        toggleSelection(faceId)
        return
      }

      replaceSelection([faceId])
    }, 240)
  }, [clearPendingSingleClick, replaceSelection, selectRangeToId, setAnchorId, shouldSuppressClick, toggleSelection])

  const handleFaceDoubleClick = useCallback((face: FaceRecord) => {
    if (shouldSuppressClick()) {
      clearPendingSingleClick()
      return
    }

    clearPendingSingleClick()
    const previousSelection = preClickSelectionRef.current
    if (previousSelection) {
      replaceSelection(previousSelection)
    }
    void onOpenFaceSource?.(face)
  }, [clearPendingSingleClick, onOpenFaceSource, replaceSelection, shouldSuppressClick])

  if (faces.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        当前视图暂无人脸
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative grid gap-3',
        compact
          ? 'grid-cols-[repeat(auto-fill,minmax(128px,1fr))]'
          : 'grid-cols-[repeat(auto-fill,minmax(160px,1fr))]'
      )}
      onPointerDown={handleMarqueePointerDown}
    >
      {marqueeRect && (
        <div
          className="pointer-events-none fixed z-[70] rounded-sm border border-primary bg-primary/15"
          style={marqueeRect}
        />
      )}
      {faces.map((face) => {
        const isSelected = selectedIdSet.has(face.faceId)
        const frameTs = formatFrameTsMs(face.frameTsMs)
        const sourcePath = face.assetPath || '未知路径'
        const statusText = statusLabel(face.status)
        const personText = face.personId && face.personName ? face.personName : '未归属'
        return (
          <button
            key={face.faceId}
            type="button"
            {...{ [GRID_SELECTABLE_ITEM_ATTR]: face.faceId }}
            title={`${statusText} · ${personText} · ${sourcePath}`}
            aria-label={`人脸 ${sourcePath}，score ${face.score.toFixed(2)}，${statusText}`}
            className={cn(
              'rounded-md border p-2 text-left transition-colors select-none',
              isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/60'
            )}
            onClick={(event) => handleFaceClick(event, face.faceId)}
            onDoubleClick={() => handleFaceDoubleClick(face)}
            >
              <GatewayFaceCropImage
                faceId={face.faceId}
                size={compact ? 128 : 160}
                padding={0.35}
                alt="人脸裁切"
                draggable={false}
                className={cn(
                  'w-full rounded-md border border-border object-cover',
                  compact ? 'h-28' : 'h-36'
                )}
              />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                score {face.score.toFixed(2)}
              </span>
              {face.mediaType === 'video' && frameTs && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {frameTs}
                </span>
              )}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground" title={face.assetPath || undefined}>
              {sourcePath}
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
            displayPersonName(person).toLowerCase().includes(query)
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
      setNotice(readResultMessage(result))
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
                  <div className="flex min-h-full flex-col gap-3">
                    <Input
                      value={peopleQuery}
                      onChange={(event) => setPeopleQuery(event.target.value)}
                      placeholder="搜索人物名"
                    />
                    <div className="space-y-2">
                      {isLoadingPeople && (
                        <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                          人物列表加载中...
                        </div>
                      )}
                      {!isLoadingPeople && people.length === 0 && (
                        <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                          暂无人脸人物数据
                        </div>
                      )}
                      {people.map((person) => {
                        const isActive = person.personId === selectedPersonId
                        return (
                          <button
                            key={person.personId}
                            type="button"
                            className={cn(
                              'flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                              isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                            )}
                            onClick={() => handleSelectPerson(person.personId)}
                          >
                            {person.featureFaceId ? (
                              <GatewayFaceCropImage
                                faceId={person.featureFaceId}
                                size={72}
                                padding={0.35}
                                alt={displayPersonName(person)}
                                className="h-[72px] w-[72px] shrink-0 rounded-lg border border-border object-cover"
                              />
                            ) : (
                              <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
                                无代表脸
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{displayPersonName(person)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{faceCountText(person, scope)}</div>
                              {person.featureAssetPath && (
                                <div className="mt-1 truncate text-xs text-muted-foreground" title={person.featureAssetPath}>
                                  {person.featureAssetPath}
                                </div>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
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
                            <GatewayFaceCropImage
                              faceId={selectedPerson.featureFaceId}
                              size={88}
                              padding={0.35}
                              alt={displayPersonName(selectedPerson)}
                              className="h-[88px] w-[88px] shrink-0 rounded-lg border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
                              无代表脸
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-semibold">{displayPersonName(selectedPerson)}</div>
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
                          <div className="max-h-72 overflow-auto rounded-md border border-border bg-background p-2">
                            {mergeTargetCandidates.length === 0 ? (
                              <div className="px-2 py-4 text-sm text-muted-foreground">暂无可合并的目标人物</div>
                            ) : (
                              <div className="space-y-2">
                                {mergeTargetCandidates.map((person) => {
                                  const isSelected = person.personId === mergeTargetPersonId
                                  return (
                                    <button
                                      key={person.personId}
                                      type="button"
                                      className={cn(
                                        'flex w-full min-w-0 gap-3 rounded-md border p-2 text-left transition-colors',
                                        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/60'
                                      )}
                                      disabled={isMerging}
                                      onClick={() => setMergeTargetPersonId(person.personId)}
                                    >
                                      {person.featureFaceId ? (
                                        <GatewayFaceCropImage
                                          faceId={person.featureFaceId}
                                          size={64}
                                          padding={0.35}
                                          alt={displayPersonName(person)}
                                          className="h-14 w-14 shrink-0 rounded-md border border-border object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
                                          无代表脸
                                        </div>
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">{displayPersonName(person)}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{faceCountText(person, scope)}</div>
                                        {person.featureAssetPath && (
                                          <div className="mt-1 truncate text-xs text-muted-foreground" title={person.featureAssetPath}>
                                            {person.featureAssetPath}
                                          </div>
                                        )}
                                      </div>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
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
                        <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">归属到人物</div>
                            <PersonAssignmentInput
                              key={`compact-detail:${assignmentInputKey}`}
                              context={context}
                              scope={scope}
                              querySize={40}
                              emptyQuerySize={40}
                              disabled={isMutatingFaces || selectedIds.length === 0}
                              excludedPersonIds={assignmentExcludedPersonIds}
                              onAssign={handleAssignSelectedFaces}
                              onCreate={handleCreatePersonForSelectedFaces}
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
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
                              className="w-full"
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
                              className="w-full"
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
                              className="w-full"
                              disabled={isMutatingFaces || selectedFaces.every((face) => face.status !== 'manual_unassigned')}
                              onClick={() => {
                                void runFaceMutation(() => requeueFaces(context, {
                                  faceIds: selectedIds,
                                }))
                              }}
                            >
                              重新交给聚类
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              disabled={isMutatingFaces || isProjectingSources || selectedIds.length === 0}
                              onClick={() => {
                                void handleProjectFaceSources()
                              }}
                            >
                              投射源文件
                            </Button>
                          </div>
                        </div>
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

                    <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-muted-foreground">归属到人物</div>
                        <PersonAssignmentInput
                          key={`compact-review:${assignmentInputKey}`}
                          context={context}
                          scope={scope}
                          querySize={40}
                          emptyQuerySize={40}
                          disabled={isMutatingFaces || selectedIds.length === 0}
                          excludedPersonIds={assignmentExcludedPersonIds}
                          onAssign={handleAssignSelectedFaces}
                          onCreate={handleCreatePersonForSelectedFaces}
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
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
                          className="w-full"
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
                          className="w-full"
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
                          className="w-full"
                          disabled={isMutatingFaces || selectedFaces.every((face) => face.status !== 'manual_unassigned')}
                          onClick={() => {
                            void runFaceMutation(() => requeueFaces(context, {
                              faceIds: selectedIds,
                            }))
                          }}
                        >
                          重新交给聚类
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          disabled={isMutatingFaces || isProjectingSources || selectedIds.length === 0}
                          onClick={() => {
                            void handleProjectFaceSources()
                          }}
                        >
                          投射源文件
                        </Button>
                      </div>
                    </div>

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
                            onClick={() => handleSelectPerson(person.personId)}
                          >
                            <div className="truncate text-sm font-medium">{displayPersonName(person)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{faceCountText(person, scope)}</div>
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
                {view === 'people' && selectedPerson && !readonly && (
                  <div className="mb-4 space-y-4 rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-semibold">{displayPersonName(selectedPerson)}</div>
                        <div className="text-sm text-muted-foreground">{faceCountText(selectedPerson, scope)}</div>
                      </div>
                      {selectedPerson.featureFaceId && (
                        <GatewayFaceCropImage
                          faceId={selectedPerson.featureFaceId}
                          size={112}
                          padding={0.35}
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
                        <div className="max-h-56 overflow-auto rounded-md border border-border bg-background p-2">
                          {mergeTargetCandidates.length === 0 ? (
                            <div className="px-2 py-4 text-sm text-muted-foreground">暂无可合并的目标人物</div>
                          ) : (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                              {mergeTargetCandidates.map((person) => {
                                const isSelected = person.personId === mergeTargetPersonId
                                return (
                                  <button
                                    key={person.personId}
                                    type="button"
                                    className={cn(
                                      'flex min-w-0 gap-3 rounded-md border p-2 text-left transition-colors',
                                      isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/60'
                                    )}
                                    disabled={isMerging}
                                    onClick={() => setMergeTargetPersonId(person.personId)}
                                  >
                                    {person.featureFaceId ? (
                                      <GatewayFaceCropImage
                                        faceId={person.featureFaceId}
                                        size={80}
                                        padding={0.35}
                                        alt={displayPersonName(person)}
                                        className="h-14 w-14 shrink-0 rounded-md border border-border object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
                                        无代表脸
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium">{displayPersonName(person)}</div>
                                      <div className="mt-1 text-xs text-muted-foreground">{faceCountText(person, scope)}</div>
                                      {person.featureAssetPath && (
                                        <div className="mt-1 truncate text-xs text-muted-foreground" title={person.featureAssetPath}>
                                          {person.featureAssetPath}
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
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
                    <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-muted-foreground">归属到人物</div>
                        <PersonAssignmentInput
                          key={`wide:${assignmentInputKey}`}
                          context={context}
                          scope={scope}
                          querySize={40}
                          emptyQuerySize={40}
                          className="max-w-[560px]"
                          disabled={isMutatingFaces || selectedIds.length === 0}
                          excludedPersonIds={assignmentExcludedPersonIds}
                          onAssign={handleAssignSelectedFaces}
                          onCreate={handleCreatePersonForSelectedFaces}
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
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
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isMutatingFaces || isProjectingSources || selectedIds.length === 0}
                          onClick={() => {
                            void handleProjectFaceSources()
                          }}
                        >
                          投射源文件
                        </Button>
                      </div>
                    </div>
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
