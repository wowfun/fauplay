export interface AnnotationEnumField {
  key: string
  label: string
  values: string[]
}

export interface AnnotationSchemaConfig {
  version: 1
  fields: AnnotationEnumField[]
  defaultActiveFieldKey?: string
}

export type AnnotationSchemaSource = 'global' | 'root'

export interface ResolvedAnnotationSchema {
  schema: AnnotationSchemaConfig
  source: AnnotationSchemaSource
}

const GLOBAL_SCHEMA_STORAGE_KEY = 'fauplay:annotation-schema:global:v1'
const ROOT_SCHEMA_STORAGE_KEY = 'fauplay:annotation-schema:roots:v1'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function createEmptySchema(): AnnotationSchemaConfig {
  return {
    version: 1,
    fields: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeField(input: unknown): AnnotationEnumField | null {
  if (!isRecord(input)) return null
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  const rawValues = Array.isArray(input.values) ? input.values : []
  const values = rawValues
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)

  if (!key || !label || values.length === 0) return null
  return {
    key,
    label,
    values: [...new Set(values)],
  }
}

function normalizeSchema(input: unknown): AnnotationSchemaConfig {
  if (!isRecord(input)) return createEmptySchema()
  const rawFields = Array.isArray(input.fields) ? input.fields : []
  const fields: AnnotationEnumField[] = []
  const keySet = new Set<string>()

  for (const rawField of rawFields) {
    const field = normalizeField(rawField)
    if (!field) continue
    if (keySet.has(field.key)) continue
    keySet.add(field.key)
    fields.push(field)
  }

  const defaultActiveFieldKey = (
    typeof input.defaultActiveFieldKey === 'string'
      && keySet.has(input.defaultActiveFieldKey)
  )
    ? input.defaultActiveFieldKey
    : undefined

  return {
    version: 1,
    fields,
    defaultActiveFieldKey,
  }
}

function parseJsonOrFallback<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readGlobalSchemaUnsafe(): AnnotationSchemaConfig {
  if (typeof window === 'undefined') return createEmptySchema()
  return normalizeSchema(parseJsonOrFallback(window.localStorage.getItem(GLOBAL_SCHEMA_STORAGE_KEY), {}))
}

function readRootSchemaMapUnsafe(): Record<string, AnnotationSchemaConfig> {
  if (typeof window === 'undefined') return {}
  const parsed = parseJsonOrFallback<Record<string, unknown>>(window.localStorage.getItem(ROOT_SCHEMA_STORAGE_KEY), {})
  if (!isRecord(parsed)) return {}

  const result: Record<string, AnnotationSchemaConfig> = {}
  for (const [rootId, value] of Object.entries(parsed)) {
    if (typeof rootId !== 'string' || !rootId) continue
    result[rootId] = normalizeSchema(value)
  }
  return result
}

function writeGlobalSchemaUnsafe(schema: AnnotationSchemaConfig) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(GLOBAL_SCHEMA_STORAGE_KEY, JSON.stringify(normalizeSchema(schema)))
}

function writeRootSchemaMapUnsafe(map: Record<string, AnnotationSchemaConfig>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ROOT_SCHEMA_STORAGE_KEY, JSON.stringify(map))
}

export function loadGlobalAnnotationSchema(): AnnotationSchemaConfig {
  return readGlobalSchemaUnsafe()
}

export function loadRootAnnotationSchema(rootId: string): AnnotationSchemaConfig | null {
  if (!rootId) return null
  const map = readRootSchemaMapUnsafe()
  return map[rootId] ?? null
}

export function saveGlobalAnnotationSchema(schema: AnnotationSchemaConfig) {
  writeGlobalSchemaUnsafe(schema)
}

export function saveRootAnnotationSchema(rootId: string, schema: AnnotationSchemaConfig) {
  if (!rootId) return
  const map = readRootSchemaMapUnsafe()
  map[rootId] = normalizeSchema(schema)
  writeRootSchemaMapUnsafe(map)
}

export function removeRootAnnotationSchema(rootId: string) {
  if (!rootId) return
  const map = readRootSchemaMapUnsafe()
  if (!map[rootId]) return
  delete map[rootId]
  writeRootSchemaMapUnsafe(map)
}

export function resolveAnnotationSchema(rootId?: string | null): ResolvedAnnotationSchema {
  if (rootId) {
    const rootSchema = loadRootAnnotationSchema(rootId)
    if (rootSchema) {
      return {
        schema: rootSchema,
        source: 'root',
      }
    }
  }

  return {
    schema: loadGlobalAnnotationSchema(),
    source: 'global',
  }
}

export function getActiveField(schema: AnnotationSchemaConfig): AnnotationEnumField | null {
  if (schema.fields.length === 0) return null
  if (schema.defaultActiveFieldKey) {
    const matched = schema.fields.find((item) => item.key === schema.defaultActiveFieldKey)
    if (matched) return matched
  }
  return schema.fields[0] ?? null
}

export function withDefaultActiveField(
  schema: AnnotationSchemaConfig,
  fieldKey: string
): AnnotationSchemaConfig {
  const normalized = normalizeSchema(schema)
  if (!normalized.fields.some((item) => item.key === fieldKey)) {
    return normalized
  }
  return {
    ...normalized,
    defaultActiveFieldKey: fieldKey,
  }
}

export function buildDigitValueMap(field: AnnotationEnumField | null): Record<string, string> {
  if (!field) return {}
  const result: Record<string, string> = {}
  for (let index = 0; index < Math.min(field.values.length, DIGITS.length); index += 1) {
    result[DIGITS[index]] = field.values[index]
  }
  return result
}

export function resolveActiveDigitAssignment(rootId?: string | null): { fieldKey: string; valueByDigit: Record<string, string> } | null {
  const { schema } = resolveAnnotationSchema(rootId)
  const field = getActiveField(schema)
  if (!field) return null
  const valueByDigit = buildDigitValueMap(field)
  if (Object.keys(valueByDigit).length === 0) return null
  return {
    fieldKey: field.key,
    valueByDigit,
  }
}

export function normalizeAnnotationSchemaForSave(schema: AnnotationSchemaConfig): AnnotationSchemaConfig {
  return normalizeSchema(schema)
}
