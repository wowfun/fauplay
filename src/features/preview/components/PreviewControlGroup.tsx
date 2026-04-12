import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react'
import { MediaPlaybackControls } from './MediaPlaybackControls'
import type { PlaybackOrder } from '@/features/preview/types/playback'
import { Button } from '@/ui/Button'

interface PreviewControlGroupProps {
  isFullscreen: boolean
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
}

export function PreviewControlGroup({
  isFullscreen,
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
  canNavigatePrev = false,
  canNavigateNext = false,
  onNavigatePrev,
  onNavigateNext,
  onClose,
}: PreviewControlGroupProps) {
  return (
    <div
      className="mt-2 flex flex-nowrap items-center gap-2 overflow-x-auto [&>*]:shrink-0"
      data-preview-subzone="PreviewControlGroup"
    >
      {showPlaybackControls && (
        <MediaPlaybackControls
          isVideoPreview={isVideoPreview}
          autoPlayEnabled={autoPlayEnabled}
          autoPlayIntervalSec={autoPlayIntervalSec}
          videoSeekStepSec={videoSeekStepSec}
          videoPlaybackRate={videoPlaybackRate}
          onToggleAutoPlay={onToggleAutoPlay}
          playbackOrder={playbackOrder}
          onTogglePlaybackOrder={onTogglePlaybackOrder}
          onAutoPlayIntervalChange={onAutoPlayIntervalChange}
          onVideoSeekStepChange={onVideoSeekStepChange}
          onVideoPlaybackRateChange={onVideoPlaybackRateChange}
        />
      )}
      {showFaceBboxToggle && (
        <Button
          onClick={onToggleFaceBboxVisible}
          variant={faceBboxVisible ? 'default' : 'accent'}
          size="sm"
          className="text-xs"
          aria-label={faceBboxVisible ? '隐藏人脸框' : '显示人脸框'}
          title={faceBboxVisible ? '隐藏人脸框' : '显示人脸框'}
        >
          {faceBboxVisible ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
          人脸框
        </Button>
      )}
      {showNavigationButtons && (
        <>
          <Button
            onClick={onNavigatePrev}
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={!canNavigatePrev}
            aria-label="上一项"
            title="上一项"
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            上一项
          </Button>
          <Button
            onClick={onNavigateNext}
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={!canNavigateNext}
            aria-label="下一项"
            title="下一项"
          >
            下一项
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </>
      )}
      <Button
        onClick={onClose}
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={isFullscreen ? '关闭全屏预览' : '关闭预览'}
        title={isFullscreen ? '关闭全屏预览' : '关闭预览'}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  )
}
