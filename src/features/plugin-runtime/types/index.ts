export type PluginResultStatus = 'loading' | 'success' | 'error'
export type PluginResultTrigger = 'manual' | 'continuous'
export type ToolWorkbenchOptionValue = boolean | string
export type PluginActionState = 'default' | 'disabled' | 'loading' | 'error'
export type PluginActionIcon = 'reveal' | 'openDefault' | 'default'

export interface PluginResultQueueItem {
  id: string
  contextKey: string
  toolName: string
  title: string
  trigger: PluginResultTrigger
  actionKey?: string
  requestSignature?: string
  status: PluginResultStatus
  result?: unknown
  error?: string
  errorCode?: string
  startedAt: number
  finishedAt?: number
  collapsed: boolean
}

export interface PluginResultQueueState {
  byContextKey: Record<string, PluginResultQueueItem[]>
  contextOrder: string[]
}

export interface PluginWorkbenchState {
  activeToolName: string | null
  optionValuesByTool: Record<string, Record<string, ToolWorkbenchOptionValue>>
}

export type PluginScope = 'file' | 'workspace'
export type PluginSurfaceVariant = 'preview-panel' | 'preview-lightbox' | 'workspace-grid'

export interface PluginActionRailItem {
  toolName: string
  title: string
  onClick: () => void
  disabled: boolean
  actionState: PluginActionState
  error: string | null
  icon: PluginActionIcon
  highlighted?: boolean
}

export type PluginToolCallOutcome = 'executed' | 'skipped'
