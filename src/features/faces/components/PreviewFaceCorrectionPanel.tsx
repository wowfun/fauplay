import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  assignFaces,
  createPersonFromFaces,
  ignoreFaces,
  requeueFaces,
  restoreIgnoredFaces,
  suggestPeople,
  unassignFaces,
} from '@/features/faces/api'
import type { FaceMutationResult, PersonSuggestion, PreviewFaceOverlayItem } from '@/features/faces/types'
import { GatewayFaceCropImage } from '@/features/faces/components/GatewayFaceCropImage'
import { PersonAssignmentInput } from '@/features/faces/components/PersonAssignmentInput'
import { getLegacyAwarePersonDisplayName, getPersonDisplayName } from '@/features/faces/utils/personDisplayName'
import { Button } from '@/ui/Button'

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

export function PreviewFaceCorrectionPanel({
  face,
  rootHandle,
  rootId,
  onClose,
  onMutationCommitted,
  onOpenPersonDetail,
}: PreviewFaceCorrectionPanelProps) {
  const [suggestions, setSuggestions] = useState<PersonSuggestion[]>([])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const context = useMemo(() => ({
    rootHandle,
    rootId,
  }), [rootHandle, rootId])

  useEffect(() => {
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

  if (!face) return null

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
      return true
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '人物纠错失败')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleAssign = async (personId: string) => {
    return runMutation(async () => {
      return assignFaces(context, {
        faceIds: [face.faceId],
        targetPersonId: personId,
      })
    })
  }

  const handleCreatePerson = async (name: string) => {
    return runMutation(async () => {
      return createPersonFromFaces(context, {
        faceIds: [face.faceId],
        name,
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
        <GatewayFaceCropImage
          faceId={face.faceId}
          size={112}
          padding={0.35}
          alt="face crop"
          className="h-24 w-24 rounded-md border border-border object-cover"
        />
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          <div className="truncate text-foreground">
            当前人物：{face.personId
              ? getLegacyAwarePersonDisplayName({
                personId: face.personId,
                name: face.personName,
              })
              : '未归属'}
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
                <div className="truncate text-sm">{getPersonDisplayName(item)}</div>
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
        <div className="mb-2 text-xs font-medium text-muted-foreground">归属到人物</div>
        <PersonAssignmentInput
          key={face.faceId}
          context={context}
          scope="global"
          disabled={isSaving}
          excludedPersonIds={face.personId ? [face.personId] : []}
          onAssign={handleAssign}
          onCreate={handleCreatePerson}
        />
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
