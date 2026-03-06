export type PreviewToolResultStatus = 'loading' | 'success' | 'error'

export interface PreviewToolResultQueueItem {
  id: string
  filePath: string
  toolName: string
  title: string
  status: PreviewToolResultStatus
  result?: unknown
  error?: string
  errorCode?: string
  startedAt: number
  finishedAt?: number
  collapsed: boolean
}

export interface PreviewToolResultQueueState {
  byFilePath: Record<string, PreviewToolResultQueueItem[]>
  fileOrder: string[]
}
