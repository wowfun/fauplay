import type { ReactNode } from 'react'
import { Button } from '@/ui/Button'
import { PluginResultJsonViewer } from './PluginResultJsonViewer'

type JsonObject = Record<string, unknown>

interface PluginResultStructuredViewProps {
  value: unknown
  surfaceVariant: 'preview-panel' | 'preview-lightbox' | 'workspace-grid'
  onAction?: (action: StructuredToolCallAction) => void
}

function isSimpleValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isObjectArray(value: unknown): value is JsonObject[] {
  return Array.isArray(value) && value.every((item) => isObject(item))
}

export interface StructuredToolCallAction {
  type: 'tool-call'
  label: string
  arguments?: Record<string, unknown>
  execution?: 'silent' | 'enqueue'
}

interface StructuredResultTable {
  columns?: string[]
  rows: JsonObject[]
}

function isStructuredToolCallAction(value: unknown): value is StructuredToolCallAction {
  if (!isObject(value)) return false
  if (value.type !== 'tool-call') return false
  if (typeof value.label !== 'string' || !value.label.trim()) return false
  if (typeof value.arguments !== 'undefined' && !isObject(value.arguments)) return false
  if (
    typeof value.execution !== 'undefined'
    && value.execution !== 'silent'
    && value.execution !== 'enqueue'
  ) {
    return false
  }
  return true
}

function isStructuredResultTable(value: unknown): value is StructuredResultTable {
  if (!isObject(value)) return false
  if (!Array.isArray(value.rows) || !value.rows.every((item) => isObject(item))) return false
  if (typeof value.columns === 'undefined') return true
  return Array.isArray(value.columns) && value.columns.every((item) => typeof item === 'string')
}

function formatSimpleValue(value: string | number | boolean | null): string {
  if (value === null) return 'null'
  return String(value)
}

function toCompactJson(value: unknown): string {
  if (typeof value === 'undefined') return 'undefined'
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === 'object' && current !== null) {
        if (seen.has(current)) {
          return '[Circular]'
        }
        seen.add(current)
      }
      return current
    }) ?? 'undefined'
  } catch {
    return '[Unserializable]'
  }
}

function collectTableColumns(rows: JsonObject[], preferredColumns?: string[]): string[] {
  if (Array.isArray(preferredColumns) && preferredColumns.length > 0) {
    return preferredColumns.filter((item, index, self) => (
      typeof item === 'string' && item && self.indexOf(item) === index
    ))
  }

  const columns = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === 'ok') continue
      columns.add(key)
    }
  }
  return [...columns].sort((a, b) => a.localeCompare(b))
}

function renderTableCell(
  value: unknown,
  onAction: ((action: StructuredToolCallAction) => void) | undefined
): ReactNode {
  if (isStructuredToolCallAction(value)) {
    if (!onAction) {
      return value.label
    }
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={() => {
          onAction(value)
        }}
      >
        {value.label}
      </Button>
    )
  }

  if (isSimpleValue(value)) {
    return formatSimpleValue(value)
  }
  return toCompactJson(value)
}

interface PluginResultRecordTableProps {
  rows: JsonObject[]
  columns?: string[]
  surfaceVariant: 'preview-panel' | 'preview-lightbox' | 'workspace-grid'
  onAction?: (action: StructuredToolCallAction) => void
}

