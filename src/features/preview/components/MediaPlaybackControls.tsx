import { Button } from '@/ui/Button'
import { Select } from '@/ui/Select'
import type { PlaybackOrder } from '@/features/preview/types/playback'

interface MediaPlaybackControlsProps {
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
}

export function MediaPlaybackControls({
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onAutoPlayIntervalChange,
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
