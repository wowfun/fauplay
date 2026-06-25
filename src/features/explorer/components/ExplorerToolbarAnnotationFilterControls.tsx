import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Tags, X } from 'lucide-react'
import {
  type AnnotationFilterTagOption,
  type FilterState,
} from '@/types'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Select'
import {
  type AnnotationFilterTagPanel,
  resolveAnnotationFilterFacetState,
  resolveAnnotationFilterPanelDisclosure,
  resolveAnnotationFilterPanelOptions,
  resolveAnnotationFilterPanelSelectionState,
  resolveAnnotationFilterTagLabel,
  resolveAnnotationFilterTagSelection,
  resolveAnnotationFilterTagSummary,
} from '@/features/explorer/lib/annotationFilterOptionModel'

type ExplorerToolbarKind = 'wide' | 'compact'

interface ExplorerToolbarAnnotationFilterControlsProps {
  toolbarKind: ExplorerToolbarKind
  filter: FilterState
  onFilterChange: (filter: FilterState) => void
  annotationFilterTagOptions: AnnotationFilterTagOption[]
  onOpenAnnotationFilterPanel: () => void
}

export function ExplorerToolbarAnnotationFilterControls({
  toolbarKind,
  filter,
  onFilterChange,
  annotationFilterTagOptions,
  onOpenAnnotationFilterPanel,
}: ExplorerToolbarAnnotationFilterControlsProps) {
  const annotationFilterRef = useRef<HTMLDivElement>(null)
  const [openAnnotationTagPanel, setOpenAnnotationTagPanel] = useState<AnnotationFilterTagPanel | null>(null)
  const [selectedAnnotationSourceFacet, setSelectedAnnotationSourceFacet] = useState('')
  const [selectedAnnotationKeyFacet, setSelectedAnnotationKeyFacet] = useState('')

  const resetAnnotationTagFacets = useCallback(() => {
    setSelectedAnnotationSourceFacet('')
    setSelectedAnnotationKeyFacet('')
  }, [])
  const {
    sourceFacetOptions: annotationSourceFacetOptions,
    keyFacetOptions: annotationKeyFacetOptions,
    visibleOptions: filteredAnnotationFilterTagOptions,
  } = useMemo(
    () => resolveAnnotationFilterPanelOptions({
      options: annotationFilterTagOptions,
      selectedSourceFacet: selectedAnnotationSourceFacet,
      selectedKeyFacet: selectedAnnotationKeyFacet,
    }),
    [annotationFilterTagOptions, selectedAnnotationKeyFacet, selectedAnnotationSourceFacet]
  )

  useEffect(() => {
    const nextState = resolveAnnotationFilterFacetState({
      selectedSourceFacet: selectedAnnotationSourceFacet,
      selectedKeyFacet: selectedAnnotationKeyFacet,
      sourceFacetOptions: annotationSourceFacetOptions,
      keyFacetOptions: annotationKeyFacetOptions,
    })
    if (nextState.selectedSourceFacet !== selectedAnnotationSourceFacet) {
      setSelectedAnnotationSourceFacet(nextState.selectedSourceFacet)
    }
    if (nextState.selectedKeyFacet !== selectedAnnotationKeyFacet) {
      setSelectedAnnotationKeyFacet(nextState.selectedKeyFacet)
    }
  }, [
    annotationKeyFacetOptions,
    annotationSourceFacetOptions,
    selectedAnnotationKeyFacet,
    selectedAnnotationSourceFacet,
  ])


  useEffect(() => {
    const handleGlobalPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (annotationFilterRef.current?.contains(target)) return
      const disclosure = resolveAnnotationFilterPanelDisclosure({
        openPanel: openAnnotationTagPanel,
        action: { type: 'close-panels' },
      })
      setOpenAnnotationTagPanel(disclosure.openPanel)
      if (disclosure.shouldResetFacets) {
        resetAnnotationTagFacets()
      }
    }

    window.addEventListener('mousedown', handleGlobalPointerDown)
    return () => window.removeEventListener('mousedown', handleGlobalPointerDown)
  }, [openAnnotationTagPanel, resetAnnotationTagFacets])

  const handleToggleAnnotationIncludeTag = (tagKey: string) => {
    onFilterChange({
      ...filter,
      annotationIncludeTagKeys: resolveAnnotationFilterTagSelection({
        selectedTagKeys: filter.annotationIncludeTagKeys,
        action: { type: 'toggle', tagKey },
      }),
    })
  }

  const handleToggleAnnotationExcludeTag = (tagKey: string) => {
    onFilterChange({
      ...filter,
      annotationExcludeTagKeys: resolveAnnotationFilterTagSelection({
        selectedTagKeys: filter.annotationExcludeTagKeys,
        action: { type: 'toggle', tagKey },
      }),
    })
  }

  const clearAnnotationIncludeTags = () => {
    onFilterChange({
      ...filter,
      annotationIncludeTagKeys: resolveAnnotationFilterTagSelection({
        selectedTagKeys: filter.annotationIncludeTagKeys,
        action: { type: 'clear' },
      }),
    })
  }

  const clearAnnotationExcludeTags = () => {
    onFilterChange({
      ...filter,
      annotationExcludeTagKeys: resolveAnnotationFilterTagSelection({
        selectedTagKeys: filter.annotationExcludeTagKeys,
        action: { type: 'clear' },
      }),
    })
  }

  const selectAllAnnotationIncludeTags = () => {
    onFilterChange({
      ...filter,
      annotationIncludeTagKeys: resolveAnnotationFilterTagSelection({
        selectedTagKeys: filter.annotationIncludeTagKeys,
        action: { type: 'select-visible', visibleOptions: filteredAnnotationFilterTagOptions },
      }),
    })
  }

  const selectAllAnnotationExcludeTags = () => {
    onFilterChange({
      ...filter,
      annotationExcludeTagKeys: resolveAnnotationFilterTagSelection({
        selectedTagKeys: filter.annotationExcludeTagKeys,
        action: { type: 'select-visible', visibleOptions: filteredAnnotationFilterTagOptions },
      }),
    })
  }

  const handleToggleAnnotationPanel = (panel: AnnotationFilterTagPanel) => {
    const disclosure = resolveAnnotationFilterPanelDisclosure({
      openPanel: openAnnotationTagPanel,
      action: { type: 'toggle-panel', panel },
    })
    setOpenAnnotationTagPanel(disclosure.openPanel)
    if (disclosure.shouldResetFacets) {
      resetAnnotationTagFacets()
    }
    if (disclosure.shouldOpenAnnotationFilterPanel) {
      onOpenAnnotationFilterPanel()
    }
  }

  const renderAnnotationTagPanel = (
    selectedTagKeys: string[],
    onToggleTag: (tagKey: string) => void,
    onClear: () => void,
    onSelectAll: () => void
  ) => {
    const { canSelectVisible } = resolveAnnotationFilterPanelSelectionState({
      selectedTagKeys,
      visibleOptions: filteredAnnotationFilterTagOptions,
    })

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
                    disabled={!canSelectVisible}
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
                  const optionLabel = resolveAnnotationFilterTagLabel(option)
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
          onClick={() => handleToggleAnnotationPanel('include')}
          variant={filter.annotationIncludeTagKeys.length > 0 ? 'default' : 'ghost'}
          size="md"
          className="h-8 max-w-40 justify-start gap-1"
          title="包含标签（多选）"
        >
          <Tags className="h-4 w-4 shrink-0" />
          <span className="truncate text-xs">
            {resolveAnnotationFilterTagSummary({
              selectedTagKeys: filter.annotationIncludeTagKeys,
              options: annotationFilterTagOptions,
              emptyText: '包含标签',
            })}
          </span>
        </Button>
        {openAnnotationTagPanel === 'include' && renderAnnotationTagPanel(
          filter.annotationIncludeTagKeys,
          handleToggleAnnotationIncludeTag,
          clearAnnotationIncludeTags,
          selectAllAnnotationIncludeTags
        )}
      </div>

      <div className="relative">
        <Button
          onClick={() => handleToggleAnnotationPanel('exclude')}
          variant={filter.annotationExcludeTagKeys.length > 0 ? 'default' : 'ghost'}
          size="md"
          className="h-8 max-w-40 justify-start gap-1"
          title="排除标签（NOT，多选）"
        >
          <X className="h-4 w-4 shrink-0" />
          <span className="truncate text-xs">
            {resolveAnnotationFilterTagSummary({
              selectedTagKeys: filter.annotationExcludeTagKeys,
              options: annotationFilterTagOptions,
              emptyText: '排除标签',
            })}
          </span>
        </Button>
        {openAnnotationTagPanel === 'exclude' && renderAnnotationTagPanel(
          filter.annotationExcludeTagKeys,
          handleToggleAnnotationExcludeTag,
          clearAnnotationExcludeTags,
          selectAllAnnotationExcludeTags
        )}
      </div>
    </div>
  )
}
