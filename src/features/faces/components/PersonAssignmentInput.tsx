import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { listPeople, type FaceApiContext } from '@/features/faces/api'
import type { PersonScope, PersonSummary } from '@/features/faces/types'
import {
  getPersonDisplayName,
  matchesNormalizedPersonAlias,
} from '@/features/faces/utils/personDisplayName'
import { cn } from '@/lib/utils'
import { Input } from '@/ui/Input'

interface PersonAssignmentInputProps {
  context: FaceApiContext
  scope: PersonScope
  disabled?: boolean
  excludedPersonIds?: string[]
  placeholder?: string
  querySize?: number
  emptyQuerySize?: number
  className?: string
  onAssign: (personId: string) => Promise<boolean | void> | boolean | void
  onCreate: (name: string) => Promise<boolean | void> | boolean | void
}

type AssignmentOption =
  | { kind: 'person'; person: PersonSummary }
  | { kind: 'create'; name: string }

function normalizePersonName(name: string): string {
  return name.trim().toLowerCase()
}

function faceCountLabel(person: PersonSummary, scope: PersonScope): string {
  if (scope === 'global') {
    return `${person.globalFaceCount} 张脸`
  }
  return `当前 ${person.faceCount} / 全局 ${person.globalFaceCount}`
}

export function PersonAssignmentInput({
  context,
  scope,
  disabled = false,
  excludedPersonIds = [],
  placeholder = '搜索或新建人物',
  querySize = 20,
  emptyQuerySize = 20,
  className,
  onAssign,
  onCreate,
}: PersonAssignmentInputProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [results, setResults] = useState<PersonSummary[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const trimmedQuery = query.trim()
  const normalizedQuery = normalizePersonName(query)
  const excludedIdSet = useMemo(() => new Set(excludedPersonIds), [excludedPersonIds])

  const visibleResults = useMemo(() => {
    const filtered = results.filter((person) => !excludedIdSet.has(person.personId))
    if (!normalizedQuery) return filtered
    const exactMatches: PersonSummary[] = []
    const fuzzyMatches: PersonSummary[] = []
    for (const person of filtered) {
      if (matchesNormalizedPersonAlias(person, normalizedQuery)) {
        exactMatches.push(person)
      } else {
        fuzzyMatches.push(person)
      }
    }
    return [...exactMatches, ...fuzzyMatches]
  }, [excludedIdSet, normalizedQuery, results])

  const hasExactMatch = useMemo(() => (
    normalizedQuery.length > 0
      && results.some((person) => matchesNormalizedPersonAlias(person, normalizedQuery))
  ), [normalizedQuery, results])

  const options = useMemo<AssignmentOption[]>(() => {
    const items: AssignmentOption[] = visibleResults.map((person) => ({ kind: 'person', person }))
    if (trimmedQuery && !hasExactMatch) {
      items.push({
        kind: 'create',
        name: trimmedQuery,
      })
    }
    return items
  }, [hasExactMatch, trimmedQuery, visibleResults])

  useEffect(() => {
    if (disabled) {
      setIsOpen(false)
      setIsLoading(false)
      setIsSubmitting(false)
    }
  }, [disabled])

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(-1)
      return
    }
    if (hasExactMatch) {
      setHighlightedIndex(options.findIndex((option) => option.kind === 'person'))
      return
    }
    setHighlightedIndex(-1)
  }, [hasExactMatch, isOpen, options, trimmedQuery])

  useEffect(() => {
    if (!isOpen || disabled || isSubmitting) return

    let cancelled = false
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const items = await listPeople(context, {
            scope,
            query: trimmedQuery || undefined,
            size: trimmedQuery ? querySize : emptyQuerySize,
          })
          if (cancelled || requestId !== requestIdRef.current) return
          setResults(items)
          setErrorMessage(null)
        } catch (error) {
          if (cancelled || requestId !== requestIdRef.current) return
          setResults([])
          setErrorMessage(error instanceof Error ? error.message : '人物候选加载失败')
        } finally {
          if (!cancelled && requestId === requestIdRef.current) {
            setIsLoading(false)
          }
        }
      })()
    }, trimmedQuery ? 180 : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [
    context,
    disabled,
    emptyQuerySize,
    isOpen,
    isSubmitting,
    querySize,
    scope,
    trimmedQuery,
  ])

  useEffect(() => {
    if (!isOpen) return undefined
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
      setHighlightedIndex(-1)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isOpen])

  const handleCommit = async (option: AssignmentOption) => {
    if (disabled || isSubmitting) return
    setIsSubmitting(true)
    setErrorMessage(null)
    try {
      const result = option.kind === 'person'
        ? await onAssign(option.person.personId)
        : await onCreate(option.name)
      if (result !== false) {
        setQuery('')
        setResults([])
        setIsOpen(false)
        setHighlightedIndex(-1)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '人物归属失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (disabled || isSubmitting) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      if (options.length <= 0) return
      setHighlightedIndex((current) => (current < 0 ? 0 : (current + 1) % options.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      if (options.length <= 0) return
      setHighlightedIndex((current) => (current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length))
      return
    }
    if (event.key === 'Enter') {
      if (!isOpen) return
      const option = highlightedIndex >= 0 ? options[highlightedIndex] : null
      if (!option && !(trimmedQuery && !hasExactMatch)) return
      event.preventDefault()
      if (option) {
        void handleCommit(option)
        return
      }
      void handleCommit({
        kind: 'create',
        name: trimmedQuery,
      })
      return
    }
    if (event.key === 'Escape') {
      if (!isOpen) return
      event.preventDefault()
      setIsOpen(false)
      setHighlightedIndex(-1)
    }
  }

  const showEmptyState = !isLoading && options.length === 0

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setErrorMessage(null)
          setIsOpen(true)
        }}
        onFocus={() => {
          if (!disabled) {
            setIsOpen(true)
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isSubmitting}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
      />

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-md border border-border bg-background shadow-lg"
        >
          {isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">人物候选加载中...</div>
          )}

          {!isLoading && options.map((option, index) => {
            if (option.kind === 'person') {
              return (
                <button
                  key={option.person.personId}
                  type="button"
                  role="option"
                  aria-selected={highlightedIndex === index}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-b-0',
                    highlightedIndex === index ? 'bg-accent' : 'hover:bg-accent'
                  )}
                  disabled={disabled || isSubmitting}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => {
                    void handleCommit(option)
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">{getPersonDisplayName(option.person)}</div>
                    <div className="text-xs text-muted-foreground">
                      {faceCountLabel(option.person, scope)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">归入</span>
                </button>
              )
            }
            return (
              <button
                key={`create:${option.name}`}
                type="button"
                role="option"
                aria-selected={highlightedIndex === index}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left',
                  highlightedIndex === index ? 'bg-accent' : 'hover:bg-accent'
                )}
                disabled={disabled || isSubmitting}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => {
                  void handleCommit(option)
                }}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm">新建并归入 “{option.name}”</div>
                  <div className="text-xs text-muted-foreground">没有精确重名人物</div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">新建</span>
              </button>
            )
          })}

          {showEmptyState && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {trimmedQuery ? '未找到可归入人物' : '暂无可选人物'}
            </div>
          )}
        </div>
      )}

      {errorMessage && (
        <div className="mt-2 text-xs text-destructive">{errorMessage}</div>
      )}
    </div>
  )
}
