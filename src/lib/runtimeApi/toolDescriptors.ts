export const DEFAULT_RUNTIME_TOOL_TIMEOUT_MS = 5000
export const ML_CLASSIFY_TOOL_TIMEOUT_MS = 120000
export const VIDEO_SAME_DURATION_TOOL_TIMEOUT_MS = 20000
export const LOCAL_DATA_TOOL_TIMEOUT_MS = 120000

export interface RuntimeToolDescriptor {
  name: string
  title: string
  mutation: boolean
  scopes: string[]
  iconName?: string
  toolOptions: RuntimeToolOptionAnnotation[]
  toolActions: RuntimeToolActionAnnotation[]
}

export interface RuntimeToolOptionEnumValue {
  value: string
  label: string
}

export type RuntimeToolOptionType = 'boolean' | 'enum' | 'string'

export interface RuntimeToolOptionAnnotation {
  key: string
  label: string
  type: RuntimeToolOptionType
  defaultValue?: boolean | string
  description?: string
  values?: RuntimeToolOptionEnumValue[]
  sendToTool?: boolean
  argumentKey?: string
}

export interface RuntimeToolActionAnnotation {
  key: string
  label: string
  description?: string
  intent?: string
  arguments?: Record<string, unknown>
  visible?: boolean
}

export interface RuntimeRawToolDescriptor {
  name?: string
  title?: string
  mutation?: boolean
  scopes?: unknown[]
  annotations?: Record<string, unknown> & {
    title?: string
    mutation?: boolean
    icon?: string
    scopes?: unknown[]
  }
}

export function parseRuntimeToolDescriptors(rawTools: unknown): RuntimeToolDescriptor[] {
  const tools = Array.isArray(rawTools) ? rawTools : []
  return tools
    .map((tool) => parseRuntimeToolDescriptor(tool))
    .filter((tool): tool is RuntimeToolDescriptor => tool !== null)
}

export function resolveRuntimeToolTimeoutMs(toolName: string, timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs
  }

  if (toolName.startsWith('ml.classify')) {
    return ML_CLASSIFY_TOOL_TIMEOUT_MS
  }

  if (toolName === 'media.searchSameDurationVideos') {
    return VIDEO_SAME_DURATION_TOOL_TIMEOUT_MS
  }

  if (toolName === 'local.data' || toolName === 'meta.annotation') {
    return LOCAL_DATA_TOOL_TIMEOUT_MS
  }

  return DEFAULT_RUNTIME_TOOL_TIMEOUT_MS
}

function parseRuntimeToolDescriptor(rawTool: unknown): RuntimeToolDescriptor | null {
  if (!isRecord(rawTool)) return null

  const tool = rawTool as RuntimeRawToolDescriptor
  const name = typeof tool.name === 'string' ? tool.name.trim() : ''
  if (!name) return null

  const title =
    typeof tool.title === 'string'
      ? tool.title
      : typeof tool.annotations?.title === 'string'
        ? tool.annotations.title
        : name

  const mutation =
    typeof tool.mutation === 'boolean'
      ? tool.mutation
      : tool.annotations?.mutation === true

  const scopes = Array.isArray(tool.scopes)
    ? tool.scopes.filter((scope): scope is string => typeof scope === 'string')
    : Array.isArray(tool.annotations?.scopes)
      ? tool.annotations.scopes.filter((scope): scope is string => typeof scope === 'string')
      : []

  const iconName = typeof tool.annotations?.icon === 'string' && tool.annotations.icon.trim()
    ? tool.annotations.icon.trim()
    : undefined

  return {
    name,
    title,
    mutation,
    scopes,
    ...(iconName ? { iconName } : {}),
    toolOptions: parseRuntimeToolOptionAnnotations(tool.annotations),
    toolActions: parseRuntimeToolActionAnnotations(tool.annotations),
  }
}

function parseRuntimeToolOptionAnnotations(
  annotations: RuntimeRawToolDescriptor['annotations'],
): RuntimeToolOptionAnnotation[] {
  const raw = annotations?.toolOptions
  if (!Array.isArray(raw)) return []

  const options: RuntimeToolOptionAnnotation[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue

    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const type = item.type
    const description = typeof item.description === 'string' ? item.description : undefined

    if (!key || !label) continue
    if (type !== 'boolean' && type !== 'enum' && type !== 'string') continue

    const common = {
      key,
      label,
      type,
      ...(typeof description === 'string' ? { description } : {}),
      sendToTool: item.sendToTool === true,
      ...(typeof item.argumentKey === 'string' && item.argumentKey.trim()
        ? { argumentKey: item.argumentKey.trim() }
        : {}),
    }

    if (type === 'boolean') {
      options.push({
        ...common,
        type,
        ...(typeof item.defaultValue === 'boolean' ? { defaultValue: item.defaultValue } : {}),
      })
      continue
    }

    if (type === 'string') {
      options.push({
        ...common,
        type,
        ...(typeof item.defaultValue === 'string' ? { defaultValue: item.defaultValue } : {}),
      })
      continue
    }

    const rawValues = Array.isArray(item.values) ? item.values : []
    const values = rawValues.flatMap((rawValue) => {
      if (!isRecord(rawValue)) return []
      const value = typeof rawValue.value === 'string' ? rawValue.value : ''
      const valueLabel = typeof rawValue.label === 'string' ? rawValue.label : ''
      if (!value || !valueLabel) return []
      return [{ value, label: valueLabel }]
    })

    if (values.length === 0) continue

    const defaultValue =
      typeof item.defaultValue === 'string' && values.some((value) => value.value === item.defaultValue)
        ? item.defaultValue
        : undefined

    options.push({
      ...common,
      type,
      values,
      ...(typeof defaultValue === 'string' ? { defaultValue } : {}),
    })
  }

  return options
}

function parseRuntimeToolActionAnnotations(
  annotations: RuntimeRawToolDescriptor['annotations'],
): RuntimeToolActionAnnotation[] {
  const raw = annotations?.toolActions
  if (!Array.isArray(raw)) return []

  const actions: RuntimeToolActionAnnotation[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    if (!key || !label) continue

    actions.push({
      key,
      label,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(typeof item.intent === 'string' ? { intent: item.intent } : {}),
      ...(isRecord(item.arguments) ? { arguments: item.arguments } : {}),
      ...(typeof item.visible === 'boolean' ? { visible: item.visible } : {}),
    })
  }

  return actions
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
