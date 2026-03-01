import { FolderOpen, Play } from 'lucide-react'
import { Button } from '@/ui/Button'

interface PreviewActionRailProps {
  canRevealInExplorer: boolean
  canOpenWithSystemPlayer: boolean
  isVideo: boolean
  isRevealing: boolean
  isOpening: boolean
  hasRootHandle: boolean
  onReveal: () => void
  onOpenWithSystemPlayer: () => void
  railButtonClass: string
  borderClass: string
  errorTextClass: string
  revealError: string | null
  openError: string | null
  revealActionState: 'default' | 'disabled' | 'loading' | 'error'
  openActionState: 'default' | 'disabled' | 'loading' | 'error'
}

export function PreviewActionRail({
  canRevealInExplorer,
  canOpenWithSystemPlayer,
  isVideo,
  isRevealing,
  isOpening,
  hasRootHandle,
  onReveal,
  onOpenWithSystemPlayer,
  railButtonClass,
  borderClass,
  errorTextClass,
  revealError,
  openError,
  revealActionState,
  openActionState,
}: PreviewActionRailProps) {
  return (
    <div
      className={`w-12 shrink-0 flex flex-col items-center gap-2 py-3 px-2 border-r ${borderClass}`}
      data-preview-subzone="PreviewActionRail"
    >
      {canRevealInExplorer && (
        <Button
          onClick={onReveal}
          disabled={isRevealing || !hasRootHandle}
          variant="ghost"
          size="icon"
          className={railButtonClass}
          aria-label="在文件资源管理器中显示"
          title="在文件资源管理器中显示"
          data-action-state={revealActionState}
        >
          <span className="sr-only">在文件资源管理器中显示</span>
          <FolderOpen className="w-4 h-4" aria-hidden="true" />
        </Button>
      )}
      {isVideo && canOpenWithSystemPlayer && (
        <Button
          onClick={onOpenWithSystemPlayer}
          disabled={isOpening || !hasRootHandle}
          variant="ghost"
          size="icon"
          className={railButtonClass}
          aria-label="用系统默认播放器打开"
          title="用系统默认播放器打开"
          data-action-state={openActionState}
        >
          <span className="sr-only">用系统默认播放器打开</span>
          <Play className="w-4 h-4" aria-hidden="true" />
        </Button>
      )}
      <div className={`mt-auto space-y-1 text-[10px] text-center ${errorTextClass}`} aria-live="polite">
        {openError && <p>{openError}</p>}
        {revealError && <p>{revealError}</p>}
      </div>
    </div>
  )
}
