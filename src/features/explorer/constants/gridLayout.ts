import type { ThumbnailSizePreset } from '@/types'

export const FILE_GRID_GAP = 16

export const FILE_GRID_CARD_SIZE_BY_PRESET: Record<ThumbnailSizePreset, { width: number; height: number }> = {
  auto: { width: 160, height: 180 },
  '256': { width: 256, height: 256 },
  '512': { width: 512, height: 512 },
}

export const TARGET_GRID_COLUMNS_AT_512_PRESET = 3

export function requiredGridWidthForColumns(columnCount: number, cardWidth: number): number {
  return columnCount * (cardWidth + FILE_GRID_GAP) - FILE_GRID_GAP
}
