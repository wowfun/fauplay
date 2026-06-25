interface ExplorerWorkspaceDeleteUndoNoticeProps {
  message: string | null
  tone: 'default' | 'error'
  canUndoDelete: boolean
  isUndoingDelete: boolean
  onUndoDelete: () => void
}

export function ExplorerWorkspaceDeleteUndoNotice({
  message,
  tone,
  canUndoDelete,
  isUndoingDelete,
  onUndoDelete,
}: ExplorerWorkspaceDeleteUndoNoticeProps) {
  if (!message) return null

  return (
    <div className="px-4 pb-2">
      <div
        className={
          tone === 'error'
            ? 'flex items-center justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive'
            : 'flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/60 px-3 py-2 text-sm text-foreground'
        }
      >
        <span className="truncate">{message}</span>
        {canUndoDelete && (
          <button
            type="button"
            className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onUndoDelete}
            disabled={isUndoingDelete}
          >
            {isUndoingDelete ? '恢复中...' : '撤销'}
          </button>
        )}
      </div>
    </div>
  )
}
