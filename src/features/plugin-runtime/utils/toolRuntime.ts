import type { GatewayToolDescriptor, ToolActionAnnotation, ToolOptionAnnotation } from '@/lib/gateway'
import type { ToolWorkbenchOptionValue } from '@/features/plugin-runtime/types'

export function getVisibleToolActions(tool: GatewayToolDescriptor): ToolActionAnnotation[] {
  return tool.toolActions.filter((action) => action.visible !== false)
}

export function hasWorkbenchMetadata(tool: GatewayToolDescriptor): boolean {
  return tool.toolOptions.length > 0 || getVisibleToolActions(tool).length > 0
}

export function findToolOption(tool: GatewayToolDescriptor, optionKey: string): ToolOptionAnnotation | null {
  return tool.toolOptions.find((option) => option.key === optionKey) ?? null
}

export function resolveToolOptionValueFromDefinition(
  option: ToolOptionAnnotation,
  currentValue: ToolWorkbenchOptionValue | undefined
): ToolWorkbenchOptionValue | undefined {
  if (option.type === 'boolean') {
    if (typeof currentValue === 'boolean') return currentValue
    return typeof option.defaultValue === 'boolean' ? option.defaultValue : false
  }

  if (option.type === 'string') {
    if (typeof currentValue === 'string') return currentValue
    return typeof option.defaultValue === 'string' ? option.defaultValue : ''
  }

  const values = option.values ?? []
  if (typeof currentValue === 'string' && values.some((value) => value.value === currentValue)) {
    return currentValue
  }
  if (typeof option.defaultValue === 'string' && values.some((value) => value.value === option.defaultValue)) {
    return option.defaultValue
  }
  return values[0]?.value
}

export function resolveToolOptionValue(
  tool: GatewayToolDescriptor,
  optionKey: string,
  optionState: Record<string, ToolWorkbenchOptionValue> | undefined
): ToolWorkbenchOptionValue | undefined {
  const option = findToolOption(tool, optionKey)
  if (!option) return undefined
  return resolveToolOptionValueFromDefinition(option, optionState?.[optionKey])
}

export function isBooleanToolOptionEnabled(
  tool: GatewayToolDescriptor,
  optionKey: string,
  optionValuesByTool: Record<string, Record<string, ToolWorkbenchOptionValue>>
): boolean {
  const option = findToolOption(tool, optionKey)
  if (!option || option.type !== 'boolean') return false
  const value = resolveToolOptionValue(tool, optionKey, optionValuesByTool[tool.name])
  return value === true
}
