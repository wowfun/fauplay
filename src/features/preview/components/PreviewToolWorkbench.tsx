import type { GatewayToolDescriptor, ToolActionAnnotation, ToolOptionAnnotation } from '@/lib/gateway'
import type { ToolWorkbenchOptionValue } from '@/features/preview/types/toolWorkbench'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Select'

interface PreviewToolWorkbenchProps {
  tool: GatewayToolDescriptor | null
  optionValues?: Record<string, ToolWorkbenchOptionValue>
  onOptionChange: (toolName: string, optionKey: string, value: ToolWorkbenchOptionValue) => void
  onRunAction: (tool: GatewayToolDescriptor, action: ToolActionAnnotation) => void
  isFullscreen?: boolean
}

function resolveOptionValue(
  option: ToolOptionAnnotation,
  optionValues: Record<string, ToolWorkbenchOptionValue> | undefined
): ToolWorkbenchOptionValue {
  const currentValue = optionValues?.[option.key]

  if (option.type === 'boolean') {
    if (typeof currentValue === 'boolean') return currentValue
    return typeof option.defaultValue === 'boolean' ? option.defaultValue : false
  }

  const values = option.values ?? []
  if (typeof currentValue === 'string' && values.some((value) => value.value === currentValue)) {
    return currentValue
  }
  if (typeof option.defaultValue === 'string' && values.some((value) => value.value === option.defaultValue)) {
    return option.defaultValue
  }
  return values[0]?.value ?? ''
}

function toActionVariant(action: ToolActionAnnotation): 'default' | 'outline' | 'accent' {
  if (action.intent === 'primary') return 'default'
  if (action.intent === 'accent') return 'accent'
  return 'outline'
}

export function PreviewToolWorkbench({
  tool,
  optionValues,
  onOptionChange,
  onRunAction,
  isFullscreen = false,
}: PreviewToolWorkbenchProps) {
  if (!tool) return null

  const hasOptions = tool.toolOptions.length > 0
  const hasActions = tool.toolActions.length > 0
  if (!hasOptions && !hasActions) return null

  const containerClassName = isFullscreen
    ? 'rounded-md border border-white/20 bg-white/5'
    : 'rounded-md border border-border/80 bg-muted/20'
  const titleClassName = isFullscreen ? 'text-white' : 'text-foreground'
  const hintClassName = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const rowClassName = isFullscreen
    ? 'rounded-md border border-white/20 bg-white/5'
    : 'rounded-md border border-border bg-background/70'
  const checkboxClassName = isFullscreen
    ? 'h-4 w-4 rounded border-white/30 bg-black/20 text-white'
    : 'h-4 w-4 rounded border-border bg-background text-primary'

  return (
    <section className={`p-3 ${containerClassName}`} data-preview-subzone="PreviewToolWorkbench">
      <div className="mb-2">
        <p className={`text-xs font-medium ${titleClassName}`}>{tool.title} 工作台</p>
        <p className={`text-[11px] ${hintClassName}`}>支持工具选项与工具操作</p>
      </div>

      {hasOptions && (
        <div className="space-y-2">
          {tool.toolOptions.map((option) => {
            const optionId = `${tool.name}-${option.key}`
            const optionValue = resolveOptionValue(option, optionValues)
            return (
              <div key={option.key} className={`p-2 ${rowClassName}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <label htmlFor={optionId} className="text-xs font-medium">
                      {option.label}
                    </label>
                    {option.description && (
                      <p className={`mt-1 text-[11px] ${hintClassName}`}>{option.description}</p>
                    )}
                  </div>
                  {option.type === 'boolean' ? (
                    <input
                      id={optionId}
                      type="checkbox"
                      className={checkboxClassName}
                      checked={Boolean(optionValue)}
                      onChange={(event) => {
                        onOptionChange(tool.name, option.key, event.currentTarget.checked)
                      }}
                    />
                  ) : (
                    <Select
                      id={optionId}
                      value={typeof optionValue === 'string' ? optionValue : ''}
                      className="h-8 min-w-[120px] text-xs"
                      onChange={(event) => {
                        onOptionChange(tool.name, option.key, event.currentTarget.value)
                      }}
                    >
                      {(option.values ?? []).map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {hasActions && (
        <div className={hasOptions ? 'mt-3 space-y-2' : 'space-y-2'}>
          {tool.toolActions.map((action) => (
            <div key={action.key} className={`p-2 ${rowClassName}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{action.label}</p>
                  {action.description && (
                    <p className={`mt-1 text-[11px] ${hintClassName}`}>{action.description}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={toActionVariant(action)}
                  className="text-xs"
                  onClick={() => {
                    onRunAction(tool, action)
                  }}
                >
                  执行
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
