import { FolderOpen, Play, Wrench } from 'lucide-react'
import { Button } from '@/ui/Button'
import { cn } from '@/lib/utils'

export type PreviewActionState = 'default' | 'disabled' | 'loading' | 'error'
export type PreviewActionIcon = 'reveal' | 'openDefault' | 'default'

export interface PreviewActionRailItem {
  toolName: string
  title: string
  onClick: () => void
  disabled: boolean
  actionState: PreviewActionState
  error: string | null
  icon: PreviewActionIcon
  highlighted?: boolean
}

interface PreviewActionRailProps {
  actions: PreviewActionRailItem[]
  railButtonClass: string
  highlightedRailButtonClass: string
  borderClass: string
  errorTextClass: string
  onActionHoverChange?: (toolName: string) => void
}

function getActionIcon(icon: PreviewActionIcon) {
  if (icon === 'reveal') return FolderOpen
  if (icon === 'openDefault') return Play
  return Wrench
}

export function PreviewActionRail({
  actions,
  railButtonClass,
  highlightedRailButtonClass,
  borderClass,
  errorTextClass,
  onActionHoverChange,
}: PreviewActionRailProps) {
  const actionErrors = actions.filter((action) => !!action.error)

  return (
    <div
      className={`w-12 shrink-0 flex flex-col items-center gap-2 py-3 px-2 border-r ${borderClass}`}
      data-preview-subzone="PreviewActionRail"
    >
      {actions.map((action) => {
        const Icon = getActionIcon(action.icon)
        return (
          <Button
            key={action.toolName}
            onClick={action.onClick}
            disabled={action.disabled}
            variant="ghost"
            size="icon"
            className={cn(railButtonClass, action.highlighted && highlightedRailButtonClass)}
            aria-label={action.title}
            title={action.title}
            data-action-state={action.actionState}
            onMouseEnter={() => {
              onActionHoverChange?.(action.toolName)
            }}
            onFocus={() => {
              onActionHoverChange?.(action.toolName)
            }}
          >
            <span className="sr-only">{action.title}</span>
            <Icon className="w-4 h-4" aria-hidden="true" />
          </Button>
        )
      })}
      <div className={`mt-auto space-y-1 text-[10px] text-center ${errorTextClass}`} aria-live="polite">
        {actionErrors.map((action) => (
          <p key={`${action.toolName}-error`}>{action.error}</p>
        ))}
      </div>
    </div>
  )
}
