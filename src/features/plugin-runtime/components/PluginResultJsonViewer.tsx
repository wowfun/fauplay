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

interface PluginResultJsonViewerProps {
  value: unknown
  title?: string
  surfaceVariant: 'preview-panel' | 'preview-lightbox' | 'workspace-grid'
}

export function PluginResultJsonViewer({
  value,
  title = 'JSON 结果',
  surfaceVariant,
}: PluginResultJsonViewerProps) {
  const formatted = stringifyJson(value)
  const isLightbox = surfaceVariant === 'preview-lightbox'
  const containerClassName = isLightbox
    ? 'rounded-md border border-white/20 bg-white/5'
    : 'rounded-md border border-border/80 bg-muted/20'
  const summaryClassName = isLightbox
    ? 'cursor-pointer px-3 py-2 text-xs text-white/70'
    : 'cursor-pointer px-3 py-2 text-xs text-muted-foreground'
  const preClassName = isLightbox
    ? 'max-h-64 overflow-auto border-t border-white/20 p-3 text-xs leading-5 text-white whitespace-pre-wrap break-all'
    : 'max-h-64 overflow-auto border-t border-border/60 p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-all'

  return (
    <details open className={containerClassName}>
      <summary className={summaryClassName}>
        {title}
      </summary>
      <pre className={preClassName}>
        {formatted}
      </pre>
    </details>
  )
}
