import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Select'
import type { PluginSurfaceVariant } from '@/features/plugin-runtime/types'
import type { AnnotationSchemaConfig, AnnotationSchemaSource } from '@/features/plugin-runtime/utils/annotationSchema'
import {
  getAnnotationSchemaStoreVersion,
  getActiveField,
  loadGlobalAnnotationSchema,
  loadRootAnnotationSchema,
  normalizeAnnotationSchemaForSave,
  removeRootAnnotationSchema,
  resolveAnnotationSchema,
  saveGlobalAnnotationSchema,
  saveRootAnnotationSchema,
  subscribeAnnotationSchemaStore,
  withDefaultActiveField,
} from '@/features/plugin-runtime/utils/annotationSchema'

interface AnnotationQuickTagPanelProps {
  rootId?: string | null
  targetPath?: string | null
  surfaceVariant: PluginSurfaceVariant
  onSetValue: (params: {
    fieldKey: string
    value: string
    source: 'click'
  }) => void
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

function cloneSchema(schema: AnnotationSchemaConfig): AnnotationSchemaConfig {
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

function createEmptyDraftSchema(): AnnotationSchemaConfig {
  return {
    version: 1,
    fields: [],
  }
}

function addDraftField(schema: AnnotationSchemaConfig): AnnotationSchemaConfig {
  const next = cloneSchema(schema)
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

function replaceFieldAt(
  schema: AnnotationSchemaConfig,
  fieldIndex: number,
  updater: (current: AnnotationSchemaConfig['fields'][number]) => AnnotationSchemaConfig['fields'][number]
): AnnotationSchemaConfig {
  const next = cloneSchema(schema)
  const current = next.fields[fieldIndex]
  if (!current) return next
  next.fields[fieldIndex] = updater(current)
  return next
}

function moveField(schema: AnnotationSchemaConfig, fromIndex: number, toIndex: number): AnnotationSchemaConfig {
  const next = cloneSchema(schema)
  if (fromIndex < 0 || fromIndex >= next.fields.length || toIndex < 0 || toIndex >= next.fields.length) {
    return next
  }
  const [field] = next.fields.splice(fromIndex, 1)
  next.fields.splice(toIndex, 0, field)
  return next
}

function removeField(schema: AnnotationSchemaConfig, fieldIndex: number): AnnotationSchemaConfig {
  const next = cloneSchema(schema)
  const removed = next.fields[fieldIndex]
  if (!removed) return next
  next.fields.splice(fieldIndex, 1)
  if (next.defaultActiveFieldKey === removed.key) {
    next.defaultActiveFieldKey = next.fields[0]?.key
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

export function AnnotationQuickTagPanel({
  rootId,
  targetPath,
  surfaceVariant,
  onSetValue,
}: AnnotationQuickTagPanelProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editorScope, setEditorScope] = useState<AnnotationSchemaSource>('root')
  const [draftSchema, setDraftSchema] = useState<AnnotationSchemaConfig>(createEmptyDraftSchema)
  const schemaStoreVersion = useSyncExternalStore(
    subscribeAnnotationSchemaStore,
    getAnnotationSchemaStoreVersion,
    getAnnotationSchemaStoreVersion
  )
  const resolved = useMemo(() => {
    void schemaStoreVersion
    return resolveAnnotationSchema(rootId)
  }, [rootId, schemaStoreVersion])

  useEffect(() => {
    setIsEditorOpen(false)
  }, [rootId])

  const activeField = useMemo(() => getActiveField(resolved.schema), [resolved.schema])
  const valueButtons = useMemo(() => {
    if (!activeField) return []
    return activeField.values.slice(0, DIGITS.length).map((value, index) => ({
      digit: DIGITS[index],
      value,
    }))
  }, [activeField])

  const isLightbox = surfaceVariant === 'preview-lightbox'
  const containerClassName = isLightbox
    ? 'rounded-md border border-white/20 bg-white/5 p-2'
    : 'rounded-md border border-border bg-background/70 p-2'
  const mutedClassName = isLightbox ? 'text-white/70' : 'text-muted-foreground'

  const openEditor = () => {
    const defaultScope: AnnotationSchemaSource = rootId ? resolved.source : 'global'
    setEditorScope(defaultScope)
    if (defaultScope === 'global') {
      setDraftSchema(cloneSchema(loadGlobalAnnotationSchema()))
    } else {
      const rootSchema = rootId ? loadRootAnnotationSchema(rootId) : null
      setDraftSchema(cloneSchema(rootSchema ?? resolved.schema))
    }
    setIsEditorOpen(true)
  }

  const saveActiveFieldKey = (fieldKey: string) => {
    if (resolved.source === 'root' && rootId) {
      saveRootAnnotationSchema(rootId, withDefaultActiveField(resolved.schema, fieldKey))
      return
    }
    saveGlobalAnnotationSchema(withDefaultActiveField(resolved.schema, fieldKey))
  }

  const saveDraft = () => {
    const normalized = normalizeAnnotationSchemaForSave(draftSchema)
    if (editorScope === 'root' && rootId) {
      if (normalized.fields.length === 0) {
        removeRootAnnotationSchema(rootId)
      } else {
        saveRootAnnotationSchema(rootId, normalized)
      }
    } else {
      saveGlobalAnnotationSchema(normalized)
    }
    setIsEditorOpen(false)
  }

  const resetRootScope = () => {
    if (!rootId) return
    removeRootAnnotationSchema(rootId)
    setIsEditorOpen(false)
  }

  return (
    <section className={containerClassName}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">标注快捷打标</p>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={openEditor}>
          配置字段
        </Button>
      </div>

      <p className={`mt-1 text-[11px] ${mutedClassName}`}>
        当前作用域：{resolved.source === 'root' ? '当前目录配置' : '全局配置'}
      </p>

      {resolved.schema.fields.length === 0 ? (
        <p className={`mt-2 text-[11px] ${mutedClassName}`}>未配置字段，请先添加 enum 字段与值。</p>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <label htmlFor="annotation-active-field" className="text-xs whitespace-nowrap">激活字段</label>
            <Select
              id="annotation-active-field"
              value={activeField?.key ?? ''}
              className="h-8 text-xs"
              onChange={(event) => {
                saveActiveFieldKey(event.currentTarget.value)
              }}
            >
              {resolved.schema.fields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {valueButtons.map((item) => (
              <Button
                key={`${activeField?.key}-${item.digit}-${item.value}`}
                size="sm"
                variant="outline"
                className="h-8 justify-between text-xs"
                disabled={!targetPath}
                onClick={() => {
                  if (!activeField || !targetPath) return
                  onSetValue({
                    fieldKey: activeField.key,
                    value: item.value,
                    source: 'click',
                  })
                }}
              >
                <span className="truncate">{item.value}</span>
                <span className={mutedClassName}>{item.digit}</span>
              </Button>
            ))}
          </div>

          {!targetPath && (
            <p className={`text-[11px] ${mutedClassName}`}>当前无单文件上下文，仅可编辑配置。</p>
          )}
        </div>
      )}

      {isEditorOpen && (
        <div className="mt-3 space-y-3 rounded-md border border-border/80 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">字段配置</p>
            <div className="flex items-center gap-2">
              <Select
                value={editorScope}
                className="h-8 text-xs"
                onChange={(event) => {
                  const nextScope = event.currentTarget.value === 'root' ? 'root' : 'global'
                  setEditorScope(nextScope)
                  if (nextScope === 'global') {
                    setDraftSchema(cloneSchema(loadGlobalAnnotationSchema()))
                  } else if (rootId) {
                    const rootSchema = loadRootAnnotationSchema(rootId)
                    setDraftSchema(cloneSchema(rootSchema ?? resolved.schema))
                  }
                }}
              >
                <option value="global">全局配置</option>
                {rootId && (
                  <option value="root">当前目录配置</option>
                )}
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setDraftSchema((prev) => addDraftField(prev))
                }}
              >
                添加字段
              </Button>
            </div>
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {draftSchema.fields.map((field, fieldIndex) => (
              <div key={`field-${fieldIndex}`} className="space-y-2 rounded-md border border-border/80 p-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                    value={field.key}
                    placeholder="字段 key"
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setDraftSchema((prev) => replaceFieldAt(prev, fieldIndex, (current) => ({
                        ...current,
                        key: value,
                      })))
                    }}
                  />
                  <input
                    type="text"
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                    value={field.label}
                    placeholder="字段名称"
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setDraftSchema((prev) => replaceFieldAt(prev, fieldIndex, (current) => ({
                        ...current,
                        label: value,
                      })))
                    }}
                  />
                </div>

                <div className="space-y-1">
                  {field.values.map((value, valueIndex) => (
                    <div key={`field-${fieldIndex}-value-${valueIndex}`} className="flex items-center gap-1">
                      <input
                        type="text"
                        className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                        value={value}
                        placeholder="枚举值"
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value
                          setDraftSchema((prev) => replaceFieldAt(prev, fieldIndex, (current) => {
                            const nextValues = [...current.values]
                            nextValues[valueIndex] = nextValue
                            return {
                              ...current,
                              values: nextValues,
                            }
                          }))
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={valueIndex === 0}
                        onClick={() => {
                          setDraftSchema((prev) => replaceFieldAt(prev, fieldIndex, (current) => ({
                            ...current,
                            values: moveValue(current.values, valueIndex, valueIndex - 1),
                          })))
                        }}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={valueIndex >= field.values.length - 1}
                        onClick={() => {
                          setDraftSchema((prev) => replaceFieldAt(prev, fieldIndex, (current) => ({
                            ...current,
                            values: moveValue(current.values, valueIndex, valueIndex + 1),
                          })))
                        }}
                      >
                        ↓
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        onClick={() => {
                          setDraftSchema((prev) => replaceFieldAt(prev, fieldIndex, (current) => ({
                            ...current,
                            values: current.values.filter((_, index) => index !== valueIndex),
                          })))
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setDraftSchema((prev) => replaceFieldAt(prev, fieldIndex, (current) => ({
                        ...current,
                        values: [...current.values, `value${current.values.length + 1}`],
                      })))
                    }}
                  >
                    添加枚举值
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={fieldIndex === 0}
                      onClick={() => {
                        setDraftSchema((prev) => moveField(prev, fieldIndex, fieldIndex - 1))
                      }}
                    >
                      字段上移
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={fieldIndex >= draftSchema.fields.length - 1}
                      onClick={() => {
                        setDraftSchema((prev) => moveField(prev, fieldIndex, fieldIndex + 1))
                      }}
                    >
                      字段下移
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setDraftSchema((prev) => removeField(prev, fieldIndex))
                      }}
                    >
                      删除字段
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2">
            {rootId && (editorScope === 'root' || resolved.source === 'root') && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={resetRootScope}
              >
                重置当前目录覆盖
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => {
                setIsEditorOpen(false)
              }}
            >
              取消
            </Button>
            <Button size="sm" className="h-8 px-3 text-xs" onClick={saveDraft}>
              保存
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
