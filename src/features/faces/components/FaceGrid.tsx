import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import type { FaceRecord } from '@/features/faces/types'
import { GatewayFaceCropImage } from '@/features/faces/components/GatewayFaceCropImage'
import { getLegacyAwarePersonDisplayName } from '@/features/faces/utils/personDisplayName'
import { GRID_SELECTABLE_ITEM_ATTR, useGridSelection } from '@/hooks/useGridSelection'
import { cn } from '@/lib/utils'

interface FaceGridProps {
  faces: FaceRecord[]
  selectedFaceIds: Set<string>
  onSelectionChange: (faceIds: string[]) => void
  onOpenFaceSource?: (face: FaceRecord) => boolean | Promise<boolean>
  compact?: boolean
}

function statusLabel(status: FaceRecord['status']): string {
  if (status === 'assigned') return '已归属'
  if (status === 'manual_unassigned') return '人工未归属'
  if (status === 'deferred') return '待聚类'
  if (status === 'ignored') return '已忽略'
  return '未归属'
}

function formatFrameTsMs(frameTsMs: number | null): string | null {
  if (typeof frameTsMs !== 'number' || !Number.isFinite(frameTsMs) || frameTsMs < 0) return null
  const totalSeconds = Math.floor(frameTsMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getFaceSelectionId(face: FaceRecord): string {
  return face.faceId
}

export function FaceGrid({
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
        const personText = face.personId
          ? getLegacyAwarePersonDisplayName({
            personId: face.personId,
            name: face.personName,
          })
          : '未归属'
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