function PluginResultRecordTable({ rows, columns: preferredColumns, surfaceVariant, onAction }: PluginResultRecordTableProps) {
  const columns = collectTableColumns(rows, preferredColumns)
  if (columns.length === 0) {
    return <PluginResultJsonViewer value={rows} title="JSON 兜底视图" surfaceVariant={surfaceVariant} />
  }

  const isLightbox = surfaceVariant === 'preview-lightbox'
  const tableBorderClassName = isLightbox
    ? 'overflow-hidden rounded-md border border-white/20'
    : 'overflow-hidden rounded-md border border-border/80'
  const theadClassName = isLightbox
    ? 'bg-white/10 text-white/70'
    : 'bg-muted/40 text-muted-foreground'
  const rowClassName = isLightbox
    ? 'border-t border-white/20'
    : 'border-t border-border/60'
  const cellClassName = isLightbox ? 'text-white' : 'text-foreground'

  return (
    <div className={tableBorderClassName}>
      <table className="w-full text-xs">
        <thead className={theadClassName}>
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 text-left font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`result-row-${rowIndex}`} className={rowClassName}>
              {columns.map((column) => (
                <td key={`${rowIndex}-${column}`} className={`px-3 py-2 break-all align-top ${cellClassName}`}>
                  {renderTableCell(row[column], onAction)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface PluginResultFieldsProps {
  value: JsonObject
  surfaceVariant: 'preview-panel' | 'preview-lightbox' | 'workspace-grid'
  onAction?: (action: StructuredToolCallAction) => void
}

function PluginResultFields({ value, surfaceVariant, onAction }: PluginResultFieldsProps) {
  const entries = Object.entries(value).filter(([key]) => key !== 'ok')
  const isLightbox = surfaceVariant === 'preview-lightbox'
  const keyClassName = isLightbox ? 'font-medium text-white' : 'font-medium text-foreground'
  const valueClassName = isLightbox ? 'text-white/80' : 'text-muted-foreground'
  const nestedBorderClassName = isLightbox ? 'ml-3 border-l border-white/20 pl-3' : 'ml-3 border-l border-border/70 pl-3'

  if (entries.length === 0) {
    return <p className={`text-xs ${valueClassName}`}>无可展示字段</p>
  }

  return (
    <div className="space-y-2 text-xs">
      {entries.map(([key, fieldValue]) => {
        if (isSimpleValue(fieldValue)) {
          return (
            <p key={key} className="break-all">
              <span className={keyClassName}>{key}:</span> <span className={valueClassName}>{formatSimpleValue(fieldValue)}</span>
            </p>
          )
        }

        if (isObject(fieldValue)) {
          if (isStructuredResultTable(fieldValue)) {
            return (
              <div key={key} className="space-y-1">
                <p className={keyClassName}>{key}:</p>
                <PluginResultRecordTable
                  rows={fieldValue.rows}
                  columns={fieldValue.columns}
                  surfaceVariant={surfaceVariant}
                  onAction={onAction}
                />
              </div>
            )
          }

          return (
            <div key={key} className="space-y-1">
              <p className={keyClassName}>{key}:</p>
              <div className={nestedBorderClassName}>
                <PluginResultFields value={fieldValue} surfaceVariant={surfaceVariant} onAction={onAction} />
              </div>
            </div>
          )
        }

        if (isObjectArray(fieldValue)) {
          return (
            <div key={key} className="space-y-1">
              <p className={keyClassName}>{key}:</p>
              <PluginResultRecordTable rows={fieldValue} surfaceVariant={surfaceVariant} onAction={onAction} />
            </div>
          )
        }

        return (
          <div key={key} className="space-y-1">
            <p className={keyClassName}>{key}:</p>
            <PluginResultJsonViewer value={fieldValue} title="JSON 兜底视图" surfaceVariant={surfaceVariant} />
          </div>
        )
      })}
    </div>
  )
}

export function PluginResultStructuredView({ value, surfaceVariant, onAction }: PluginResultStructuredViewProps) {
  if (isSimpleValue(value)) {
    const valueClassName = surfaceVariant === 'preview-lightbox' ? 'text-white/80' : 'text-muted-foreground'
    return <p className={`text-xs break-all ${valueClassName}`}>{formatSimpleValue(value)}</p>
  }

  if (isStructuredResultTable(value)) {
    return (
      <PluginResultRecordTable
        rows={value.rows}
        columns={value.columns}
        surfaceVariant={surfaceVariant}
        onAction={onAction}
      />
    )
  }

  if (isObject(value)) {
    return <PluginResultFields value={value} surfaceVariant={surfaceVariant} onAction={onAction} />
  }

  if (isObjectArray(value)) {
    return <PluginResultRecordTable rows={value} surfaceVariant={surfaceVariant} onAction={onAction} />
  }

  return <PluginResultJsonViewer value={value} title="JSON 兜底视图" surfaceVariant={surfaceVariant} />
}
