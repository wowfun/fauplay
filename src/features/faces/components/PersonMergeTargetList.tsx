import { faceCountText } from '@/features/faces/lib/peoplePanelText'
import type { PersonScope, PersonSummary } from '@/features/faces/types'
import { GatewayFaceCropImage } from '@/features/faces/components/GatewayFaceCropImage'
import { getPersonDisplayName } from '@/features/faces/utils/personDisplayName'
import { cn } from '@/lib/utils'

interface PersonMergeTargetListProps {
  people: PersonSummary[]
  selectedPersonId: string
  scope: PersonScope
  disabled: boolean
  layout: 'compact' | 'wide'
  onSelectPerson: (personId: string) => void
}

export function PersonMergeTargetList({
  people,
  selectedPersonId,
  scope,
  disabled,
  layout,
  onSelectPerson,
}: PersonMergeTargetListProps) {
  return (
    <div
      className={cn(
        'overflow-auto rounded-md border border-border bg-background p-2',
        layout === 'compact' ? 'max-h-72' : 'max-h-56'
      )}
    >
      {people.length === 0 ? (
        <div className="px-2 py-4 text-sm text-muted-foreground">暂无可合并的目标人物</div>
      ) : (
        <div className={layout === 'compact' ? 'space-y-2' : 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2'}>
          {people.map((person) => {
            const isSelected = person.personId === selectedPersonId
            return (
              <button
                key={person.personId}
                type="button"
                className={cn(
                  'flex min-w-0 gap-3 rounded-md border p-2 text-left transition-colors',
                  layout === 'compact' && 'w-full',
                  isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/60'
                )}
                disabled={disabled}
                onClick={() => onSelectPerson(person.personId)}
              >
                {person.featureFaceId ? (
                  <GatewayFaceCropImage
                    faceId={person.featureFaceId}
                    size={layout === 'compact' ? 64 : 80}
                    padding={0.35}
                    alt={getPersonDisplayName(person)}
                    className="h-14 w-14 shrink-0 rounded-md border border-border object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
                    无代表脸
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{getPersonDisplayName(person)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{faceCountText(person, scope)}</div>
                  {person.featureAssetPath && (
                    <div className="mt-1 truncate text-xs text-muted-foreground" title={person.featureAssetPath}>
                      {person.featureAssetPath}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
