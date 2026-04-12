import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useKeyboardShortcuts } from '@/config/shortcutStore'
import { useResolvedPreviewTagShortcuts } from '@/features/preview/hooks/useResolvedPreviewTagShortcuts'
import { isTypingTarget, matchesAnyShortcut } from '@/lib/keyboard'
import type { AnnotationFilterTagOption } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import type { PreviewHeaderAnnotationTag } from './PreviewHeaderBar'

interface PreviewHeaderTagManagerProps {
  isFullscreen: boolean
  tags: PreviewHeaderAnnotationTag[]
  canManageTags: boolean
  manageUnavailableReason?: string | null
  showUnavailableReasons?: boolean
  tagOptions: AnnotationFilterTagOption[]
  tagOptionsStatus: 'idle' | 'loading' | 'ready'
  tagOptionsError?: string | null
  onRequestTagOptions: () => void
  onBindTag: (params: { key: string; value: string }) => Promise<void>
  onUnbindTag: (tag: PreviewHeaderAnnotationTag) => Promise<void>
  enableOpenByShortcut?: boolean
  rootId?: string | null
  relativePath?: string | null
}

function buildSourceSummary(representativeSource: string, sources: string[]): string {
  if (!representativeSource) return ''
  const extraCount = Math.max(0, sources.length - 1)
  return extraCount > 0 ? `${representativeSource} + ${extraCount}` : representativeSource
}

function formatMutationError(action: 'bind' | 'unbind', error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return action === 'bind' ? '标签绑定失败' : '标签删除失败'
}

function optionMatchesQuery(option: AnnotationFilterTagOption, query: string): boolean {
  if (!query) return true
  const normalizedQuery = query.toLocaleLowerCase()
  const haystack = [
    option.key,
    option.value,
    option.representativeSource,
    option.sources.join(' '),
  ]
    .join(' ')
    .toLocaleLowerCase()
  return haystack.includes(normalizedQuery)
}

