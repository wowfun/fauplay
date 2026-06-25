import {
  ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY,
  ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY,
  ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
  type AnnotationFilterTagOption,
} from '../../../types/index.ts'

interface ResolveAnnotationFilterPanelOptionsParams {
  options: readonly AnnotationFilterTagOption[]
  selectedSourceFacet: string
  selectedKeyFacet: string
}

interface ResolveAnnotationFilterFacetStateParams {
  selectedSourceFacet: string
  selectedKeyFacet: string
  sourceFacetOptions: readonly string[]
  keyFacetOptions: readonly string[]
}

export type AnnotationFilterTagPanel = 'include' | 'exclude'

interface ResolveAnnotationFilterPanelDisclosureParams {
  openPanel: AnnotationFilterTagPanel | null
  action:
    | {
      type: 'toggle-panel'
      panel: AnnotationFilterTagPanel
    }
    | {
      type: 'close-panels'
    }
}

interface ResolveAnnotationFilterPanelSelectionStateParams {
  selectedTagKeys: readonly string[]
  visibleOptions: readonly AnnotationFilterTagOption[]
}

interface ResolveAnnotationFilterTagSummaryParams {
  selectedTagKeys: readonly string[]
  options: readonly AnnotationFilterTagOption[]
  emptyText: string
}

type ResolveAnnotationFilterTagSelectionAction =
  | {
    type: 'toggle'
    tagKey: string
  }
  | {
    type: 'clear'
  }
  | {
    type: 'select-visible'
    visibleOptions: readonly AnnotationFilterTagOption[]
  }

interface ResolveAnnotationFilterTagSelectionParams {
  selectedTagKeys: readonly string[]
  action: ResolveAnnotationFilterTagSelectionAction
}

export interface AnnotationFilterPanelOptions {
  sourceFacetOptions: string[]
  keyFacetOptions: string[]
  visibleOptions: AnnotationFilterTagOption[]
}

export interface AnnotationFilterFacetState {
  selectedSourceFacet: string
  selectedKeyFacet: string
}

export interface AnnotationFilterPanelDisclosure {
  openPanel: AnnotationFilterTagPanel | null
  shouldOpenAnnotationFilterPanel: boolean
  shouldResetFacets: boolean
}

export interface AnnotationFilterPanelSelectionState {
  allVisibleSelected: boolean
  canSelectVisible: boolean
}

export function resolveAnnotationFilterTagLabel(option: AnnotationFilterTagOption): string {
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

export function resolveAnnotationFilterPanelOptions({
  options,
  selectedSourceFacet,
  selectedKeyFacet,
}: ResolveAnnotationFilterPanelOptionsParams): AnnotationFilterPanelOptions {
  return {
    sourceFacetOptions: buildAnnotationSourceFacetOptions(options, selectedKeyFacet),
    keyFacetOptions: buildAnnotationKeyFacetOptions(options, selectedSourceFacet),
    visibleOptions: options.filter((option) => (
      matchesAnnotationTagFacets(option, selectedSourceFacet, selectedKeyFacet)
    )),
  }
}

export function resolveAnnotationFilterFacetState({
  selectedSourceFacet,
  selectedKeyFacet,
  sourceFacetOptions,
  keyFacetOptions,
}: ResolveAnnotationFilterFacetStateParams): AnnotationFilterFacetState {
  return {
    selectedSourceFacet: selectedSourceFacet && !sourceFacetOptions.includes(selectedSourceFacet)
      ? ''
      : selectedSourceFacet,
    selectedKeyFacet: selectedKeyFacet && !keyFacetOptions.includes(selectedKeyFacet)
      ? ''
      : selectedKeyFacet,
  }
}

export function resolveAnnotationFilterPanelDisclosure({
  openPanel,
  action,
}: ResolveAnnotationFilterPanelDisclosureParams): AnnotationFilterPanelDisclosure {
  if (action.type === 'close-panels') {
    return {
      openPanel: null,
      shouldOpenAnnotationFilterPanel: false,
      shouldResetFacets: true,
    }
  }

  if (openPanel === action.panel) {
    return {
      openPanel: null,
      shouldOpenAnnotationFilterPanel: false,
      shouldResetFacets: true,
    }
  }

  return {
    openPanel: action.panel,
    shouldOpenAnnotationFilterPanel: true,
    shouldResetFacets: true,
  }
}

export function resolveAnnotationFilterPanelSelectionState({
  selectedTagKeys,
  visibleOptions,
}: ResolveAnnotationFilterPanelSelectionStateParams): AnnotationFilterPanelSelectionState {
  const selectedKeySet = new Set(selectedTagKeys)
  const allVisibleSelected = visibleOptions.length > 0
    && visibleOptions.every((option) => selectedKeySet.has(option.tagKey))

  return {
    allVisibleSelected,
    canSelectVisible: visibleOptions.length > 0 && !allVisibleSelected,
  }
}

export function resolveAnnotationFilterTagSummary({
  selectedTagKeys,
  options,
  emptyText,
}: ResolveAnnotationFilterTagSummaryParams): string {
  if (selectedTagKeys.length === 0) return emptyText
  if (selectedTagKeys.length === 1) {
    const optionByTagKey = new Map(options.map((item) => [item.tagKey, item]))
    const option = optionByTagKey.get(selectedTagKeys[0] || '')
    return option ? resolveAnnotationFilterTagLabel(option) : '已选 1 项'
  }
  return `已选 ${selectedTagKeys.length} 项`
}

export function resolveAnnotationFilterTagSelection({
  selectedTagKeys,
  action,
}: ResolveAnnotationFilterTagSelectionParams): string[] {
  if (action.type === 'clear') {
    return []
  }

  if (action.type === 'select-visible') {
    const merged = new Set(selectedTagKeys)
    action.visibleOptions.forEach((option) => merged.add(option.tagKey))
    return [...merged]
  }

  const keySet = new Set(selectedTagKeys)
  if (keySet.has(action.tagKey)) {
    keySet.delete(action.tagKey)
  } else {
    keySet.add(action.tagKey)
  }
  return [...keySet]
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
  options: readonly AnnotationFilterTagOption[],
  selectedKeyFacet: string,
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
  options: readonly AnnotationFilterTagOption[],
  selectedSourceFacet: string,
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
  selectedKeyFacet: string,
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
