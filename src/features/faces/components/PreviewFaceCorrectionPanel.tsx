import { useEffect, useState } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import {
  assignFaces,
  createPersonFromFaces,
  ignoreFaces,
  listPeople,
  requeueFaces,
  restoreIgnoredFaces,
  suggestPeople,
  unassignFaces,
} from '@/features/faces/api'
import type { FaceMutationResult, PersonSuggestion, PersonSummary, PreviewFaceOverlayItem } from '@/features/faces/types'
import { buildGatewayFaceCropUrl } from '@/lib/gateway'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'

interface PreviewFaceCorrectionPanelProps {
  face: PreviewFaceOverlayItem | null
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
  onClose: () => void
  onMutationCommitted?: () => void | Promise<void>
  onOpenPersonDetail?: (personId: string | null) => void
}

function statusLabel(status: PreviewFaceOverlayItem['status']): string {
  if (status === 'assigned') return '已归属'
  if (status === 'manual_unassigned') return '人工未归属'
  if (status === 'deferred') return '待自动聚类'
  if (status === 'ignored') return '误检/忽略'
  return '未归属'
}

function displayPersonName(person: Pick<PersonSummary, 'personId' | 'name'> | Pick<PersonSuggestion, 'personId' | 'name'>): string {
  return person.name.trim() || `人物 ${person.personId.slice(0, 8)}`
}

