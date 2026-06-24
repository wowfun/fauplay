import { RefreshCw, Users, X } from 'lucide-react'
import type { PersonScope } from '@/features/faces/types'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'

interface PeoplePanelHeaderProps {
  readonly: boolean
  isCompact: boolean
  scope: PersonScope
  isLoading: boolean
  onScopeChange: (scope: PersonScope) => void
  onRefresh: () => void
  onClose: () => void
}

export function PeoplePanelHeader({
  readonly,
  isCompact,
  scope,
  isLoading,
  onScopeChange,
  onRefresh,
  onClose,
}: PeoplePanelHeaderProps) {
  return (
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
                onClick={() => onScopeChange('global')}
              >
                全局
              </button>
              <button
                type="button"
                className={cn(
                  'rounded px-2 py-1 text-xs',
                  scope === 'root' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                )}
                onClick={() => onScopeChange('root')}
              >
                当前 Root
              </button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1"
            disabled={isLoading}
            onClick={onRefresh}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            刷新
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="关闭">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
