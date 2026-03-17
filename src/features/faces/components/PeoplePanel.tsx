import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Users, X } from 'lucide-react'
import { dispatchSystemTool, type DispatchSystemToolResult } from '@/lib/actionDispatcher'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'

interface PersonSummary {
  personId: string
  name: string
  faceCount: number
  featureFaceId: string | null
  featureAssetPath: string | null
  updatedAt: number | null
}

interface FaceRecord {
  faceId: string
  assetPath: string
  score: number
}

interface PeoplePanelProps {
  open: boolean
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
  preferredPersonId?: string | null
  onClose: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readPeopleFromResult(result: DispatchSystemToolResult['result']): PersonSummary[] {
  if (!isRecord(result)) return []
  const rawItems = result.items
  if (!Array.isArray(rawItems)) return []

  return rawItems.flatMap((item) => {
    if (!isRecord(item)) return []
    const personId = typeof item.personId === 'string' ? item.personId : ''
    if (!personId) return []

    return [{
      personId,
      name: typeof item.name === 'string' ? item.name : '',
      faceCount: typeof item.faceCount === 'number' ? item.faceCount : 0,
      featureFaceId: typeof item.featureFaceId === 'string' ? item.featureFaceId : null,
      featureAssetPath: typeof item.featureAssetPath === 'string' ? item.featureAssetPath : null,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : null,
    }]
  })
}

function readFacesFromResult(result: DispatchSystemToolResult['result']): FaceRecord[] {
  if (!isRecord(result)) return []
  const rawItems = result.items
  if (!Array.isArray(rawItems)) return []

  return rawItems.flatMap((item) => {
    if (!isRecord(item)) return []
    const faceId = typeof item.faceId === 'string' ? item.faceId : ''
    const assetPath = typeof item.assetPath === 'string' ? item.assetPath : ''
    if (!faceId || !assetPath) return []
    return [{
      faceId,
      assetPath,
      score: typeof item.score === 'number' ? item.score : 0,
    }]
  })
}

export function PeoplePanel({
  open,
  rootHandle,
  rootId,
  preferredPersonId = null,
  onClose,
}: PeoplePanelProps) {
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [faces, setFaces] = useState<FaceRecord[]>([])
  const [isLoadingPeople, setIsLoadingPeople] = useState(false)
  const [isLoadingFaces, setIsLoadingFaces] = useState(false)
  const [isSavingRename, setIsSavingRename] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [mergeSourcePersonId, setMergeSourcePersonId] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const selectedPerson = useMemo(
    () => people.find((person) => person.personId === selectedPersonId) ?? null,
    [people, selectedPersonId]
  )

  const assetSummaries = useMemo(() => {
    const map = new Map<string, { assetPath: string; count: number; maxScore: number }>()
    for (const face of faces) {
      const existing = map.get(face.assetPath)
      if (existing) {
        existing.count += 1
        existing.maxScore = Math.max(existing.maxScore, face.score)
      } else {
        map.set(face.assetPath, {
          assetPath: face.assetPath,
          count: 1,
          maxScore: face.score,
        })
      }
    }
    return [...map.values()].sort((left, right) => right.maxScore - left.maxScore)
  }, [faces])

  const mergeCandidates = useMemo(
    () => people.filter((person) => person.personId !== selectedPersonId),
    [people, selectedPersonId]
  )

  const loadPeople = useCallback(async () => {
    setIsLoadingPeople(true)
    setErrorMessage(null)
    try {
      const result = await dispatchSystemTool({
        toolName: 'vision.face',
        rootHandle,
        rootId,
        additionalArgs: {
          operation: 'listPeople',
          page: 1,
          size: 200,
        },
      })
      if (!result.ok) {
        setErrorMessage(result.error || '读取人物列表失败')
        setPeople([])
        setSelectedPersonId(null)
        return
      }

      const items = readPeopleFromResult(result.result)
      setPeople(items)
      setSelectedPersonId((previous) => {
        if (preferredPersonId && items.some((item) => item.personId === preferredPersonId)) {
          return preferredPersonId
        }
        if (previous && items.some((item) => item.personId === previous)) {
          return previous
        }
        return items[0]?.personId ?? null
      })
    } finally {
      setIsLoadingPeople(false)
    }
  }, [preferredPersonId, rootHandle, rootId])

  const loadPersonFaces = useCallback(async (personId: string) => {
    setIsLoadingFaces(true)
    try {
      const result = await dispatchSystemTool({
        toolName: 'vision.face',
        rootHandle,
        rootId,
        additionalArgs: {
          operation: 'listAssetFaces',
          personId,
        },
      })
      if (!result.ok) {
        setErrorMessage(result.error || '读取人物关联图片失败')
        setFaces([])
        return
      }
      setFaces(readFacesFromResult(result.result))
    } finally {
      setIsLoadingFaces(false)
    }
  }, [rootHandle, rootId])

  useEffect(() => {
    if (!open) return
    void loadPeople()
  }, [loadPeople, open])

  useEffect(() => {
    if (!selectedPersonId || !open) {
      setFaces([])
      return
    }
    void loadPersonFaces(selectedPersonId)
  }, [loadPersonFaces, open, selectedPersonId])

  useEffect(() => {
    setRenameDraft(selectedPerson?.name || '')
    setMergeSourcePersonId('')
  }, [selectedPerson?.name, selectedPersonId])

  useEffect(() => {
    if (!open) return
    if (!preferredPersonId) return
    if (!people.some((person) => person.personId === preferredPersonId)) return
    setSelectedPersonId(preferredPersonId)
  }, [open, people, preferredPersonId])

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

  const handleSaveRename = useCallback(async () => {
    if (!selectedPerson) return
    const nextName = renameDraft.trim()
    if (nextName === selectedPerson.name) return

    setIsSavingRename(true)
    setErrorMessage(null)
    try {
      const result = await dispatchSystemTool({
        toolName: 'vision.face',
        rootHandle,
        rootId,
        additionalArgs: {
          operation: 'renamePerson',
          personId: selectedPerson.personId,
          name: nextName,
        },
      })
      if (!result.ok) {
        setErrorMessage(result.error || '人物重命名失败')
        return
      }
      await loadPeople()
    } finally {
      setIsSavingRename(false)
    }
  }, [loadPeople, renameDraft, rootHandle, rootId, selectedPerson])

  const handleMerge = useCallback(async () => {
    if (!selectedPerson || !mergeSourcePersonId) return

    setIsMerging(true)
    setErrorMessage(null)
    try {
      const result = await dispatchSystemTool({
        toolName: 'vision.face',
        rootHandle,
        rootId,
        additionalArgs: {
          operation: 'mergePeople',
          targetPersonId: selectedPerson.personId,
          sourcePersonIds: [mergeSourcePersonId],
        },
      })
      if (!result.ok) {
        setErrorMessage(result.error || '人物合并失败')
        return
      }
      setMergeSourcePersonId('')
      await loadPeople()
      await loadPersonFaces(selectedPerson.personId)
    } finally {
      setIsMerging(false)
    }
  }, [loadPeople, loadPersonFaces, mergeSourcePersonId, rootHandle, rootId, selectedPerson])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-[900px] max-w-[96vw] border-l border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <h2 className="text-sm font-semibold">人物列表</h2>
              <span className="text-xs text-muted-foreground">共 {people.length} 人</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
                onClick={() => {
                  void loadPeople()
                }}
                disabled={isLoadingPeople}
                title="刷新人物列表"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingPeople ? 'animate-spin' : ''}`} />
                刷新
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="关闭">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {errorMessage && (
            <div className="mx-4 mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="w-[320px] shrink-0 border-r border-border">
              <div className="h-full overflow-auto p-2">
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
                      className={`mb-1 w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        isActive
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-accent'
                      }`}
                      onClick={() => {
                        setSelectedPersonId(person.personId)
                      }}
                    >
                      <div className="truncate text-sm font-medium">
                        {person.name || '(未命名)'}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {person.faceCount} 张脸
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              {!selectedPerson && (
                <div className="px-4 py-4 text-sm text-muted-foreground">请选择一个人物</div>
              )}

              {selectedPerson && (
                <div className="flex h-full flex-col">
                  <div className="border-b border-border px-4 py-3">
                    <div className="text-sm font-medium">人物详情</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        placeholder="人物名称"
                        className="h-8"
                      />
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          void handleSaveRename()
                        }}
                        disabled={isSavingRename}
                      >
                        {isSavingRename ? '保存中...' : '保存名称'}
                      </Button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        value={mergeSourcePersonId}
                        onChange={(event) => setMergeSourcePersonId(event.target.value)}
                        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                      >
                        <option value="">选择要合并的人物</option>
                        {mergeCandidates.map((item) => (
                          <option key={item.personId} value={item.personId}>
                            {item.name || '(未命名)'} · {item.faceCount} 张
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          void handleMerge()
                        }}
                        disabled={!mergeSourcePersonId || isMerging}
                      >
                        {isMerging ? '合并中...' : '合并到当前'}
                      </Button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                    <div className="mb-2 text-sm font-medium">关联图片列表</div>
                    {isLoadingFaces && (
                      <div className="text-sm text-muted-foreground">加载中...</div>
                    )}
                    {!isLoadingFaces && assetSummaries.length === 0 && (
                      <div className="text-sm text-muted-foreground">当前人物暂无关联图片</div>
                    )}
                    {!isLoadingFaces && assetSummaries.length > 0 && (
                      <div className="space-y-2">
                        {assetSummaries.map((item) => (
                          <div
                            key={item.assetPath}
                            className="rounded-md border border-border px-3 py-2"
                          >
                            <div className="truncate text-sm">{item.assetPath}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              命中人脸 {item.count} 个 · 最高分 {item.maxScore.toFixed(3)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
