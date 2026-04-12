import { PreviewControlGroup } from './PreviewControlGroup'
import { PreviewHeaderTagManager } from './PreviewHeaderTagManager'
import { PreviewTitleRow, type PreviewRenameResult } from './PreviewTitleRow'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import type { AnnotationFilterTagOption } from '@/types'

export interface PreviewHeaderAnnotationTag {
  tagKey: string
  key: string
  value: string
  sources: string[]
  hasMetaAnnotation: boolean
  representativeSource: string
}

interface PreviewHeaderBarProps {
  fileName: string
  isFullscreen: boolean
  titleMode?: 'actionable' | 'static'
  showUnavailableReasons?: boolean
  showPlaybackControls: boolean
  showNavigationButtons?: boolean
  isVideoPreview: boolean
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  videoSeekStepSec: number
  videoPlaybackRate: number
  showFaceBboxToggle: boolean
  faceBboxVisible: boolean
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onToggleFaceBboxVisible: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoSeekStepChange: (sec: number) => void
  onVideoPlaybackRateChange: (rate: number) => void
  canNavigatePrev?: boolean
  canNavigateNext?: boolean
  onNavigatePrev?: () => void
  onNavigateNext?: () => void
  onClose: () => void
  canRenameFileName: boolean
  renameInFlight: boolean
  renameUnavailableReason?: string | null
  onSubmitFileNameRename: (nextBaseName: string) => Promise<PreviewRenameResult>
  annotationTags: PreviewHeaderAnnotationTag[]
  canManageAnnotationTags: boolean
  annotationTagManageUnavailableReason?: string | null
  annotationTagOptions: AnnotationFilterTagOption[]
  annotationTagOptionsStatus: 'idle' | 'loading' | 'ready'
  annotationTagOptionsError?: string | null
  onRequestAnnotationTagOptions: () => void
  onBindAnnotationTag: (params: { key: string; value: string }) => Promise<void>
  onUnbindAnnotationTag: (tag: PreviewHeaderAnnotationTag) => Promise<void>
  enableOpenAnnotationTagByShortcut?: boolean
  rootId?: string | null
  relativePath?: string | null
}

export function PreviewHeaderBar({
  fileName,
  isFullscreen,
  titleMode = 'actionable',
  showUnavailableReasons = true,
  showPlaybackControls,
  showNavigationButtons = false,
  isVideoPreview,
  autoPlayEnabled,
  autoPlayIntervalSec,
  videoSeekStepSec,
  videoPlaybackRate,
  showFaceBboxToggle,
  faceBboxVisible,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onToggleFaceBboxVisible,
  onAutoPlayIntervalChange,
  onVideoSeekStepChange,
  onVideoPlaybackRateChange,
  canNavigatePrev,
  canNavigateNext,
  onNavigatePrev,
  onNavigateNext,
  onClose,
  canRenameFileName,
  renameInFlight,
  renameUnavailableReason,
  onSubmitFileNameRename,
  annotationTags,
  canManageAnnotationTags,
  annotationTagManageUnavailableReason,
  annotationTagOptions,
  annotationTagOptionsStatus,
  annotationTagOptionsError,
  onRequestAnnotationTagOptions,
  onBindAnnotationTag,
  onUnbindAnnotationTag,
  enableOpenAnnotationTagByShortcut = false,
  rootId,
  relativePath,
}: PreviewHeaderBarProps) {
  return (
    <div
      className={`p-3 border-b flex-shrink-0 ${isFullscreen ? 'border-white/10' : 'border-border'}`}
      data-preview-subzone="PreviewHeaderBar"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <PreviewTitleRow
            fileName={fileName}
            titleMode={titleMode}
            canRename={canRenameFileName}
            renameInFlight={renameInFlight}
            renameUnavailableReason={renameUnavailableReason}
            onSubmitRename={onSubmitFileNameRename}
          />
        </div>
        <PreviewHeaderTagManager
          isFullscreen={isFullscreen}
          tags={annotationTags}
          canManageTags={canManageAnnotationTags}
          manageUnavailableReason={annotationTagManageUnavailableReason}
          showUnavailableReasons={showUnavailableReasons}
          tagOptions={annotationTagOptions}
          tagOptionsStatus={annotationTagOptionsStatus}
          tagOptionsError={annotationTagOptionsError}
          onRequestTagOptions={onRequestAnnotationTagOptions}
          onBindTag={onBindAnnotationTag}
          onUnbindTag={onUnbindAnnotationTag}
          enableOpenByShortcut={enableOpenAnnotationTagByShortcut}
          rootId={rootId}
          relativePath={relativePath}
        />
      </div>
      <PreviewControlGroup
        isFullscreen={isFullscreen}
        showPlaybackControls={showPlaybackControls}
        showNavigationButtons={showNavigationButtons}
        isVideoPreview={isVideoPreview}
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        videoSeekStepSec={videoSeekStepSec}
        videoPlaybackRate={videoPlaybackRate}
        showFaceBboxToggle={showFaceBboxToggle}
        faceBboxVisible={faceBboxVisible}
        onToggleAutoPlay={onToggleAutoPlay}
        playbackOrder={playbackOrder}
        onTogglePlaybackOrder={onTogglePlaybackOrder}
        onToggleFaceBboxVisible={onToggleFaceBboxVisible}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onVideoSeekStepChange={onVideoSeekStepChange}
        onVideoPlaybackRateChange={onVideoPlaybackRateChange}
        canNavigatePrev={canNavigatePrev}
        canNavigateNext={canNavigateNext}
        onNavigatePrev={onNavigatePrev}
        onNavigateNext={onNavigateNext}
        onClose={onClose}
      />
    </div>
  )
}
