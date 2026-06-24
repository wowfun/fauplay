import type { PanelView } from '@/features/faces/lib/peoplePanelText'
import { cn } from '@/lib/utils'

interface PeoplePanelViewTabsProps {
  readonly: boolean
  view: PanelView
  layout: 'compact' | 'wide'
  onSwitchView: (view: PanelView) => void
}

const VIEW_TABS: Array<{ view: PanelView; label: string; readonlyVisible: boolean }> = [
  { view: 'people', label: '人物', readonlyVisible: true },
  { view: 'unassigned', label: '未归属', readonlyVisible: false },
  { view: 'ignored', label: '误检 / 忽略', readonlyVisible: false },
]

export function PeoplePanelViewTabs({
  readonly,
  view,
  layout,
  onSwitchView,
}: PeoplePanelViewTabsProps) {
  const visibleTabs = VIEW_TABS.filter((tab) => tab.readonlyVisible || !readonly)

  if (layout === 'compact') {
    return (
      <div className="border-b border-border px-3 py-2">
        <div className={cn('grid gap-2', readonly ? 'grid-cols-1' : 'grid-cols-3')}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.view}
              type="button"
              className={cn(
                'rounded-md px-3 py-2 text-left text-sm',
                view === tab.view ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
              )}
              onClick={() => onSwitchView(tab.view)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-border p-2">
      {visibleTabs.map((tab, index) => (
        <button
          key={tab.view}
          type="button"
          className={cn(
            index < visibleTabs.length - 1 && 'mb-1',
            'w-full rounded-md px-3 py-2 text-left text-sm',
            view === tab.view ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
          )}
          onClick={() => onSwitchView(tab.view)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
