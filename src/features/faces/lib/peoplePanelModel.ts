import type { FaceRecord, PersonScope, PersonSummary } from '../types.ts'
import { getPersonDisplayName } from '../utils/personDisplayName.ts'
import type { PanelView } from './peoplePanelText.ts'

export type CompactPeopleStage = 'list' | 'detail'
export type PeoplePanelFaceSectionLayout = 'wide' | 'compact-detail' | 'compact-review'
export type PeoplePanelFaceSectionActionLayout = 'inline' | 'stacked'

export interface ResolvePeoplePanelSelectionModelParams {
  people: PersonSummary[]
  allPeople: PersonSummary[]
  selectedPersonId: string | null
  faces: FaceRecord[]
  selectedFaceIds: Set<string>
  mergeTargetQuery: string
  scope: PersonScope
  view: PanelView
}

export interface PeoplePanelSelectionModel {
  selectedPerson: PersonSummary | null
  selectedFaces: FaceRecord[]
  mergeTargetCandidates: PersonSummary[]
  selectedIds: string[]
  assignmentExcludedPersonIds: string[]
  assignmentInputKey: string
  faceSelectionScopeKey: string
}

export interface PeoplePanelViewSwitch {
  view: PanelView
  compactPeopleStage: CompactPeopleStage | null
  shouldClearSelection: boolean
}

export interface PeoplePanelPersonSelection {
  selectedPersonId: string
  compactPeopleStage: CompactPeopleStage | null
}

export interface ResolvePeoplePanelPersonEditDraftCommitParams {
  selectedPersonName: string | null | undefined
}

export interface PeoplePanelPersonEditDraftCommit {
  renameDraft: string
  mergeTargetPersonId: string
  mergeTargetQuery: string
}

export interface PeoplePanelReadonlyMode {
  scope: PersonScope
  view: PanelView
}

export interface ResolvePeoplePanelPreferredPersonFocusParams {
  open: boolean
  preferredPersonId: string | null
  isCompact: boolean
}

export interface PeoplePanelPreferredPersonFocus {
  view: PanelView
  selectedPersonId: string
  compactPeopleStage: CompactPeopleStage | null
  shouldClearSelection: boolean
}

export interface ResolvePeoplePanelCompactEmptySelectionStageParams {
  isCompact: boolean
  open: boolean
  view: PanelView
  selectedPersonId: string | null
}

export interface ResolvePeoplePanelFacesLoadPlanParams {
  view: PanelView
  selectedPersonId: string | null
  readonly: boolean
  scope: PersonScope
}

export interface ResolvePeoplePanelFaceSelectionScopeCommitParams {
  open: boolean
  previousScopeKey: string | null
  nextScopeKey: string
}

export interface PeoplePanelFaceSelectionScopeCommit {
  nextPreviousScopeKey: string | null
  shouldClearSelection: boolean
}

export interface ResolvePeoplePanelPeopleListRefreshPlanParams {
  open: boolean
  view: PanelView
  query: string
}

export interface PeoplePanelPeopleListRefreshPlan {
  delayMs: number
}

export interface ResolvePeoplePanelRenderPlanParams {
  isCompact: boolean
  view: PanelView
  compactPeopleStage: CompactPeopleStage
  hasSelectedPerson: boolean
  readonly: boolean
}

export interface PeoplePanelRenderPlan {
  panelLayout: 'compact' | 'wide'
  viewTabsLayout: 'compact' | 'wide'
  showCompactPeopleList: boolean
  showCompactPeopleDetail: boolean
  showCompactReviewFaces: boolean
  showWidePeopleList: boolean
  showWidePersonTools: boolean
}

export type PeoplePanelFacesLoadPlan =
  | { kind: 'empty' }
  | { kind: 'person'; personId: string; scope: PersonScope }
  | { kind: 'review'; bucket: 'ignored' | 'unassigned'; scope: PersonScope; size: number }

export interface ResolvePeoplePanelRefreshedPeopleSelectionParams {
  previousSelectedPersonId: string | null
  people: PersonSummary[]
}

export interface ResolvePeoplePanelFaceSectionModelParams {
  layout: PeoplePanelFaceSectionLayout
  view: PanelView
  readonly: boolean
  selectedFaceCount: number
  faceCount: number
  assignmentInputKey: string
}

export interface PeoplePanelFaceSectionModel {
  title: string
  subtitle: string
  assignmentInputKey: string
  actionLayout: PeoplePanelFaceSectionActionLayout
  assignmentClassName: string | null
  compactGrid: boolean
}

export interface PeoplePanelFaceSectionState<TContext = unknown> {
  view: PanelView
  readonly: boolean
  context: TContext
  scope: PersonScope
  faces: FaceRecord[]
  selectedFaceIds: Set<string>
  selectedIds: string[]
  selectedFaces: FaceRecord[]
  excludedPersonIds: string[]
  assignmentInputKey: string
  isLoadingFaces: boolean
  isMutatingFaces: boolean
  isProjectingSources: boolean
}