export function PreviewHeaderTagManager({
  isFullscreen,
  tags,
  canManageTags,
  manageUnavailableReason,
  showUnavailableReasons = true,
  tagOptions,
  tagOptionsStatus,
  tagOptionsError,
  onRequestTagOptions,
  onBindTag,
  onUnbindTag,
  enableOpenByShortcut = false,
  rootId,
  relativePath,
}: PreviewHeaderTagManagerProps) {
  const keyboardShortcuts = useKeyboardShortcuts()
  const { getMatchingPreviewTagShortcut } = useResolvedPreviewTagShortcuts({
    rootId,
    relativePath,
    enabled: enableOpenByShortcut && canManageTags,
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [draftValue, setDraftValue] = useState('')
  const [activeOptionIndex, setActiveOptionIndex] = useState(0)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [pendingTagKey, setPendingTagKey] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'bind' | 'unbind' | null>(null)

  const currentTagByKey = useMemo(
    () => new Map(tags.map((tag) => [tag.tagKey, tag])),
    [tags]
  )

  const filteredOptions = useMemo(() => {
    return tagOptions.filter((option) => {
      const currentTag = currentTagByKey.get(option.tagKey)
      if (currentTag?.hasMetaAnnotation) {
        return false
      }
      return optionMatchesQuery(option, draftValue.trim())
    })
  }, [currentTagByKey, draftValue, tagOptions])

  const closeEditor = useCallback(() => {
    setIsEditorOpen(false)
    setDraftValue('')
    setActiveOptionIndex(0)
  }, [])

  const handleOpenEditor = useCallback(() => {
    if (!canManageTags || pendingAction) return
    setMutationError(null)
    setDraftValue('')
    setActiveOptionIndex(0)
    setIsEditorOpen(true)
    onRequestTagOptions()
  }, [canManageTags, onRequestTagOptions, pendingAction])

  useEffect(() => {
    if (!isEditorOpen) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditorOpen])

  useEffect(() => {
    if (!isEditorOpen) return
    setActiveOptionIndex((currentIndex) => {
      if (filteredOptions.length === 0) return 0
      return Math.min(currentIndex, filteredOptions.length - 1)
    })
  }, [filteredOptions, isEditorOpen])

  useEffect(() => {
    if (!isEditorOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (containerRef.current?.contains(target)) return
      setIsEditorOpen(false)
      setDraftValue('')
      setActiveOptionIndex(0)
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [closeEditor, isEditorOpen])

  useEffect(() => {
    if (!enableOpenByShortcut) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.repeat) return
      if (isTypingTarget(event.target)) return
      if (!canManageTags || pendingAction) return
      if (getMatchingPreviewTagShortcut(event)) return
      if (!matchesAnyShortcut(event, keyboardShortcuts.preview.openAnnotationTagEditor)) return

      event.preventDefault()
      handleOpenEditor()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canManageTags, enableOpenByShortcut, getMatchingPreviewTagShortcut, handleOpenEditor, keyboardShortcuts, pendingAction])

  const chipClassName = isFullscreen
    ? 'border-white/25 bg-white/10 text-white/90'
    : 'border-border bg-muted/40 text-foreground'
  const keyClassName = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const popupClassName = isFullscreen
    ? 'border-white/15 bg-background/95 text-foreground shadow-2xl'
    : 'border-border bg-background text-foreground shadow-lg'

  if (tags.length === 0 && !canManageTags) {
    return null
  }

  const handleBindOption = async (option: AnnotationFilterTagOption) => {
    if (pendingAction) return
    setPendingTagKey(option.tagKey)
    setPendingAction('bind')
    setMutationError(null)

    try {
      await onBindTag({
        key: option.key,
        value: option.value,
      })
      closeEditor()
    } catch (error) {
      setMutationError(formatMutationError('bind', error))
    } finally {
      setPendingTagKey(null)
      setPendingAction(null)
    }
  }

  const handleUnbind = async (tag: PreviewHeaderAnnotationTag) => {
    if (pendingAction) return
    setPendingTagKey(tag.tagKey)
    setPendingAction('unbind')
    setMutationError(null)

    try {
      await onUnbindTag(tag)
    } catch (error) {
      setMutationError(formatMutationError('unbind', error))
    } finally {
      setPendingTagKey(null)
      setPendingAction(null)
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative max-w-[58%] shrink-0"
      title={showUnavailableReasons && !canManageTags ? manageUnavailableReason ?? undefined : undefined}
    >
      <div className="overflow-x-auto">
        <div className="flex items-center justify-end gap-1 pl-1">
          {tags.map((tag) => {
            const sourceSummary = buildSourceSummary(tag.representativeSource, tag.sources)
            const unbindDisabled = pendingAction !== null || !canManageTags
            return (
              <span
                key={tag.tagKey}
                className={cn(
                  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-[11px] leading-none',
                  chipClassName
                )}
                title={`${tag.key}: ${tag.value}${sourceSummary ? `\n来源: ${sourceSummary}` : ''}`}
              >
                <span className={keyClassName}>{tag.key}</span>
                <span>{tag.value}</span>
                {tag.hasMetaAnnotation && canManageTags && (
                  <button
                    type="button"
                    className="rounded-sm text-current transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={unbindDisabled}
                    title="仅移除 meta.annotation 来源"
                    onClick={() => {
                      void handleUnbind(tag)
                    }}
                  >
                    {pendingAction === 'unbind' && pendingTagKey === tag.tagKey ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </button>
                )}
              </span>
            )
          })}

          {canManageTags && (
            <Button
              size="icon"
              variant="outline"
              className={cn(
                'h-6 w-6 rounded-full border px-0',
                isFullscreen ? 'border-white/20 bg-white/5 text-white hover:bg-white/10' : ''
              )}
              disabled={pendingAction !== null}
              title="绑定逻辑标签（#）"
              onClick={handleOpenEditor}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {isEditorOpen && (
        <div className={cn('absolute right-0 top-full z-20 mt-2 w-80 rounded-md border p-2', popupClassName)}>
          <Input
            ref={inputRef}
            value={draftValue}
            className="h-8 w-full px-2 text-xs"
            placeholder="输入 key / value / source 筛选"
            onChange={(event) => {
              setDraftValue(event.target.value)
              setActiveOptionIndex(0)
              if (mutationError) {
                setMutationError(null)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveOptionIndex((currentIndex) => (
                  filteredOptions.length === 0
                    ? 0
                    : Math.min(currentIndex + 1, filteredOptions.length - 1)
                ))
                return
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveOptionIndex((currentIndex) => (
                  filteredOptions.length === 0
                    ? 0
                    : Math.max(currentIndex - 1, 0)
                ))
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                const selectedOption = filteredOptions[activeOptionIndex]
                if (selectedOption) {
                  void handleBindOption(selectedOption)
                }
                return
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                closeEditor()
              }
            }}
          />

          <div className="mt-2 max-h-56 overflow-auto">
            {tagOptionsStatus === 'loading' && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">标签候选加载中...</div>
            )}

            {tagOptionsStatus !== 'loading' && tagOptionsError && filteredOptions.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-destructive" title={tagOptionsError}>
                读取标签候选失败
              </div>
            )}

            {tagOptionsStatus !== 'loading' && !tagOptionsError && filteredOptions.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">无匹配标签</div>
            )}

            {filteredOptions.map((option, index) => {
              const isPending = pendingAction === 'bind' && pendingTagKey === option.tagKey
              const sourceSummary = buildSourceSummary(option.representativeSource, option.sources)
              return (
                <button
                  key={option.tagKey}
                  type="button"
                  className={cn(
                    'block w-full rounded px-2 py-1.5 text-left transition-colors',
                    index === activeOptionIndex ? 'bg-accent' : 'hover:bg-accent'
                  )}
                  disabled={pendingAction !== null}
                  title={`${option.key}: ${option.value}${sourceSummary ? `\n来源: ${sourceSummary}` : ''}`}
                  onMouseEnter={() => setActiveOptionIndex(index)}
                  onClick={() => {
                    void handleBindOption(option)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{`${option.key}: ${option.value}`}</span>
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="shrink-0 text-[11px] text-muted-foreground">{sourceSummary}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {mutationError && (
        <p className="mt-1 text-right text-xs text-destructive">{mutationError}</p>
      )}
    </div>
  )
}
