import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveAnnotationFilterPanelDisclosure,
  resolveAnnotationFilterFacetState,
  resolveAnnotationFilterPanelOptions,
  resolveAnnotationFilterPanelSelectionState,
  resolveAnnotationFilterTagLabel,
  resolveAnnotationFilterTagSelection,
  resolveAnnotationFilterTagSummary,
} from '../../src/features/explorer/lib/annotationFilterOptionModel.ts'
import {
  ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY,
  ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY,
  ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
} from '../../src/types/index.ts'

function tagOption(tagKey, overrides = {}) {
  return {
    tagKey,
    key: 'camera',
    value: 'Leica',
    sources: ['meta.annotation'],
    hasMetaAnnotation: true,
    representativeSource: 'meta.annotation',
    fileCount: 2,
    ...overrides,
  }
}

test('Explorer Annotation Filter Option Model labels special and regular tags', () => {
  assert.equal(
    resolveAnnotationFilterTagLabel(tagOption(ANNOTATION_FILTER_UNANNOTATED_TAG_KEY)),
    '未标注',
  )
  assert.equal(
    resolveAnnotationFilterTagLabel(tagOption(ANNOTATION_FILTER_PEOPLE_UNASSIGNED_TAG_KEY)),
    '人物管理: 未归属',
  )
  assert.equal(
    resolveAnnotationFilterTagLabel(tagOption(ANNOTATION_FILTER_PEOPLE_IGNORED_TAG_KEY)),
    '人物管理: 误检/忽略',
  )
  assert.equal(
    resolveAnnotationFilterTagLabel(tagOption('camera=Leica', {
      key: 'camera',
      value: 'Leica M11',
    })),
    'camera: Leica M11',
  )
})

test('Explorer Annotation Filter Option Model resolves facet options and visible tags', () => {
  const options = [
    tagOption(ANNOTATION_FILTER_UNANNOTATED_TAG_KEY),
    tagOption('lens=50mm', {
      key: 'lens',
      value: '50mm',
      sources: ['vision'],
      representativeSource: 'vision',
      hasMetaAnnotation: false,
    }),
    tagOption('camera=Leica', {
      key: 'camera',
      value: 'Leica',
      sources: ['vision', 'meta.annotation'],
      representativeSource: 'meta.annotation',
    }),
    tagOption('camera=Fuji', {
      key: 'camera',
      value: 'Fuji',
      sources: ['vision'],
      representativeSource: 'vision',
      hasMetaAnnotation: false,
    }),
  ]

  assert.deepEqual(resolveAnnotationFilterPanelOptions({
    options,
    selectedSourceFacet: '',
    selectedKeyFacet: '',
  }), {
    sourceFacetOptions: ['meta.annotation', 'vision'],
    keyFacetOptions: ['camera', 'lens'],
    visibleOptions: options,
  })

  assert.deepEqual(resolveAnnotationFilterPanelOptions({
    options,
    selectedSourceFacet: 'vision',
    selectedKeyFacet: '',
  }), {
    sourceFacetOptions: ['meta.annotation', 'vision'],
    keyFacetOptions: ['camera', 'lens'],
    visibleOptions: [
      options[1],
      options[2],
      options[3],
    ],
  })

  assert.deepEqual(resolveAnnotationFilterPanelOptions({
    options,
    selectedSourceFacet: '',
    selectedKeyFacet: 'camera',
  }), {
    sourceFacetOptions: ['meta.annotation', 'vision'],
    keyFacetOptions: ['camera', 'lens'],
    visibleOptions: [
      options[2],
      options[3],
    ],
  })
})

test('Explorer Annotation Filter Option Model clears facets that no longer match options', () => {
  assert.deepEqual(resolveAnnotationFilterFacetState({
    selectedSourceFacet: 'vision',
    selectedKeyFacet: 'camera',
    sourceFacetOptions: ['meta.annotation'],
    keyFacetOptions: ['lens'],
  }), {
    selectedSourceFacet: '',
    selectedKeyFacet: '',
  })

  assert.deepEqual(resolveAnnotationFilterFacetState({
    selectedSourceFacet: 'meta.annotation',
    selectedKeyFacet: 'camera',
    sourceFacetOptions: ['meta.annotation'],
    keyFacetOptions: ['camera'],
  }), {
    selectedSourceFacet: 'meta.annotation',
    selectedKeyFacet: 'camera',
  })
})

