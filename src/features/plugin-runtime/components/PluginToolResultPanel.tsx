import { useCallback, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { stripProjectionFromResult, toToolScopedProjectionId } from '@/lib/projection'
import type { PluginResultQueueItem, PluginSurfaceVariant } from '@/features/plugin-runtime/types'
import { PluginResultStructuredView, type StructuredToolCallAction } from './PluginResultStructuredView'

interface PluginToolResultPanelProps {
  workbench?: ReactNode
  items: PluginResultQueueItem[]
  onToggleItemCollapsed: (id: string) => void
  surfaceVariant: PluginSurfaceVariant
  side?: 'left' | 'right'
  subzone?: string
  emptyHint?: string
  onResultAction?: (params: { item: PluginResultQueueItem; action: StructuredToolCallAction }) => void
  onActivateProjection?: (params: { item: PluginResultQueueItem }) => void
  onCancelItem?: (params: { item: PluginResultQueueItem }) => void
  activeProjectionId?: string | null
  panelWidthPx?: number
  minPanelWidthPx?: number
  maxPanelWidthPx?: number
  onPanelWidthChange?: (nextWidthPx: number) => void
}

const DEFAULT_PANEL_WIDTH_PX = 320

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatTimestamp(value?: number): string {
  if (!value) return '未执行'
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveResultOk(value: unknown): boolean | null {
  if (!isObject(value)) return null
  return typeof value.ok === 'boolean' ? value.ok : null
}

function resolveResultStatus(value: unknown): string | null {
  if (!isObject(value)) return null
  return typeof value.status === 'string' ? value.status : null
}

function resolveStatusLabel(item: PluginResultQueueItem): '运行中' | '成功' | '失败' | '已取消' {
  if (item.status === 'loading') return '运行中'

  if (resolveResultStatus(item.result) === 'canceled') {
    return '已取消'
  }

  const resultOk = resolveResultOk(item.result)
  if (typeof resultOk === 'boolean') {
    return resultOk ? '成功' : '失败'
  }

  return item.status === 'error' ? '失败' : '成功'
}

export function PluginToolResultPanel({
  workbench,
  items,
  onToggleItemCollapsed,
  surfaceVariant,
  side = 'left',
  subzone,
  emptyHint,
  onResultAction,
  onActivateProjection,
  onCancelItem,
  activeProjectionId = null,
  panelWidthPx = DEFAULT_PANEL_WIDTH_PX,
  minPanelWidthPx = DEFAULT_PANEL_WIDTH_PX,
  maxPanelWidthPx = DEFAULT_PANEL_WIDTH_PX,
  onPanelWidthChange,
}: PluginToolResultPanelProps) {
  const isLightbox = surfaceVariant === 'preview-lightbox'
  const minWidthPx = Math.max(1, minPanelWidthPx)
  const maxWidthPx = Math.max(minWidthPx, maxPanelWidthPx)
  const resolvedWidthPx = clamp(panelWidthPx, minWidthPx, maxWidthPx)
  const isResizable = typeof onPanelWidthChange === 'function' && maxWidthPx > minWidthPx
  const borderClass = side === 'left'
    ? (isLightbox ? 'border-r border-white/10' : 'border-r border-border')
    : (isLightbox ? 'border-l border-white/10' : 'border-l border-border')
  const backgroundClass = isLightbox ? 'bg-black/20 text-white' : 'bg-card'
  const emptyHintClassName = isLightbox
    ? 'rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs text-white/70'
    : 'rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground'
  const cardClassName = isLightbox
    ? 'rounded-md border border-white/20 bg-white/5'
    : 'rounded-md border border-border/80 bg-muted/20'
  const headerHoverClassName = isLightbox ? 'hover:bg-white/10' : 'hover:bg-accent/40'
  const statusClassName = isLightbox ? 'text-white/70' : 'text-muted-foreground'
  const resizeHandleClassName = side === 'left'
    ? 'absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 bg-transparent transition-colors z-20'
    : 'absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 bg-transparent transition-colors z-20'
  const projectionButtonClassName = isLightbox
    ? 'rounded-md border border-white/20 px-2 py-1 text-xs text-white transition-colors hover:bg-white/10'
    : 'rounded-md border border-border/80 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent/40'
  const progressTrackClassName = isLightbox ? 'bg-white/10' : 'bg-muted'
  const progressBarClassName = isLightbox ? 'bg-white/70' : 'bg-primary'
  const cancelButtonClassName = isLightbox
    ? 'rounded-md border border-white/20 px-2 py-1 text-xs text-white transition-colors hover:bg-white/10 disabled:opacity-50'
    : 'rounded-md border border-border/80 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50'

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isResizable || !onPanelWidthChange) return

    event.preventDefault()
    const startX = event.clientX
    const startWidthPx = resolvedWidthPx

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const signedDelta = side === 'right' ? -deltaX : deltaX
      const nextWidthPx = clamp(startWidthPx + signedDelta, minWidthPx, maxWidthPx)
      onPanelWidthChange(nextWidthPx)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [isResizable, maxWidthPx, minWidthPx, onPanelWidthChange, resolvedWidthPx, side])

  return (
    <aside
      className={`relative shrink-0 min-h-0 flex flex-col ${borderClass} ${backgroundClass}`}
      style={{ width: `${resolvedWidthPx}px` }}
      data-plugin-subzone={subzone ?? 'PluginToolResultPanel'}
    >
      {isResizable && (
        <div
          className={resizeHandleClassName}
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整工具面板宽度"
        />
      )}
      <div className="flex-1 min-h-0 flex flex-col">
        {workbench && (
          <div className="p-3 border-b border-inherit">
            {workbench}
          </div>
        )}
        {items.length > 0 ? (
          <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
            {items.map((item) => {
              const statusLabel = resolveStatusLabel(item)
              const headerText = `${item.title}: ${formatTimestamp(item.finishedAt ?? item.startedAt)} ${statusLabel}`
              const projection = item.projection
              const hasProjection = Boolean(projection && onActivateProjection)
              const isProjectionActive = projection
                ? toToolScopedProjectionId(item.toolName) === activeProjectionId
                : false

              return (
                <section key={item.id} className={cardClassName}>
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-2 transition-colors ${headerHoverClassName}`}
                    onClick={() => {
                      onToggleItemCollapsed(item.id)
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span className="pt-[2px]">
                        {item.collapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <p className="min-w-0 flex-1 text-xs font-medium break-all">{headerText}</p>
                    </div>
                  </button>

                  {!item.collapsed && (
                    <div className="border-t border-inherit px-3 py-2 space-y-2">
                      {hasProjection && projection && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={projectionButtonClassName}
                            onClick={() => {
                              onActivateProjection?.({ item })
                            }}
                          >
                            {isProjectionActive ? '结果标签中' : '打开结果标签'}
                          </button>
                          <span className={`text-xs ${statusClassName}`}>
                            {projection.title}
                          </span>
                        </div>
                      )}
                      {item.status === 'loading' ? (
                        item.progress ? (
                          <div className={`space-y-2 text-xs ${statusClassName}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                <span className="truncate">
                                  {item.progress.message || `${item.title} 执行中...`}
                                </span>
                              </div>
                              {(item.progress.cancelable || item.progress.cancelRequested) && onCancelItem && (
                                <button
                                  type="button"
                                  className={cancelButtonClassName}
                                  disabled={item.progress.cancelRequested === true}
                                  onClick={() => {
                                    onCancelItem({ item })
                                  }}
                                >
                                  {item.progress.cancelRequested ? '取消中' : '取消'}
                                </button>
                              )}
                            </div>
                            <div className={`h-1.5 overflow-hidden rounded-full ${progressTrackClassName}`}>
                              <div
                                className={`h-full rounded-full transition-all ${progressBarClassName}`}
                                style={{
                                  width: `${item.progress.total && item.progress.total > 0
                                    ? Math.min(100, Math.max(0, Math.round(((item.progress.current ?? 0) / item.progress.total) * 100)))
                                    : 0}%`,
                                }}
                              />
                            </div>
                            <p>
                              已处理 {item.progress.current ?? 0}/{item.progress.total ?? 0}
                              {typeof item.progress.batchIndex === 'number' && typeof item.progress.batchCount === 'number'
                                ? ` · 批次 ${item.progress.batchIndex}/${item.progress.batchCount}`
                                : ''}
                            </p>
                            {item.progress.currentPath && (
                              <p className="break-all">当前：{item.progress.currentPath}</p>
                            )}
                            <p>
                              扫描 {item.progress.scanned ?? 0} · 跳过 {item.progress.skipped ?? 0} · 失败 {item.progress.failed ?? 0} · 人脸 {item.progress.detectedFaces ?? 0}
                            </p>
                          </div>
                        ) : (
                          <div className={`flex items-center gap-2 text-xs ${statusClassName}`}>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>{item.title} 执行中...</span>
                          </div>
                        )
                      ) : item.status === 'error' ? (
                        <div className="text-xs space-y-1">
                          <p className="font-medium">执行失败</p>
                          <p className="break-all">{item.error || '未知错误'}</p>
                          {item.errorCode && <p>错误码: {item.errorCode}</p>}
                        </div>
                      ) : typeof item.result !== 'undefined' ? (
                        <PluginResultStructuredView
                          value={stripProjectionFromResult(item.result)}
                          surfaceVariant={surfaceVariant}
                          onAction={onResultAction
                            ? (action) => {
                              onResultAction({ item, action })
                            }
                            : undefined}
                        />
                      ) : (
                        <p className={`text-xs ${statusClassName}`}>工具未返回结果。</p>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        ) : (
          <div className="flex-1 p-3">
            <p className={emptyHintClassName}>
              {emptyHint ?? '点击工具按钮后，结果会显示在这里。'}
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
