import { ToolResultJsonViewer } from './ToolResultJsonViewer'

type JsonObject = Record<string, unknown>

interface ToolResultStructuredViewProps {
  value: unknown
  isFullscreen?: boolean
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

function collectTableColumns(rows: JsonObject[]): string[] {
  const columns = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === 'ok') continue
      columns.add(key)
    }
  }
  return [...columns].sort((a, b) => a.localeCompare(b))
}

function renderTableCell(value: unknown): string {
  if (isSimpleValue(value)) {
    return formatSimpleValue(value)
  }
  return toCompactJson(value)
}

interface ToolResultRecordTableProps {
  rows: JsonObject[]
  isFullscreen: boolean
}

function ToolResultRecordTable({ rows, isFullscreen }: ToolResultRecordTableProps) {
  const columns = collectTableColumns(rows)
  if (columns.length === 0) {
    return <ToolResultJsonViewer value={rows} title="JSON 兜底视图" isFullscreen={isFullscreen} />
  }

  const tableBorderClassName = isFullscreen
    ? 'overflow-hidden rounded-md border border-white/20'
    : 'overflow-hidden rounded-md border border-border/80'
  const theadClassName = isFullscreen
    ? 'bg-white/10 text-white/70'
    : 'bg-muted/40 text-muted-foreground'
  const rowClassName = isFullscreen
    ? 'border-t border-white/20'
    : 'border-t border-border/60'
  const cellClassName = isFullscreen ? 'text-white' : 'text-foreground'

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
                  {renderTableCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ToolResultFieldsProps {
  value: JsonObject
  isFullscreen: boolean
}

function ToolResultFields({ value, isFullscreen }: ToolResultFieldsProps) {
  const entries = Object.entries(value).filter(([key]) => key !== 'ok')
  const keyClassName = isFullscreen ? 'font-medium text-white' : 'font-medium text-foreground'
  const valueClassName = isFullscreen ? 'text-white/80' : 'text-muted-foreground'
  const nestedBorderClassName = isFullscreen ? 'ml-3 border-l border-white/20 pl-3' : 'ml-3 border-l border-border/70 pl-3'

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
          return (
            <div key={key} className="space-y-1">
              <p className={keyClassName}>{key}:</p>
              <div className={nestedBorderClassName}>
                <ToolResultFields value={fieldValue} isFullscreen={isFullscreen} />
              </div>
            </div>
          )
        }

        if (isObjectArray(fieldValue)) {
          return (
            <div key={key} className="space-y-1">
              <p className={keyClassName}>{key}:</p>
              <ToolResultRecordTable rows={fieldValue} isFullscreen={isFullscreen} />
            </div>
          )
        }

        return (
          <div key={key} className="space-y-1">
            <p className={keyClassName}>{key}:</p>
            <ToolResultJsonViewer value={fieldValue} title="JSON 兜底视图" isFullscreen={isFullscreen} />
          </div>
        )
      })}
    </div>
  )
}

export function ToolResultStructuredView({ value, isFullscreen = false }: ToolResultStructuredViewProps) {
  if (isSimpleValue(value)) {
    const valueClassName = isFullscreen ? 'text-white/80' : 'text-muted-foreground'
    return <p className={`text-xs break-all ${valueClassName}`}>{formatSimpleValue(value)}</p>
  }

  if (isObject(value)) {
    return <ToolResultFields value={value} isFullscreen={isFullscreen} />
  }

  if (isObjectArray(value)) {
    return <ToolResultRecordTable rows={value} isFullscreen={isFullscreen} />
  }

  return <ToolResultJsonViewer value={value} title="JSON 兜底视图" isFullscreen={isFullscreen} />
}
