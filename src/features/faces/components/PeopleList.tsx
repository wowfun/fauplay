import { faceCountText } from '@/features/faces/lib/peoplePanelText'
import type { PersonScope, PersonSummary } from '@/features/faces/types'
import { FaceCropImage } from '@/features/faces/components/FaceCropImage'
import { getPersonDisplayName } from '@/features/faces/utils/personDisplayName'
import { cn } from '@/lib/utils'
import { Input } from '@/ui/Input'

interface PeopleListProps {
  people: PersonSummary[]
  query: string
  selectedPersonId: string | null
  scope: PersonScope
  loading: boolean
  layout: 'compact' | 'wide'
  onQueryChange: (query: string) => void
  onSelectPerson: (personId: string) => void
}

function PeopleListContent({
  people,
  selectedPersonId,
  scope,
  loading,
  layout,
  onSelectPerson,
}: Omit<PeopleListProps, 'query' | 'onQueryChange'>) {
  return (
    <>
      {loading && (
        <div
          className={cn(
            layout === 'compact'
              ? 'rounded-md border border-dashed border-border px-3 py-4'
              : 'px-2 py-3',
            'text-sm text-muted-foreground'
          )}
        >
          人物列表加载中...
        </div>
      )}
      {!loading && people.length === 0 && (
        <div
          className={cn(
            layout === 'compact'
              ? 'rounded-md border border-dashed border-border px-3 py-4'
              : 'px-2 py-3',
            'text-sm text-muted-foreground'
          )}
        >
          {layout === 'compact' ? '暂无人脸人物数据' : '暂无人物数据'}
        </div>
      )}
      {people.map((person) => {
        const isActive = person.personId === selectedPersonId
        if (layout === 'compact') {
          return (
            <button
              key={person.personId}
              type="button"
              className={cn(
                'flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
              )}
              onClick={() => onSelectPerson(person.personId)}
            >
              {person.featureFaceId ? (
                <FaceCropImage
                  faceId={person.featureFaceId}
                  size={72}
                  padding={0.35}
                  alt={getPersonDisplayName(person)}
                  className="h-[72px] w-[72px] shrink-0 rounded-lg border border-border object-cover"
                />
              ) : (
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
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
        }

        return (
          <button
            key={person.personId}
            type="button"
            className={cn(
              'mb-1 w-full rounded-md border px-3 py-2 text-left transition-colors',
              isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
            )}
            onClick={() => onSelectPerson(person.personId)}
          >
            <div className="truncate text-sm font-medium">{getPersonDisplayName(person)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{faceCountText(person, scope)}</div>
            {person.featureAssetPath && (
              <div className="mt-1 truncate text-xs text-muted-foreground" title={person.featureAssetPath}>
                {person.featureAssetPath}
              </div>
            )}
          </button>
        )
      })}
    </>
  )
}

export function PeopleList({
  people,
  query,
  selectedPersonId,
  scope,
  loading,
  layout,
  onQueryChange,
  onSelectPerson,
}: PeopleListProps) {
  if (layout === 'compact') {
    return (
      <div className="flex min-h-full flex-col gap-3">
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索人物名"
        />
        <div className="space-y-2">
          <PeopleListContent
            people={people}
            selectedPersonId={selectedPersonId}
            scope={scope}
            loading={loading}
            layout={layout}
            onSelectPerson={onSelectPerson}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100%-125px)] flex-col">
      <div className="border-b border-border p-2">
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索人物名"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <PeopleListContent
          people={people}
          selectedPersonId={selectedPersonId}
          scope={scope}
          loading={loading}
          layout={layout}
          onSelectPerson={onSelectPerson}
        />
      </div>
    </div>
  )
}
