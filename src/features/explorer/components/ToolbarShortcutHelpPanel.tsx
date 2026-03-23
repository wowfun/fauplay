import type { ShortcutHelpEntry, ShortcutHelpGroup, ShortcutHelpStatusKind } from '@/features/explorer/hooks/useShortcutHelpEntries'
import { cn } from '@/lib/utils'

interface ToolbarShortcutHelpPanelProps {
  entries: ShortcutHelpEntry[]
}

const GROUP_ORDER: ShortcutHelpGroup[] = ['app', 'grid', 'preview', 'tag']

const GROUP_LABELS: Record<ShortcutHelpGroup, string> = {
  app: 'App',
  grid: 'Grid',
  preview: 'Preview',
  tag: 'Tag',
}

const GROUP_EMPTY_HINTS: Record<ShortcutHelpGroup, string> = {
  app: '暂无 App 快捷键',
  grid: '暂无 Grid 快捷键',
  preview: '暂无 Preview 快捷键',
  tag: '未配置动态标签快捷键',
}

function statusLabel(statusKind: ShortcutHelpStatusKind): string {
  if (statusKind === 'available') return '可用'
  if (statusKind === 'unbound') return '未配置'
  return '当前不可用'
}

function statusClassName(statusKind: ShortcutHelpStatusKind): string {
  if (statusKind === 'available') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
  }
  if (statusKind === 'unbound') {
    return 'border-border bg-muted/60 text-muted-foreground'
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700'
}

export function ToolbarShortcutHelpPanel({ entries }: ToolbarShortcutHelpPanelProps) {
  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-[30rem] max-w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border bg-background p-3 shadow-xl">
      <div className="mb-3">
        <div className="text-sm font-semibold text-foreground">当前快捷键</div>
        <div className="text-xs text-muted-foreground">
          展示当前运行时生效的绑定与可用状态。
        </div>
      </div>

      <div className="max-h-[min(70vh,42rem)] space-y-3 overflow-y-auto pr-1">
        {GROUP_ORDER.map((group) => {
          const groupEntries = entries.filter((entry) => entry.group === group)
          return (
            <section key={group} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {GROUP_LABELS[group]}
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {groupEntries.length}
                </span>
              </div>

              {groupEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  {GROUP_EMPTY_HINTS[group]}
                </div>
              ) : (
                <div className="space-y-2">
                  {groupEntries.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-lg border border-border/80 bg-card/70 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground" title={entry.label}>
                            {entry.label}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {entry.statusText}
                          </div>
                        </div>

                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            statusClassName(entry.statusKind)
                          )}
                        >
                          {statusLabel(entry.statusKind)}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {entry.bindings.length > 0 ? (
                          entry.bindings.map((binding) => (
                            <span
                              key={`${entry.id}:${binding}`}
                              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                            >
                              {binding}
                            </span>
                          ))
                        ) : (
                          <span className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
                            未配置
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