export function PreviewFaceCorrectionPanel({
  face,
  rootHandle,
  rootId,
  onClose,
  onMutationCommitted,
  onOpenPersonDetail,
}: PreviewFaceCorrectionPanelProps) {
  const [suggestions, setSuggestions] = useState<PersonSuggestion[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PersonSummary[]>([])
  const [newPersonName, setNewPersonName] = useState('')
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isLoadingSearch, setIsLoadingSearch] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setSearchQuery('')
    setSearchResults([])
    setNewPersonName('')
    setErrorMessage(null)
  }, [face?.faceId])

  useEffect(() => {
    if (!face || !rootId) {
      setSuggestions([])
      setIsLoadingSuggestions(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setIsLoadingSuggestions(true)
      try {
        const items = await suggestPeople(
          {
            rootHandle,
            rootId,
          },
          {
            faceId: face.faceId,
            candidateSize: 6,
          }
        )
        if (!cancelled) {
          setSuggestions(items.filter((item) => item.personId !== face.personId))
        }
      } catch (error) {
        if (!cancelled) {
          setSuggestions([])
          setErrorMessage(error instanceof Error ? error.message : '人物建议加载失败')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSuggestions(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [face, rootHandle, rootId])

  useEffect(() => {
    if (!face || !rootId || !searchQuery.trim()) {
      setSearchResults([])
      setIsLoadingSearch(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setIsLoadingSearch(true)
        try {
          const items = await listPeople(
            {
              rootHandle,
              rootId,
            },
            {
              scope: 'global',
              query: searchQuery.trim(),
              size: 20,
            }
          )
          if (!cancelled) {
            setSearchResults(items.filter((item) => item.personId !== face.personId))
          }
        } catch (error) {
          if (!cancelled) {
            setSearchResults([])
            setErrorMessage(error instanceof Error ? error.message : '人物搜索失败')
          }
        } finally {
          if (!cancelled) {
            setIsLoadingSearch(false)
          }
        }
      })()
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [face, rootHandle, rootId, searchQuery])

  if (!face) return null

  const context = {
    rootHandle,
    rootId,
  }

  const runMutation = async (task: () => Promise<FaceMutationResult>) => {
    setIsSaving(true)
    setErrorMessage(null)
    try {
      const result = await task()
      if (result.failed > 0) {
        throw new Error(result.items.find((item) => !item.ok)?.error || '人物纠错失败')
      }
      await onMutationCommitted?.()
      onClose()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '人物纠错失败')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAssign = async (personId: string) => {
    await runMutation(async () => {
      return assignFaces(context, {
        faceIds: [face.faceId],
        targetPersonId: personId,
      })
    })
  }

  const handleCreatePerson = async () => {
    await runMutation(async () => {
      return createPersonFromFaces(context, {
        faceIds: [face.faceId],
        name: newPersonName,
      })
    })
  }

  const handleManualUnassign = async () => {
    await runMutation(async () => {
      return unassignFaces(context, {
        faceIds: [face.faceId],
      })
    })
  }

  const handleIgnore = async () => {
    await runMutation(async () => {
      return ignoreFaces(context, {
        faceIds: [face.faceId],
      })
    })
  }

  const handleRestore = async () => {
    await runMutation(async () => {
      return restoreIgnoredFaces(context, {
        faceIds: [face.faceId],
      })
    })
  }

  const handleRequeue = async () => {
    await runMutation(async () => {
      return requeueFaces(context, {
        faceIds: [face.faceId],
      })
    })
  }

  return (
    <div className="absolute right-4 top-14 z-20 w-[360px] max-w-[calc(100%-2rem)] rounded-md border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">人脸纠错</div>
          <div className="text-xs text-muted-foreground">{statusLabel(face.status)}</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          title="关闭"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 flex gap-3">
        <img
          src={buildGatewayFaceCropUrl(face.faceId, { size: 112, padding: 0.35 })}
          alt="face crop"
          className="h-24 w-24 rounded-md border border-border object-cover"
        />
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          <div className="truncate text-foreground">
            当前人物：{face.personId && face.personName ? face.personName : '未归属'}
          </div>
          <div className="truncate text-muted-foreground">
            路径：{face.assetPath || '未知路径'}
          </div>
          <div className="text-muted-foreground">
            置信度：{face.score.toFixed(2)}
          </div>
          {face.personId && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8"
              onClick={() => {
                onOpenPersonDetail?.(face.personId)
                onClose()
              }}
            >
              打开人物详情
            </Button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-muted-foreground">推荐人物</div>
        <div className="space-y-2">
          {isLoadingSuggestions && (
            <div className="text-xs text-muted-foreground">推荐加载中...</div>
          )}
          {!isLoadingSuggestions && suggestions.length === 0 && (
            <div className="text-xs text-muted-foreground">暂无推荐人物</div>
          )}
          {suggestions.map((item) => (
            <button
              key={item.personId}
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:bg-accent"
              disabled={isSaving}
              onClick={() => {
                void handleAssign(item.personId)
              }}
            >
              <div className="min-w-0">
                <div className="truncate text-sm">{displayPersonName(item)}</div>
                <div className="text-xs text-muted-foreground">
                  相似度 {item.score.toFixed(2)}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">归入</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          搜索人物
        </div>
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="输入人物名"
          disabled={isSaving}
        />
        {searchQuery.trim() && (
          <div className="mt-2 max-h-40 overflow-auto rounded-md border border-border">
            {isLoadingSearch && (
              <div className="px-3 py-2 text-xs text-muted-foreground">搜索中...</div>
            )}
            {!isLoadingSearch && searchResults.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">未找到匹配人物</div>
            )}
            {!isLoadingSearch && searchResults.map((item) => (
              <button
                key={item.personId}
                type="button"
                className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent"
                disabled={isSaving}
                onClick={() => {
                  void handleAssign(item.personId)
                }}
              >
                <span className="truncate text-sm">{displayPersonName(item)}</span>
                <span className="ml-3 text-xs text-muted-foreground">{item.globalFaceCount}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <UserPlus className="h-3.5 w-3.5" />
          新建人物
        </div>
        <div className="flex gap-2">
          <Input
            value={newPersonName}
            onChange={(event) => setNewPersonName(event.target.value)}
            placeholder="可留空"
            disabled={isSaving}
          />
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={isSaving}
            onClick={() => {
              void handleCreatePerson()
            }}
          >
            新建并归入
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {face.status === 'ignored' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => {
              void handleRestore()
            }}
          >
            恢复为未归属
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => {
              void handleManualUnassign()
            }}
          >
            移出为未归属
          </Button>
        )}

        {face.status === 'manual_unassigned' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => {
              void handleRequeue()
            }}
          >
            重新交给聚类
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving || face.status === 'ignored'}
            onClick={() => {
              void handleIgnore()
            }}
          >
            标记误检/忽略
          </Button>
        )}
      </div>
    </div>
  )
}
