import { PreviewControlGroup } from './PreviewControlGroup'
import { PreviewTitleRow, type PreviewRenameResult } from './PreviewTitleRow'
import type { PlaybackOrder } from '@/features/preview/types/playback'

export interface PreviewHeaderAnnotationTag {
  fieldKey: string
  fieldLabel: string
  value: string
}

interface PreviewHeaderBarProps {
  fileName: string
  isFullscreen: boolean
  showPlaybackControls: boolean
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onClose: () => void
  canRenameFileName: boolean
  renameInFlight: boolean
  renameUnavailableReason?: string | null
  onSubmitFileNameRename: (nextBaseName: string) => Promise<PreviewRenameResult>
  annotationTags: PreviewHeaderAnnotationTag[]
}

export function PreviewHeaderBar({
  fileName,
  isFullscreen,
  showPlaybackControls,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onAutoPlayIntervalChange,
  onClose,
  canRenameFileName,
  renameInFlight,
  renameUnavailableReason,
  onSubmitFileNameRename,
  annotationTags,
}: PreviewHeaderBarProps) {
  const annotationTagClassName = isFullscreen
    ? 'border-white/25 bg-white/10 text-white/90'
    : 'border-border bg-muted/40 text-foreground'
  const annotationFieldClassName = isFullscreen ? 'text-white/70' : 'text-muted-foreground'

  return (
    <div
      className={`p-3 border-b flex-shrink-0 ${isFullscreen ? 'border-white/10' : 'border-border'}`}
      data-preview-subzone="PreviewHeaderBar"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <PreviewTitleRow
            fileName={fileName}
            canRename={canRenameFileName}
            renameInFlight={renameInFlight}
            renameUnavailableReason={renameUnavailableReason}
            onSubmitRename={onSubmitFileNameRename}
          />
        </div>
        {annotationTags.length > 0 && (
          <div className="max-w-[58%] shrink-0 overflow-x-auto">
            <div className="flex items-center justify-end gap-1 pl-1">
              {annotationTags.map((tag) => (
                <span
                  key={`${tag.fieldKey}:${tag.value}`}
                  className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-[11px] leading-none ${annotationTagClassName}`}
                  title={`${tag.fieldLabel}: ${tag.value}`}
                >
                  <span className={annotationFieldClassName}>{tag.fieldLabel}</span>
                  <span>{tag.value}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <PreviewControlGroup
        isFullscreen={isFullscreen}
        showPlaybackControls={showPlaybackControls}
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        onToggleAutoPlay={onToggleAutoPlay}
        playbackOrder={playbackOrder}
        onTogglePlaybackOrder={onTogglePlaybackOrder}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onClose={onClose}
      />
    </div>
  )
}
