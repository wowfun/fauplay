import type { PreviewFaceOverlayItem } from '@/features/faces/types'

interface PreviewFaceOverlayProps {
  items: PreviewFaceOverlayItem[]
  imageNaturalWidth: number | null
  imageNaturalHeight: number | null
  isFullscreen: boolean
  isLoading: boolean
  error: string | null
  onFaceClick?: (item: PreviewFaceOverlayItem) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toOverlayRectPercent(
  item: PreviewFaceOverlayItem,
  imageNaturalWidth: number,
  imageNaturalHeight: number
): { left: number; top: number; width: number; height: number } | null {
  const x1 = clamp(item.boundingBox.x1, 0, imageNaturalWidth)
  const y1 = clamp(item.boundingBox.y1, 0, imageNaturalHeight)
  const x2 = clamp(item.boundingBox.x2, 0, imageNaturalWidth)
  const y2 = clamp(item.boundingBox.y2, 0, imageNaturalHeight)
  const width = x2 - x1
  const height = y2 - y1

  if (width < 2 || height < 2) {
    return null
  }

  return {
    left: (x1 / imageNaturalWidth) * 100,
    top: (y1 / imageNaturalHeight) * 100,
    width: (width / imageNaturalWidth) * 100,
    height: (height / imageNaturalHeight) * 100,
  }
}

function scoreText(score: number): string {
  const clamped = clamp(score, 0, 1)
  return clamped.toFixed(2)
}

function statusText(item: PreviewFaceOverlayItem): string {
  if (item.personName) return item.personName
  if (item.status === 'manual_unassigned') return '人工未归属'
  if (item.status === 'deferred') return '待聚类'
  if (item.status === 'ignored') return '已忽略'
  return '未归属'
}

export function PreviewFaceOverlay({
  items,
  imageNaturalWidth,
  imageNaturalHeight,
  isFullscreen,
  isLoading,
  error,
  onFaceClick,
}: PreviewFaceOverlayProps) {
  if (!imageNaturalWidth || !imageNaturalHeight) {
    return null
  }

  const labelClassName = isFullscreen
    ? 'bg-black/70 text-white border-white/30'
    : 'bg-background/90 text-foreground border-border'
  const assignedClassName = isFullscreen
    ? 'border-emerald-300/90 bg-emerald-300/10'
    : 'border-emerald-500 bg-emerald-100/20'
  const manualUnassignedClassName = isFullscreen
    ? 'border-amber-300/90 bg-amber-300/10'
    : 'border-amber-500 bg-amber-100/20'
  const deferredClassName = isFullscreen
    ? 'border-sky-300/90 bg-sky-300/10'
    : 'border-sky-500 bg-sky-100/20'
  const ignoredClassName = isFullscreen
    ? 'border-slate-300/90 bg-slate-300/10'
    : 'border-slate-500 bg-slate-100/20'
  const unassignedClassName = isFullscreen
    ? 'border-orange-300/90 bg-orange-300/10'
    : 'border-orange-500 bg-orange-100/20'
  const hintClassName = isFullscreen ? 'bg-black/70 text-white/80' : 'bg-background/90 text-muted-foreground'
  const showHint = Boolean(error) || (isLoading && items.length === 0)

  return (
    <>
      <div className="absolute inset-0 pointer-events-none z-[2]">
        {items.map((item) => {
          const rect = toOverlayRectPercent(item, imageNaturalWidth, imageNaturalHeight)
          if (!rect) return null
          const boxClassName = item.status === 'assigned'
            ? assignedClassName
            : item.status === 'manual_unassigned'
              ? manualUnassignedClassName
              : item.status === 'deferred'
                ? deferredClassName
                : item.status === 'ignored'
                  ? ignoredClassName
                  : unassignedClassName
          return (
            <button
              key={item.faceId}
              type="button"
              data-preview-face-overlay-interactive="true"
              className={`pointer-events-auto absolute rounded border-2 ${boxClassName}`}
              style={{
                left: `${rect.left}%`,
                top: `${rect.top}%`,
                width: `${rect.width}%`,
                height: `${rect.height}%`,
              }}
              onClick={() => onFaceClick?.(item)}
              title={`${statusText(item)} (${scoreText(item.score)})`}
            >
              <span className={`pointer-events-none absolute left-0 top-0 inline-flex max-w-full items-center gap-1 truncate rounded-br px-1.5 py-0.5 text-[10px] border ${labelClassName}`}>
                <span className="truncate">{statusText(item)}</span>
                <span className="opacity-75">{scoreText(item.score)}</span>
              </span>
            </button>
          )
        })}
      </div>

      {showHint && (
        <div className="absolute left-3 bottom-3 z-[3] pointer-events-none">
          <div className={`rounded border px-2 py-1 text-[11px] ${hintClassName}`}>
            {error ? `人脸数据读取失败：${error}` : '人脸检测中...'}
          </div>
        </div>
      )}
    </>
  )
}
