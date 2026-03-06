import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { PreviewToolResultQueueItem } from '@/features/preview/types/toolResult'
import { Button } from '@/ui/Button'
import { resolveToolResultRenderer } from './toolResultRenderers'

interface PreviewToolResultPanelProps {
  items: PreviewToolResultQueueItem[]
  onToggleItemCollapsed: (id: string) => void
  isFullscreen?: boolean
}

function formatTimestamp(value?: number): string {
  if (!value) return '未执行'
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function PreviewToolResultPanel({
  items,
  onToggleItemCollapsed,
  isFullscreen = false,
}: PreviewToolResultPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  const panelClassName = isFullscreen
    ? 'border-r border-white/10 bg-black/20 text-white'
    : 'border-r border-border bg-card'
  const titleClassName = isFullscreen ? 'text-white' : 'text-foreground'
  const secondaryTextClassName = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const emptyHintClassName = isFullscreen
    ? 'rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs text-white/70'
    : 'rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground'
  const cardClassName = isFullscreen
    ? 'rounded-md border border-white/20 bg-white/5'
    : 'rounded-md border border-border/80 bg-muted/20'
  const headerHoverClassName = isFullscreen ? 'hover:bg-white/10' : 'hover:bg-accent/40'
  const statusClassName = isFullscreen ? 'text-white/70' : 'text-muted-foreground'

  return (
    <aside
      className={`w-80 shrink-0 min-h-0 flex flex-col ${panelClassName}`}
      data-preview-subzone="PreviewToolResultPanel"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-inherit">
        <div>
          <p className={`text-xs font-medium ${titleClassName}`}>工具结果</p>
          <p className={`text-[11px] ${secondaryTextClassName}`}>当前文件调用队列（最新在上）</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={isFullscreen ? 'text-white hover:bg-white/10' : ''}
          aria-label={collapsed ? '展开结果面板' : '收起结果面板'}
          title={collapsed ? '展开结果面板' : '收起结果面板'}
          onClick={() => {
            setCollapsed((prev) => !prev)
          }}
        >
          {collapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 flex flex-col">
          {items.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
              {items.map((item) => {
                const renderer = typeof item.result === 'undefined'
                  ? null
                  : resolveToolResultRenderer({
                      toolName: item.toolName,
                      result: item.result,
                    })
                const summaryText = item.status === 'loading'
                  ? '执行中...'
                  : item.status === 'error'
                    ? (item.error || '执行失败')
                    : renderer
                      ? renderer.renderSummary({
                          toolName: item.toolName,
                          result: item.result,
                        })
                      : '工具未返回结果'

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
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{item.title}</p>
                          <p className={`mt-1 text-[11px] ${statusClassName}`}>
                            {item.status === 'loading'
                              ? '运行中'
                              : item.status === 'error'
                                ? '失败'
                                : '成功'} · {formatTimestamp(item.finishedAt ?? item.startedAt)}
                          </p>
                          <p className="mt-1 text-[11px] break-all">{summaryText}</p>
                        </div>
                      </div>
                    </button>

                    {!item.collapsed && (
                      <div className="border-t border-inherit px-3 py-2 space-y-2">
                        {item.status === 'loading' ? (
                          <div className={`flex items-center gap-2 text-xs ${statusClassName}`}>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>{item.title} 执行中...</span>
                          </div>
                        ) : item.status === 'error' ? (
                          <div className="text-xs space-y-1">
                            <p className="font-medium">执行失败</p>
                            <p className="break-all">{item.error || '未知错误'}</p>
                            {item.errorCode && <p>错误码: {item.errorCode}</p>}
                          </div>
                        ) : typeof item.result !== 'undefined' && renderer ? (
                          renderer.renderDetail({
                            toolName: item.toolName,
                            result: item.result,
                          })
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
                点击左侧工具按钮后，结果会显示在这里。
              </p>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
