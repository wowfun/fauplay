export interface ToolResultQueueConfig {
  maxItemsPerFile: number
  maxFiles: number
}

// -1 means unlimited.
export const toolResultQueueConfig: ToolResultQueueConfig = {
  maxItemsPerFile: 30,
  maxFiles: 10,
}

export function isUnlimited(limit: number): boolean {
  return limit < 0
}
