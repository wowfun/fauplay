import type {
  AnnotationEnumField,
  AnnotationSchemaConfig,
} from '@/features/plugin-runtime/utils/annotationSchema'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

export interface AnnotationQuickTagValueButton {
  digit: string
  value: string
}

export function cloneAnnotationQuickTagDraftSchema(
  schema: AnnotationSchemaConfig
): AnnotationSchemaConfig {
  return {
    version: 1,
    defaultActiveFieldKey: schema.defaultActiveFieldKey,
    fields: schema.fields.map((field) => ({
      key: field.key,
      label: field.label,
      values: [...field.values],
    })),
  }
}

export function createEmptyAnnotationQuickTagDraftSchema(): AnnotationSchemaConfig {
  return {
    version: 1,
    fields: [],
  }
}

export function addAnnotationQuickTagDraftField(
  schema: AnnotationSchemaConfig
): AnnotationSchemaConfig {
  const next = cloneAnnotationQuickTagDraftSchema(schema)
  const nextIndex = next.fields.length + 1
  const defaultKey = `field${nextIndex}`
  next.fields.push({
    key: defaultKey,
    label: `字段 ${nextIndex}`,
    values: ['value1'],
  })
  if (!next.defaultActiveFieldKey) {
    next.defaultActiveFieldKey = defaultKey
  }
  return next
}

export function updateAnnotationQuickTagDraftField(
  schema: AnnotationSchemaConfig,
  fieldIndex: number,
  patch: Partial<Pick<AnnotationEnumField, 'key' | 'label'>>
): AnnotationSchemaConfig {
  return replaceFieldAt(schema, fieldIndex, (current) => {
    const nextField = {
      ...current,
      ...patch,
    }
    return nextField
  })
}

export function moveAnnotationQuickTagDraftField(
  schema: AnnotationSchemaConfig,
  fromIndex: number,
  toIndex: number
): AnnotationSchemaConfig {
  const next = cloneAnnotationQuickTagDraftSchema(schema)
  if (fromIndex < 0 || fromIndex >= next.fields.length || toIndex < 0 || toIndex >= next.fields.length) {
    return next
  }
  const [field] = next.fields.splice(fromIndex, 1)
  next.fields.splice(toIndex, 0, field)
  return next
}

export function removeAnnotationQuickTagDraftField(
  schema: AnnotationSchemaConfig,
  fieldIndex: number
): AnnotationSchemaConfig {
  const next = cloneAnnotationQuickTagDraftSchema(schema)
  const removed = next.fields[fieldIndex]
  if (!removed) return next
  next.fields.splice(fieldIndex, 1)
  if (next.defaultActiveFieldKey === removed.key) {
    next.defaultActiveFieldKey = next.fields[0]?.key
  }
  return next
}

export function addAnnotationQuickTagDraftValue(
  schema: AnnotationSchemaConfig,
  fieldIndex: number
): AnnotationSchemaConfig {
  return replaceFieldAt(schema, fieldIndex, (current) => ({
    ...current,
    values: [...current.values, `value${current.values.length + 1}`],
  }))
}

export function updateAnnotationQuickTagDraftValue(
  schema: AnnotationSchemaConfig,
  fieldIndex: number,
  valueIndex: number,
  value: string
): AnnotationSchemaConfig {
  return replaceFieldAt(schema, fieldIndex, (current) => {
    const nextValues = [...current.values]
    if (valueIndex < 0 || valueIndex >= nextValues.length) return current
    nextValues[valueIndex] = value
    return {
      ...current,
      values: nextValues,
    }
  })
}

export function moveAnnotationQuickTagDraftValue(
  schema: AnnotationSchemaConfig,
  fieldIndex: number,
  fromIndex: number,
  toIndex: number
): AnnotationSchemaConfig {
  return replaceFieldAt(schema, fieldIndex, (current) => ({
    ...current,
    values: moveValue(current.values, fromIndex, toIndex),
  }))
}

export function removeAnnotationQuickTagDraftValue(
  schema: AnnotationSchemaConfig,
  fieldIndex: number,
  valueIndex: number
): AnnotationSchemaConfig {
  return replaceFieldAt(schema, fieldIndex, (current) => ({
    ...current,
    values: current.values.filter((_, index) => index !== valueIndex),
  }))
}

export function resolveAnnotationQuickTagValueButtons(
  field: AnnotationEnumField | null
): AnnotationQuickTagValueButton[] {
  if (!field) return []
  return field.values.slice(0, DIGITS.length).map((value, index) => ({
    digit: DIGITS[index],
    value,
  }))
}

function replaceFieldAt(
  schema: AnnotationSchemaConfig,
  fieldIndex: number,
  updater: (current: AnnotationEnumField) => AnnotationEnumField
): AnnotationSchemaConfig {
  const next = cloneAnnotationQuickTagDraftSchema(schema)
  const current = next.fields[fieldIndex]
  if (!current) return next
  const updated = updater(current)
  next.fields[fieldIndex] = updated
  if (next.defaultActiveFieldKey === current.key && updated.key !== current.key) {
    next.defaultActiveFieldKey = updated.key
  }
  return next
}

function moveValue(values: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= values.length || toIndex < 0 || toIndex >= values.length) {
    return values
  }
  const next = [...values]
  const [value] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, value)
  return next
}