export interface PeoplePanelPersonToolsState {
  scope: PersonScope
  renameDraft: string
  mergeTargetQuery: string
  mergeTargetCandidates: PersonSummary[]
  mergeTargetPersonId: string
  isSavingRename: boolean
  isMerging: boolean
}

export interface ResolvePeoplePanelPanelStateParams<TContext = unknown> {
  view: PanelView
  readonly: boolean
  context: TContext
  scope: PersonScope
  faces: FaceRecord[]
  selectedFaceIds: Set<string>
  selectedIds: string[]
  selectedFaces: FaceRecord[]
  assignmentExcludedPersonIds: string[]
  assignmentInputKey: string
  isLoadingFaces: boolean
  isMutatingFaces: boolean
  isProjectingSources: boolean
  renameDraft: string
  mergeTargetQuery: string
  mergeTargetCandidates: PersonSummary[]
  mergeTargetPersonId: string
  isSavingRename: boolean
  isMerging: boolean
}

export interface PeoplePanelPanelState<TContext = unknown> {
  faceSectionState: PeoplePanelFaceSectionState<TContext>
  personToolsState: PeoplePanelPersonToolsState
}

export function resolvePeoplePanelSelectionModel({
  people,
  allPeople,
  selectedPersonId,
  faces,
  selectedFaceIds,
  mergeTargetQuery,
  scope,
  view,
}: ResolvePeoplePanelSelectionModelParams): PeoplePanelSelectionModel {
  const selectedPerson = (
    people.find((person) => person.personId === selectedPersonId)
    ?? allPeople.find((person) => person.personId === selectedPersonId)
    ?? null
  )
  const selectedFaces = faces.filter((face) => selectedFaceIds.has(face.faceId))
  const query = mergeTargetQuery.trim().toLowerCase()
  const mergeTargetCandidates = allPeople
    .filter((person) => {
      if (person.personId === selectedPersonId) return false
      if (!query) return true
      return (
        getPersonDisplayName(person).toLowerCase().includes(query)
        || person.personId.toLowerCase().includes(query)
        || (person.featureAssetPath ?? '').toLowerCase().includes(query)
      )
    })
    .slice(0, 40)
  const selectedIds = [...selectedFaceIds]
  const faceSelectionScopeKey = `${scope}:${view}:${selectedPersonId ?? ''}`
  const assignmentInputKey = faceSelectionScopeKey

  return {
    selectedPerson,
    selectedFaces,
    mergeTargetCandidates,
    selectedIds,
    assignmentExcludedPersonIds: view === 'people' && selectedPersonId ? [selectedPersonId] : [],
    assignmentInputKey,
    faceSelectionScopeKey,
  }
}

export function resolvePeoplePanelPanelState<TContext = unknown>({
  view,
  readonly,
  context,
  scope,
  faces,
  selectedFaceIds,
  selectedIds,
  selectedFaces,
  assignmentExcludedPersonIds,
  assignmentInputKey,
  isLoadingFaces,
  isMutatingFaces,
  isProjectingSources,
  renameDraft,
  mergeTargetQuery,
  mergeTargetCandidates,
  mergeTargetPersonId,
  isSavingRename,
  isMerging,
}: ResolvePeoplePanelPanelStateParams<TContext>): PeoplePanelPanelState<TContext> {
  return {
    faceSectionState: {
      view,
      readonly,
      context,
      scope,
      faces,
      selectedFaceIds,
      selectedIds,
      selectedFaces,
      excludedPersonIds: assignmentExcludedPersonIds,
      assignmentInputKey,
      isLoadingFaces,
      isMutatingFaces,
      isProjectingSources,
    },
    personToolsState: {
      scope,
      renameDraft,
      mergeTargetQuery,
      mergeTargetCandidates,
      mergeTargetPersonId,
      isSavingRename,
      isMerging,
    },
  }
}

export function resolvePeoplePanelRenderPlan({
  isCompact,
  view,
  compactPeopleStage,
  hasSelectedPerson,
  readonly,
}: ResolvePeoplePanelRenderPlanParams): PeoplePanelRenderPlan {
  const showCompactPeopleList = isCompact && view === 'people' && compactPeopleStage === 'list'
  const showCompactPeopleDetail = isCompact && view === 'people' && compactPeopleStage === 'detail'

  return {
    panelLayout: isCompact ? 'compact' : 'wide',
    viewTabsLayout: isCompact ? 'compact' : 'wide',
    showCompactPeopleList,
    showCompactPeopleDetail,
    showCompactReviewFaces: isCompact && view !== 'people',
    showWidePeopleList: !isCompact && view === 'people',
    showWidePersonTools: !isCompact && view === 'people' && hasSelectedPerson && !readonly,
  }
}

