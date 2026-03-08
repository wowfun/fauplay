export type ToolWorkbenchOptionValue = boolean | string

export interface PreviewToolWorkbenchState {
  activeToolName: string | null
  optionValuesByTool: Record<string, Record<string, ToolWorkbenchOptionValue>>
}
