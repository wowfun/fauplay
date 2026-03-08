export interface ToolContinuousCallConfig {
  maxConcurrent: number
}

export const CONTINUOUS_CALL_OPTION_KEY = 'preview.continuousCall.enabled'

export const toolContinuousCallConfig: ToolContinuousCallConfig = {
  maxConcurrent: 2,
}

export function toEffectiveMaxContinuousConcurrent(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}
