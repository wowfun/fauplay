import { FolderOpen, Play, Wrench } from 'lucide-react'
import { Button } from '@/ui/Button'
import { cn } from '@/lib/utils'
import type { PluginActionIcon, PluginActionRailItem, PluginSurfaceVariant } from '@/features/plugin-runtime/types'

interface PluginActionRailProps {
  actions: PluginActionRailItem[]
  surfaceVariant: PluginSurfaceVariant
  side?: 'left' | 'right'
  subzone?: string
  onActionHoverChange?: (toolName: string) => void
}

function getActionIcon(icon: PluginActionIcon) {
  if (icon === 'reveal') return FolderOpen
  if (icon === 'openDefault') return Play
  return Wrench
}

export function PluginActionRail({
  actions,
  surfaceVariant,
  side = 'left',
  subzone,
  onActionHoverChange,
}: PluginActionRailProps) {
  const actionErrors = actions.filter((action) => Boolean(action.error))
  const isLightbox = surfaceVariant === 'preview-lightbox'
  const borderClass = side === 'left'
    ? (isLightbox ? 'border-r border-white/10' : 'border-r border-border')
    : (isLightbox ? 'border-l border-white/10' : 'border-l border-border')
  const railButtonClass = isLightbox
    ? 'p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-50 text-white'
    : 'p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50'
  const highlightedRailButtonClass = isLightbox
    ? 'bg-white/20 ring-1 ring-white/60 translate-y-[1px]'
    : 'bg-accent/70 ring-1 ring-primary/60 translate-y-[1px]'
  const errorTextClass = isLightbox ? 'text-red-300' : 'text-destructive'

  return (
    <div
      className={`w-12 shrink-0 flex flex-col items-center gap-2 py-3 px-2 ${borderClass}`}
      data-plugin-subzone={subzone ?? 'PluginActionRail'}
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
