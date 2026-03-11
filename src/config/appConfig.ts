import rawAppConfig from '@/config/app.json'

export interface AppConfig {
  favorites: {
    maxItems: number
  }
}

const DEFAULT_FAVORITES_MAX_ITEMS = 100
const MIN_FAVORITES_MAX_ITEMS = 1
const MAX_FAVORITES_MAX_ITEMS = 1000

function toSafePositiveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback
  }
  return Math.min(Math.max(value, min), max)
}

export const appConfig: AppConfig = {
  favorites: {
    maxItems: toSafePositiveInteger(
      (rawAppConfig as Partial<AppConfig>)?.favorites?.maxItems,
      DEFAULT_FAVORITES_MAX_ITEMS,
      MIN_FAVORITES_MAX_ITEMS,
      MAX_FAVORITES_MAX_ITEMS
    ),
  },
}
