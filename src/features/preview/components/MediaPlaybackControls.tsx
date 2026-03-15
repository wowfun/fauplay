import { Button } from '@/ui/Button'
import { Select } from '@/ui/Select'
import type { PlaybackOrder } from '@/features/preview/types/playback'

interface MediaPlaybackControlsProps {
  isVideoPreview: boolean
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  videoSeekStepSec: number
  videoPlaybackRate: number
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoSeekStepChange: (sec: number) => void
  onVideoPlaybackRateChange: (rate: number) => void
}

export function MediaPlaybackControls({
  isVideoPreview,
  autoPlayEnabled,
  autoPlayIntervalSec,
  videoSeekStepSec,
  videoPlaybackRate,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onAutoPlayIntervalChange,
  onVideoSeekStepChange,
  onVideoPlaybackRateChange,
}: MediaPlaybackControlsProps) {
  return (
    <>
      <Button
        onClick={onTogglePlaybackOrder}
        variant="accent"
        size="sm"
        className={`text-xs ${
          playbackOrder === 'shuffle'
            ? 'bg-primary/15 text-primary hover:bg-primary/20'
            : 'bg-accent text-accent-foreground hover:bg-accent/80'
        }`}
        aria-label={playbackOrder === 'shuffle' ? '切换为顺序遍历' : '切换为随机遍历'}
        title={playbackOrder === 'shuffle' ? '切换为顺序遍历' : '切换为随机遍历'}
      >
        {playbackOrder === 'shuffle' ? '随机' : '顺序'}
      </Button>
      <Select
        value={autoPlayIntervalSec}
        onChange={(event) => onAutoPlayIntervalChange(Number(event.target.value))}
        className="h-8 text-xs"
        aria-label="自动播放速度（秒）"
        title="自动播放速度（秒）"
      >
        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
          <option key={value} value={value}>
            {value}s
          </option>
        ))}
      </Select>
      {isVideoPreview && (
        <Select
          value={videoSeekStepSec}
          onChange={(event) => onVideoSeekStepChange(Number(event.target.value))}
          className="h-8 text-xs"
          aria-label="视频快进步长（秒）"
          title="视频快进步长（秒）"
        >
          <option value={3}>步长 3s</option>
          <option value={5}>步长 5s</option>
          <option value={10}>步长 10s</option>
        </Select>
      )}
      {isVideoPreview && (
        <Select
          value={videoPlaybackRate}
          onChange={(event) => onVideoPlaybackRateChange(Number(event.target.value))}
          className="h-8 text-xs"
          aria-label="视频播放倍速"
          title="视频播放倍速"
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={3}>3x</option>
          <option value={5}>5x</option>
        </Select>
      )}
      <Button
        onClick={onToggleAutoPlay}
        variant={autoPlayEnabled ? 'default' : 'accent'}
        size="sm"
        className="text-xs"
        aria-label={autoPlayEnabled ? '暂停自动播放' : '开始自动播放'}
        title={autoPlayEnabled ? '暂停自动播放' : '开始自动播放'}
      >
        {autoPlayEnabled ? '暂停' : '自动播放'}
      </Button>
    </>
  )
}
