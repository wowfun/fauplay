function stringifyJson(value: unknown): string {
  if (typeof value === 'undefined') {
    return 'undefined'
  }

  const seen = new WeakSet<object>()
  return JSON.stringify(
    value,
    (_key, currentValue) => {
      if (typeof currentValue === 'object' && currentValue !== null) {
        if (seen.has(currentValue)) {
          return '[Circular]'
        }
        seen.add(currentValue)
      }
      return currentValue
    },
    2
  )
}

interface ToolResultJsonViewerProps {
  value: unknown
  title?: string
}

export function ToolResultJsonViewer({ value, title = 'JSON 结果' }: ToolResultJsonViewerProps) {
  const formatted = stringifyJson(value)

  return (
    <details open className="rounded-md border border-border/80 bg-muted/20">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
        {title}
      </summary>
      <pre className="max-h-64 overflow-auto border-t border-border/60 p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-all">
        {formatted}
      </pre>
    </details>
  )
}
