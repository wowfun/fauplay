import { FaceCropImage } from '@/features/faces/components/FaceCropImage'
import { faceCountText } from '@/features/faces/lib/peoplePanelText'
import type { PersonScope, PersonSummary } from '@/features/faces/types'
import { getPersonDisplayName } from '@/features/faces/utils/personDisplayName'

interface PeoplePanelPersonSummaryCardProps {
  person: PersonSummary | null
  scope: PersonScope
  layout: 'compact' | 'wide'
}

export function PeoplePanelPersonSummaryCard({
  person,
  scope,
  layout,
}: PeoplePanelPersonSummaryCardProps) {
  if (!person) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
        尚未选择人物
      </div>
    )
  }

  if (layout === 'wide') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">{getPersonDisplayName(person)}</div>
          <div className="text-sm text-muted-foreground">{faceCountText(person, scope)}</div>
        </div>
        {person.featureFaceId && (
          <FaceCropImage
            faceId={person.featureFaceId}
            size={112}
            padding={0.35}
            alt={getPersonDisplayName(person)}
            className="h-20 w-20 rounded-md border border-border object-cover"
          />
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        {person.featureFaceId ? (
          <FaceCropImage
            faceId={person.featureFaceId}
            size={88}
            padding={0.35}
            alt={getPersonDisplayName(person)}
            className="h-[88px] w-[88px] shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
            无代表脸
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{getPersonDisplayName(person)}</div>
          <div className="mt-1 text-sm text-muted-foreground">{faceCountText(person, scope)}</div>
          {person.featureAssetPath && (
            <div className="mt-2 truncate text-xs text-muted-foreground" title={person.featureAssetPath}>
              {person.featureAssetPath}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
