export type PlaybackOrder = 'sequential' | 'shuffle'

export type PlaybackState = 'stopped' | 'playing' | 'paused_by_visibility'

export type PreviewSurface = 'panel' | 'lightbox'

export interface AutoPlayConfig {
  enabled: boolean
  intervalSec: number
}

export interface ShuffleState {
  queue: string[]
  history: string[]
  cursor: number
}