export function resolvePeoplePanelViewSwitch(nextView: PanelView, isCompact: boolean): PeoplePanelViewSwitch {
  return {
    view: nextView,
    compactPeopleStage: isCompact ? (nextView === 'people' ? 'list' : 'detail') : null,
    shouldClearSelection: true,
  }
}

export function resolvePeoplePanelPersonSelection(
  personId: string,
  isCompact: boolean,
): PeoplePanelPersonSelection {
  return {
    selectedPersonId: personId,
    compactPeopleStage: isCompact ? 'detail' : null,
  }
}

export function resolvePeoplePanelListStage(isCompact: boolean): CompactPeopleStage | null {
  return isCompact ? 'list' : null
}

export function resolvePeoplePanelPersonEditDraftCommit({
  selectedPersonName,
}: ResolvePeoplePanelPersonEditDraftCommitParams): PeoplePanelPersonEditDraftCommit {
  return {
    renameDraft: selectedPersonName || '',
    mergeTargetPersonId: '',
    mergeTargetQuery: '',
  }
}

export function resolvePeoplePanelReadonlyMode(readonly: boolean): PeoplePanelReadonlyMode | null {
  if (!readonly) return null
  return {
    scope: 'root',
    view: 'people',
  }
}

export function resolvePeoplePanelPreferredPersonFocus({
  open,
  preferredPersonId,
  isCompact,
}: ResolvePeoplePanelPreferredPersonFocusParams): PeoplePanelPreferredPersonFocus | null {
  if (!open || !preferredPersonId) return null
  return {
    view: 'people',
    selectedPersonId: preferredPersonId,
    compactPeopleStage: isCompact ? 'detail' : null,
    shouldClearSelection: true,
  }
}

export function resolvePeoplePanelCompactEmptySelectionStage({
  isCompact,
  open,
  view,
  selectedPersonId,
}: ResolvePeoplePanelCompactEmptySelectionStageParams): CompactPeopleStage | null {
  if (!isCompact || !open || view !== 'people' || selectedPersonId) return null
  return 'list'
}

export function resolvePeoplePanelFacesLoadPlan({
  view,
  selectedPersonId,
  readonly,
  scope,
}: ResolvePeoplePanelFacesLoadPlanParams): PeoplePanelFacesLoadPlan {
  if (view === 'people') {
    if (!selectedPersonId) return { kind: 'empty' }
    return {
      kind: 'person',
      personId: selectedPersonId,
      scope,
    }
  }

  if (readonly) return { kind: 'empty' }

  return {
    kind: 'review',
    bucket: view === 'ignored' ? 'ignored' : 'unassigned',
    scope,
    size: 500,
  }
}

export function resolvePeoplePanelFaceSelectionScopeCommit({
  open,
  previousScopeKey,
  nextScopeKey,
}: ResolvePeoplePanelFaceSelectionScopeCommitParams): PeoplePanelFaceSelectionScopeCommit {
  if (!open || previousScopeKey === nextScopeKey) {
    return {
      nextPreviousScopeKey: previousScopeKey,
      shouldClearSelection: false,
    }
  }

  return {
    nextPreviousScopeKey: nextScopeKey,
    shouldClearSelection: true,
  }
}

export function resolvePeoplePanelPeopleListRefreshPlan({
  open,
  view,
  query,
}: ResolvePeoplePanelPeopleListRefreshPlanParams): PeoplePanelPeopleListRefreshPlan | null {
  if (!open || view !== 'people') return null
  return {
    delayMs: query.trim() ? 180 : 0,
  }
}

export function resolvePeoplePanelRefreshedPeopleSelection({
  previousSelectedPersonId,
  people,
}: ResolvePeoplePanelRefreshedPeopleSelectionParams): string | null {
  if (previousSelectedPersonId && people.some((item) => item.personId === previousSelectedPersonId)) {
    return previousSelectedPersonId
  }
  return people[0]?.personId ?? null
}

export function resolvePeoplePanelFaceSectionModel({
  layout,
  view,
  readonly,
  selectedFaceCount,
  faceCount,
  assignmentInputKey,
}: ResolvePeoplePanelFaceSectionModelParams): PeoplePanelFaceSectionModel {
  const isWide = layout === 'wide'
  return {
    title: faceSectionTitle(view),
    subtitle: readonly
      ? '双击人脸可打开来源文件'
      : `已选 ${selectedFaceCount} / 当前 ${faceCount}`,
    assignmentInputKey: `${layout}:${assignmentInputKey}`,
    actionLayout: isWide ? 'inline' : 'stacked',
    assignmentClassName: isWide ? 'max-w-[560px]' : null,
    compactGrid: !isWide,
  }
}

function faceSectionTitle(view: PanelView): string {
  if (view === 'people') return '人物详情'
  if (view === 'ignored') return '误检 / 忽略池'
  return '未归属池'
}
