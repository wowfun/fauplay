import type { NoticeTone } from '@/features/faces/lib/peoplePanelText'
import { cn } from '@/lib/utils'

interface PeoplePanelNoticeProps {
  isCompact: boolean
  notice: { tone: NoticeTone; message: string } | null
}

export function PeoplePanelNotice({ isCompact, notice }: PeoplePanelNoticeProps) {
  if (!notice) return null

  return (
    <div
      className={cn(
        isCompact ? 'mx-3 mt-3' : 'mx-4 mt-3',
        'rounded-md px-3 py-2 text-sm',
        notice.tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'
      )}
    >
      {notice.message}
    </div>
  )
}
