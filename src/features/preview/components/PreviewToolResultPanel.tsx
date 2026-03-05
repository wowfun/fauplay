import { useMemo, useState } from 'react'
import { Loader2, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Button } from '@/ui/Button'
import { resolveToolResultRenderer } from './toolResultRenderers'

export interface PreviewToolResultItem {
  toolName: string
  title: string
  isLoading: boolean
  error: string | null
  errorCode?: string
  result?: unknown
  lastUpdatedAt?: number
}

interface PreviewToolResultPanelProps {
  items: PreviewToolResultItem[]
  activeToolName: string | null
  onSelectTool: (toolName: string) => void
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
  activeToolName,
  onSelectTool,
  isFullscreen = false,
}: PreviewToolResultPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const activeItem = useMemo(
    () => items.find((item) => item.toolName === activeToolName) ?? null,
    [activeToolName, items]
  )

  const panelClassName = isFullscreen
    ? 'border-r border-white/10 bg-black/20 text-white'
    : 'border-r border-border bg-card'
  const titleClassName = isFullscreen ? 'text-white' : 'text-foreground'
  const secondaryTextClassName = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const emptyHintClassName = isFullscreen
    ? 'rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs text-white/70'
    : 'rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground'
  const tabButtonClassName = isFullscreen
    ? 'h-7 justify-start rounded-md px-2 text-xs text-white/70 hover:bg-white/10'
    : 'h-7 justify-start rounded-md px-2 text-xs text-muted-foreground hover:bg-accent'
  const activeTabClassName = isFullscreen ? 'bg-white/15 text-white' : 'bg-accent text-accent-foreground'

  return (
    <aside
      className={`w-80 shrink-0 min-h-0 flex flex-col ${panelClassName}`}
      data-preview-subzone="PreviewToolResultPanel"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-inherit">
        <div>
          <p className={`text-xs font-medium ${titleClassName}`}>工具结果</p>
          <p className={`text-[11px] ${secondaryTextClassName}`}>当前文件最近执行结果</p>
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
            <>
              <div className="flex-shrink-0 max-h-24 overflow-auto border-b border-inherit p-2 space-y-1">
                {items.map((item) => (
                  <Button
                    key={item.toolName}
                    variant="ghost"
                    size="sm"
                    className={`${tabButtonClassName} w-full ${item.toolName === activeToolName ? activeTabClassName : ''}`}
                    onClick={() => {
                      onSelectTool(item.toolName)
                    }}
                  >
                    <span className="truncate">{item.title}</span>
                  </Button>
                ))}
              </div>

              <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
                {!activeItem ? (
                  <p className={emptyHintClassName}>请选择一个工具结果。</p>
                ) : activeItem.isLoading ? (
                  <div className={emptyHintClassName}>
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{activeItem.title} 执行中...</span>
                    </div>
                  </div>
                ) : activeItem.error ? (
                  <div className={emptyHintClassName}>
                    <p className="font-medium">执行失败</p>
                    <p className="mt-1 break-all">{activeItem.error}</p>
                    {activeItem.errorCode && (
                      <p className="mt-1">错误码: {activeItem.errorCode}</p>
                    )}
                    <p className="mt-1">时间: {formatTimestamp(activeItem.lastUpdatedAt)}</p>
                  </div>
                ) : typeof activeItem.result !== 'undefined' ? (
                  (() => {
                    const renderer = resolveToolResultRenderer({
                      toolName: activeItem.toolName,
                      result: activeItem.result,
                    })

                    return (
                      <>
                        <div className={emptyHintClassName}>
                          <p className="font-medium">{activeItem.title}</p>
                          <p className="mt-1 break-all">{renderer.renderSummary({
                            toolName: activeItem.toolName,
                            result: activeItem.result,
                          })}</p>
                          <p className="mt-1">时间: {formatTimestamp(activeItem.lastUpdatedAt)}</p>
                        </div>
                        {renderer.renderDetail({
                          toolName: activeItem.toolName,
                          result: activeItem.result,
                        })}
                      </>
                    )
                  })()
                ) : (
                  <p className={emptyHintClassName}>工具未返回结果。</p>
                )}
              </div>
            </>
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