test('Explorer Annotation Filter Option Model summarizes and updates selected tags', () => {
  const options = [
    tagOption('camera=Leica', {
      key: 'camera',
      value: 'Leica M11',
    }),
    tagOption('lens=50mm', {
      key: 'lens',
      value: '50mm',
    }),
  ]

  assert.equal(resolveAnnotationFilterTagSummary({
    selectedTagKeys: [],
    options,
    emptyText: '包含标签',
  }), '包含标签')
  assert.equal(resolveAnnotationFilterTagSummary({
    selectedTagKeys: ['camera=Leica'],
    options,
    emptyText: '包含标签',
  }), 'camera: Leica M11')
  assert.equal(resolveAnnotationFilterTagSummary({
    selectedTagKeys: ['missing'],
    options,
    emptyText: '包含标签',
  }), '已选 1 项')
  assert.equal(resolveAnnotationFilterTagSummary({
    selectedTagKeys: ['camera=Leica', 'lens=50mm'],
    options,
    emptyText: '包含标签',
  }), '已选 2 项')

  assert.deepEqual(resolveAnnotationFilterTagSelection({
    selectedTagKeys: ['camera=Leica'],
    action: { type: 'toggle', tagKey: 'lens=50mm' },
  }), ['camera=Leica', 'lens=50mm'])
  assert.deepEqual(resolveAnnotationFilterTagSelection({
    selectedTagKeys: ['camera=Leica', 'lens=50mm'],
    action: { type: 'toggle', tagKey: 'camera=Leica' },
  }), ['lens=50mm'])
  assert.deepEqual(resolveAnnotationFilterTagSelection({
    selectedTagKeys: ['camera=Leica'],
    action: { type: 'select-visible', visibleOptions: options },
  }), ['camera=Leica', 'lens=50mm'])
  assert.deepEqual(resolveAnnotationFilterTagSelection({
    selectedTagKeys: ['camera=Leica'],
    action: { type: 'clear' },
  }), [])
})

test('Explorer Annotation Filter Option Model keeps include and exclude panels mutually exclusive', () => {
  assert.deepEqual(resolveAnnotationFilterPanelDisclosure({
    openPanel: null,
    action: { type: 'toggle-panel', panel: 'include' },
  }), {
    openPanel: 'include',
    shouldOpenAnnotationFilterPanel: true,
    shouldResetFacets: true,
  })

  assert.deepEqual(resolveAnnotationFilterPanelDisclosure({
    openPanel: 'include',
    action: { type: 'toggle-panel', panel: 'exclude' },
  }), {
    openPanel: 'exclude',
    shouldOpenAnnotationFilterPanel: true,
    shouldResetFacets: true,
  })

  assert.deepEqual(resolveAnnotationFilterPanelDisclosure({
    openPanel: 'exclude',
    action: { type: 'toggle-panel', panel: 'exclude' },
  }), {
    openPanel: null,
    shouldOpenAnnotationFilterPanel: false,
    shouldResetFacets: true,
  })

  assert.deepEqual(resolveAnnotationFilterPanelDisclosure({
    openPanel: 'include',
    action: { type: 'close-panels' },
  }), {
    openPanel: null,
    shouldOpenAnnotationFilterPanel: false,
    shouldResetFacets: true,
  })
})

test('Explorer Annotation Filter Option Model reports visible selection state', () => {
  const options = [
    tagOption('camera=Leica'),
    tagOption('lens=50mm'),
  ]

  assert.deepEqual(resolveAnnotationFilterPanelSelectionState({
    selectedTagKeys: [],
    visibleOptions: [],
  }), {
    allVisibleSelected: false,
    canSelectVisible: false,
  })

  assert.deepEqual(resolveAnnotationFilterPanelSelectionState({
    selectedTagKeys: ['camera=Leica'],
    visibleOptions: options,
  }), {
    allVisibleSelected: false,
    canSelectVisible: true,
  })

  assert.deepEqual(resolveAnnotationFilterPanelSelectionState({
    selectedTagKeys: ['camera=Leica', 'lens=50mm', 'extra'],
    visibleOptions: options,
  }), {
    allVisibleSelected: true,
    canSelectVisible: false,
  })
})
