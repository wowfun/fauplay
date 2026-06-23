import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Tags, X } from 'lucide-react'
import {
  ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY,
  ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY,
  ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
  type AnnotationFilterTagOption,
  type FilterState,
} from '@/types'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Select'

type ExplorerToolbarKind = 'wide' | 'compact'

interface ExplorerToolbarAnnotationFilterControlsProps {
  toolbarKind: ExplorerToolbarKind
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  annotationFilterTagOptions: AnnotationFilterTagOption[]
  onOpenAnnotationFilterPanel: () => void
}

function annotationTagDisplayLabel(option: AnnotationFilterTagOption): string {
  if (option.tagKey === ANNOTATION_FILTER_UNANNOTATED_TAG_KEY) {
    return '未标注'
  }
  if (option.tagKey === ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY) {
    return '人物管理: 未归属'
  }
  if (option.tagKey === ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY) {
    return '人物管理: 误检/忽略'
  }
  return `${option.key}: ${option.value}`
}

function isSpecialAnnotationTagOption(option: AnnotationFilterTagOption): boolean {
  return option.tagKey === ANNOTATION_FILTER_UNANNOTATED_TAG_KEY
    || option.tagKey === ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY
    || option.tagKey === ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY
}

function compareAnnotationSource(left: string, right: string): number {
  if (left === 'meta.annotation' && right !== 'meta.annotation') return -1
  if (left !== 'meta.annotation' && right === 'meta.annotation') return 1
  return left.localeCompare(right, 'zh-Hans-CN')
}

function compareAnnotationKey(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans-CN')
}

function buildAnnotationSourceFacetOptions(
  options: AnnotationFilterTagOption[],
  selectedKeyFacet: string
): string[] {
  const sourceSet = new Set<string>()
  for (const option of options) {
    if (isSpecialAnnotationTagOption(option)) continue
    if (selectedKeyFacet && option.key !== selectedKeyFacet) continue
    option.sources.forEach((source) => sourceSet.add(source))
  }
  return [...sourceSet].sort(compareAnnotationSource)
}

function buildAnnotationKeyFacetOptions(
  options: AnnotationFilterTagOption[],
  selectedSourceFacet: string
): string[] {
  const keySet = new Set<string>()
  for (const option of options) {
    if (isSpecialAnnotationTagOption(option)) continue
    if (selectedSourceFacet && !option.sources.includes(selectedSourceFacet)) continue
    keySet.add(option.key)
  }
  return [...keySet].sort(compareAnnotationKey)
}

function matchesAnnotationTagFacets(
  option: AnnotationFilterTagOption,
  selectedSourceFacet: string,
  selectedKeyFacet: string
): boolean {
  if (isSpecialAnnotationTagOption(option)) {
    return !selectedSourceFacet && !selectedKeyFacet
  }
  if (selectedSourceFacet && !option.sources.includes(selectedSourceFacet)) {
    return false
  }
  if (selectedKeyFacet && option.key !== selectedKeyFacet) {
    return false
  }
  return true
}

function mergeAnnotationTagKeys(currentKeys: string[], nextKeys: string[]): string[] {
  const merged = new Set(currentKeys)
  nextKeys.forEach((key) => merged.add(key))
  return [...merged]
}

function toggleTagKeySelection(currentKeys: string[], nextTagKey: string): string[] {
  const keySet = new Set(currentKeys)
  if (keySet.has(nextTagKey)) {
    keySet.delete(nextTagKey)
  } else {
    keySet.add(nextTagKey)
  }
  return [...keySet]
}

function annotationTagSummaryText(
  selectedTagKeys: string[],
  optionByTagKey: Map<string, AnnotationFilterTagOption>,
  emptyText: string
): string {
  if (selectedTagKeys.length === 0) return emptyText
  if (selectedTagKeys.length === 1) {
    const option = optionByTagKey.get(selectedTagKeys[0] || '')
    return option ? annotationTagDisplayLabel(option) : '已选 1 项'
  }
  return `已选 ${selectedTagKeys.length} 项`
}

