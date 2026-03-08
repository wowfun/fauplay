import { useEffect, useMemo, useState, type ComponentType } from 'react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { Button } from '@/ui/Button'
import { cn } from '@/lib/utils'
import type { PluginActionRailItem, PluginSurfaceVariant } from '@/features/plugin-runtime/types'

interface PluginActionRailProps {
  actions: PluginActionRailItem[]
  surfaceVariant: PluginSurfaceVariant
  side?: 'left' | 'right'
  subzone?: string
  onActionHoverChange?: (toolName: string) => void
}

type DynamicIconName = keyof typeof dynamicIconImports
type DynamicIconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

const iconComponentCache = new Map<DynamicIconName, DynamicIconComponent | 'failed'>()

function hasDynamicIconName(value: string): value is DynamicIconName {
  return Object.prototype.hasOwnProperty.call(dynamicIconImports, value)
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
}

function resolveDynamicIconName(iconName?: string): DynamicIconName | null {
  if (typeof iconName !== 'string') return null
  const trimmed = iconName.trim()
  if (!trimmed) return null

  if (hasDynamicIconName(trimmed)) return trimmed

  const kebab = toKebabCase(trimmed).replace(/^-+|-+$/g, '')
  if (hasDynamicIconName(kebab)) return kebab

  return null
}

function toToolNameAbbreviation(toolName: string): string {
  const letters = toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3)

  return letters || '?'
}

interface PluginActionGlyphProps {
  iconName?: string
  toolName: string
}

function PluginActionGlyph({ iconName, toolName }: PluginActionGlyphProps) {
  const fallback = useMemo(() => toToolNameAbbreviation(toolName), [toolName])
  const dynamicIconName = useMemo(() => resolveDynamicIconName(iconName), [iconName])
  const [iconComponent, setIconComponent] = useState<DynamicIconComponent | null>(() => {
    if (!dynamicIconName) return null
    const cached = iconComponentCache.get(dynamicIconName)
    return cached && cached !== 'failed' ? cached : null
  })
  const [loadFailed, setLoadFailed] = useState<boolean>(() => {
    if (!dynamicIconName) return false
    return iconComponentCache.get(dynamicIconName) === 'failed'
  })

  useEffect(() => {
    if (!dynamicIconName) {
      setIconComponent(null)
      setLoadFailed(false)
      return
    }

    const cached = iconComponentCache.get(dynamicIconName)
    if (cached === 'failed') {
      setIconComponent(null)
      setLoadFailed(true)
      return
    }

    if (cached) {
      setIconComponent(() => cached)
      setLoadFailed(false)
      return
    }

    let cancelled = false
    const loader = dynamicIconImports[dynamicIconName]

    void loader()
      .then((module) => {
        const loadedIcon = module?.default as DynamicIconComponent | undefined
        if (!loadedIcon) {
          throw new Error('Missing lucide icon module default export')
        }
        iconComponentCache.set(dynamicIconName, loadedIcon)
        if (cancelled) return
        setIconComponent(() => loadedIcon)
        setLoadFailed(false)
      })
      .catch(() => {
        iconComponentCache.set(dynamicIconName, 'failed')
        if (cancelled) return
        setIconComponent(null)
        setLoadFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [dynamicIconName])

  if (dynamicIconName && iconComponent && !loadFailed) {
    const Icon = iconComponent
    return <Icon className="w-4 h-4" aria-hidden />
  }

  return (
    <span className="text-[10px] font-semibold leading-none uppercase" aria-hidden="true">
      {fallback}
    </span>
  )
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
            <PluginActionGlyph iconName={action.iconName} toolName={action.toolName} />
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
