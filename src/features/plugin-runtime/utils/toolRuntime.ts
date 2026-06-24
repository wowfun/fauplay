import type {
  RuntimeToolActionAnnotation,
  RuntimeToolDescriptor,
  RuntimeToolOptionAnnotation,
} from '@/lib/runtimeApi'
import type { ToolWorkbenchOptionValue } from '@/features/plugin-runtime/types'

export function getVisibleToolActions(tool: RuntimeToolDescriptor): RuntimeToolActionAnnotation[] {
  return tool.toolActions.filter((action) => action.visible !== false)
}

export function hasWorkbenchMetadata(tool: RuntimeToolDescriptor): boolean {
  return tool.toolOptions.length > 0 || getVisibleToolActions(tool).length > 0
}

export function findToolOption(tool: RuntimeToolDescriptor, optionKey: string): RuntimeToolOptionAnnotation | null {
  return tool.toolOptions.find((option) => option.key === optionKey) ?? null
}

export function resolveToolOptionValueFromDefinition(
  option: RuntimeToolOptionAnnotation,
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
  tool: RuntimeToolDescriptor,
  optionKey: string,
  optionState: Record<string, ToolWorkbenchOptionValue> | undefined
): ToolWorkbenchOptionValue | undefined {
  const option = findToolOption(tool, optionKey)
  if (!option) return undefined
  return resolveToolOptionValueFromDefinition(option, optionState?.[optionKey])
}

export function isBooleanToolOptionEnabled(
  tool: RuntimeToolDescriptor,
  optionKey: string,
  optionValuesByTool: Record<string, Record<string, ToolWorkbenchOptionValue>>
): boolean {
  const option = findToolOption(tool, optionKey)
  if (!option || option.type !== 'boolean') return false
  const value = resolveToolOptionValue(tool, optionKey, optionValuesByTool[tool.name])
  return value === true
}