export function ExplorerToolbarAnnotationFilterControls({
  toolbarKind,
  filter,
  onFilterChange,
  annotationFilterTagOptions,
  onOpenAnnotationFilterPanel,
}: ExplorerToolbarAnnotationFilterControlsProps) {
  const annotationFilterRef = useRef<HTMLDivElement>(null)
  const [isAnnotationIncludeOpen, setIsAnnotationIncludeOpen] = useState(false)
  const [isAnnotationExcludeOpen, setIsAnnotationExcludeOpen] = useState(false)
  const [selectedAnnotationSourceFacet, setSelectedAnnotationSourceFacet] = useState('')
  const [selectedAnnotationKeyFacet, setSelectedAnnotationKeyFacet] = useState('')

  const annotationFilterOptionByTagKey = useMemo(
    () => new Map(annotationFilterTagOptions.map((item) => [item.tagKey, item])),
    [annotationFilterTagOptions]
  )
  const resetAnnotationTagFacets = useCallback(() => {
    setSelectedAnnotationSourceFacet('')
    setSelectedAnnotationKeyFacet('')
  }, [])
  const annotationSourceFacetOptions = useMemo(
    () => buildAnnotationSourceFacetOptions(annotationFilterTagOptions, selectedAnnotationKeyFacet),
    [annotationFilterTagOptions, selectedAnnotationKeyFacet]
  )
  const annotationKeyFacetOptions = useMemo(
    () => buildAnnotationKeyFacetOptions(annotationFilterTagOptions, selectedAnnotationSourceFacet),
    [annotationFilterTagOptions, selectedAnnotationSourceFacet]
  )
  const filteredAnnotationFilterTagOptions = useMemo(
    () => annotationFilterTagOptions.filter((option) => (
      matchesAnnotationTagFacets(option, selectedAnnotationSourceFacet, selectedAnnotationKeyFacet)
    )),
    [annotationFilterTagOptions, selectedAnnotationKeyFacet, selectedAnnotationSourceFacet]
  )

  useEffect(() => {
    if (!selectedAnnotationSourceFacet) return
    if (annotationSourceFacetOptions.includes(selectedAnnotationSourceFacet)) return
    setSelectedAnnotationSourceFacet('')
  }, [annotationSourceFacetOptions, selectedAnnotationSourceFacet])

  useEffect(() => {
    if (!selectedAnnotationKeyFacet) return
    if (annotationKeyFacetOptions.includes(selectedAnnotationKeyFacet)) return
    setSelectedAnnotationKeyFacet('')
  }, [annotationKeyFacetOptions, selectedAnnotationKeyFacet])

  useEffect(() => {
    const handleGlobalPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (annotationFilterRef.current?.contains(target)) return
      setIsAnnotationIncludeOpen(false)
      setIsAnnotationExcludeOpen(false)
      resetAnnotationTagFacets()
    }

    window.addEventListener('mousedown', handleGlobalPointerDown)
    return () => window.removeEventListener('mousedown', handleGlobalPointerDown)
  }, [resetAnnotationTagFacets])

  const handleToggleAnnotationIncludeTag = (tagKey: string) => {
    const nextIncludeTagKeys = toggleTagKeySelection(filter.annotationIncludeTagKeys, tagKey)
    onFilterChange({
      ...filter,
      annotationIncludeTagKeys: nextIncludeTagKeys,
    })
  }

  const handleToggleAnnotationExcludeTag = (tagKey: string) => {
    const nextExcludeTagKeys = toggleTagKeySelection(filter.annotationExcludeTagKeys, tagKey)
    onFilterChange({
      ...filter,
      annotationExcludeTagKeys: nextExcludeTagKeys,
    })
  }

  const clearAnnotationIncludeTags = () => {
    onFilterChange({
      ...filter,
      annotationIncludeTagKeys: [],
    })
  }

  const clearAnnotationExcludeTags = () => {
    onFilterChange({
      ...filter,
      annotationExcludeTagKeys: [],
    })
  }

  const selectAllAnnotationIncludeTags = () => {
    const nextVisibleTagKeys = filteredAnnotationFilterTagOptions.map((option) => option.tagKey)
    onFilterChange({
      ...filter,
      annotationIncludeTagKeys: mergeAnnotationTagKeys(filter.annotationIncludeTagKeys, nextVisibleTagKeys),
    })
  }

  const selectAllAnnotationExcludeTags = () => {
    const nextVisibleTagKeys = filteredAnnotationFilterTagOptions.map((option) => option.tagKey)
    onFilterChange({
      ...filter,
      annotationExcludeTagKeys: mergeAnnotationTagKeys(filter.annotationExcludeTagKeys, nextVisibleTagKeys),
    })
  }

  const handleToggleAnnotationIncludePanel = () => {
    if (isAnnotationIncludeOpen) {
      setIsAnnotationIncludeOpen(false)
      resetAnnotationTagFacets()
      return
    }

    resetAnnotationTagFacets()
    onOpenAnnotationFilterPanel()
    setIsAnnotationIncludeOpen(true)
    setIsAnnotationExcludeOpen(false)
  }

  const handleToggleAnnotationExcludePanel = () => {
    if (isAnnotationExcludeOpen) {
      setIsAnnotationExcludeOpen(false)
      resetAnnotationTagFacets()
      return
    }

    resetAnnotationTagFacets()
    onOpenAnnotationFilterPanel()
    setIsAnnotationExcludeOpen(true)
    setIsAnnotationIncludeOpen(false)
  }

  const renderAnnotationTagPanel = (
    selectedTagKeys: string[],
    onToggleTag: (tagKey: string) => void,
    onClear: () => void,
    onSelectAll: () => void
  ) => {
    const allVisibleSelected = filteredAnnotationFilterTagOptions.length > 0
      && filteredAnnotationFilterTagOptions.every((option) => selectedTagKeys.includes(option.tagKey))

    return (
      <div
        className="absolute right-0 top-full z-30 mt-1 w-80 rounded-md border border-border bg-background p-1 shadow-md"
        onClick={(event) => event.stopPropagation()}
      >
        {annotationFilterTagOptions.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">无可选标签</div>
        ) : (
          <>
            <div className="mb-1 space-y-1 px-2 py-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">多选</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={onSelectAll}
                    disabled={filteredAnnotationFilterTagOptions.length === 0 || allVisibleSelected}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={onClear}
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <label className="min-w-0">
                  <span className="mb-1 block text-[11px] text-muted-foreground">来源</span>
                  <Select
                    value={selectedAnnotationSourceFacet}
                    onChange={(event) => setSelectedAnnotationSourceFacet(event.target.value)}
                    className="h-7 w-full min-w-0 text-xs"
                    title="按来源筛选标签候选"
                  >
                    <option value="">全部来源</option>
                    {annotationSourceFacetOptions.map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="min-w-0">
                  <span className="mb-1 block text-[11px] text-muted-foreground">键</span>
                  <Select
                    value={selectedAnnotationKeyFacet}
                    onChange={(event) => setSelectedAnnotationKeyFacet(event.target.value)}
                    className="h-7 w-full min-w-0 text-xs"
                    title="按 key 筛选标签候选"
                  >
                    <option value="">全部 key</option>
                    {annotationKeyFacetOptions.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            </div>
            {filteredAnnotationFilterTagOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">无匹配标签</div>
            ) : (
              <div className="max-h-64 overflow-auto">
                {filteredAnnotationFilterTagOptions.map((option) => {
                  const checked = selectedTagKeys.includes(option.tagKey)
                  const optionLabel = annotationTagDisplayLabel(option)
                  return (
                    <button
                      key={option.tagKey}
                      type="button"
                      onClick={() => onToggleTag(option.tagKey)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                      title={optionLabel}
                    >
                      <span
                        className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{optionLabel}</span>
                      {typeof option.fileCount === 'number' && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">({option.fileCount})</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div
      ref={annotationFilterRef}
      className={toolbarKind === 'compact'
        ? 'flex w-full flex-wrap items-center gap-1 rounded-md border border-border bg-background p-1'
        : 'flex items-center gap-1 rounded-md border border-border bg-background p-1'}
    >
      <Select
        value={filter.annotationIncludeMatchMode}
        onChange={(event) => {
          const nextMode = event.target.value as FilterState['annotationIncludeMatchMode']
          onFilterChange({
            ...filter,
            annotationIncludeMatchMode: nextMode,
          })
        }}
        className="h-8 w-[72px]"
        title="包含标签匹配模式"
      >
        <option value="or">OR</option>
        <option value="and">AND</option>
      </Select>

      <div className="relative">
        <Button
          onClick={handleToggleAnnotationIncludePanel}
          variant={filter.annotationIncludeTagKeys.length > 0 ? 'default' : 'ghost'}
          size="md"
          className="h-8 max-w-40 justify-start gap-1"
          title="包含标签（多选）"
        >
          <Tags className="h-4 w-4 shrink-0" />
          <span className="truncate text-xs">
            {annotationTagSummaryText(
              filter.annotationIncludeTagKeys,
              annotationFilterOptionByTagKey,
              '包含标签'
            )}
          </span>
        </Button>
        {isAnnotationIncludeOpen && renderAnnotationTagPanel(
          filter.annotationIncludeTagKeys,
          handleToggleAnnotationIncludeTag,
          clearAnnotationIncludeTags,
          selectAllAnnotationIncludeTags
        )}
      </div>

      <div className="relative">
        <Button
          onClick={handleToggleAnnotationExcludePanel}
          variant={filter.annotationExcludeTagKeys.length > 0 ? 'default' : 'ghost'}
          size="md"
          className="h-8 max-w-40 justify-start gap-1"
          title="排除标签（NOT，多选）"
        >
          <X className="h-4 w-4 shrink-0" />
          <span className="truncate text-xs">
            {annotationTagSummaryText(
              filter.annotationExcludeTagKeys,
              annotationFilterOptionByTagKey,
              '排除标签'
            )}
          </span>
        </Button>
        {isAnnotationExcludeOpen && renderAnnotationTagPanel(
          filter.annotationExcludeTagKeys,
          handleToggleAnnotationExcludeTag,
          clearAnnotationExcludeTags,
          selectAllAnnotationExcludeTags
        )}
      </div>
    </div>
  )
}
