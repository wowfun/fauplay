import type {
  PluginResultQueueState,
  PluginWorkbenchState,
} from '../../plugin-runtime/types/index.ts'

export type SameDurationScope = 'global' | 'root'

export const SAME_DURATION_TOOL_NAME = 'media.searchSameDurationVideos'
export const SAME_DURATION_SCOPE_OPTION_KEY = 'search.scope'
export const DEFAULT_TOOL_PANEL_WIDTH_PX = 320
export const MIN_TOOL_PANEL_WIDTH_PX = 320
export const MAX_TOOL_PANEL_WIDTH_PX = 640

export function clampToolPanelWidthPx(value: number): number {
  return Math.min(MAX_TOOL_PANEL_WIDTH_PX, Math.max(MIN_TOOL_PANEL_WIDTH_PX, value))
}

export function createEmptyPluginResultQueueState(): PluginResultQueueState {
  return {
    byContextKey: {},
    contextOrder: [],
  }
}

export function createPluginWorkbenchState(
  sameDurationScope?: unknown,
): PluginWorkbenchState {
  if (sameDurationScope === 'global' || sameDurationScope === 'root') {
    return {
      activeToolName: null,
      optionValuesByTool: {
        [SAME_DURATION_TOOL_NAME]: {
          [SAME_DURATION_SCOPE_OPTION_KEY]: sameDurationScope,
        },
      },
    }
  }

  return {
    activeToolName: null,
    optionValuesByTool: {},
  }
}

export function readSameDurationScopeFromWorkbenchState(
  workbenchState: PluginWorkbenchState,
): SameDurationScope | null {
  const scopeValue = workbenchState.optionValuesByTool[SAME_DURATION_TOOL_NAME]?.[SAME_DURATION_SCOPE_OPTION_KEY]
  if (scopeValue === 'global' || scopeValue === 'root') {
    return scopeValue
  }
  return null
}
