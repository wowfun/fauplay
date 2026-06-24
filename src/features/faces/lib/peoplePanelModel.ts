import type { FaceRecord, PersonScope, PersonSummary } from '../types.ts'
import { getPersonDisplayName } from '../utils/personDisplayName.ts'
import type { PanelView } from './peoplePanelText.ts'

export type CompactPeopleStage = 'list' | 'detail'

export interface ResolvePeoplePanelSelectionModelParams {
  people: PersonSummary[]
  allPeople: PersonSummary[]
  selectedPersonId: string | null
  faces: FaceRecord[]
  selectedFaceIds: Set<string>
  mergeTargetQuery: string
  scope: PersonScope
  view: PanelView
  isCompact: boolean
  compactPeopleStage: CompactPeopleStage
}

export interface PeoplePanelSelectionModel {
  selectedPerson: PersonSummary | null
  selectedFaces: FaceRecord[]
  mergeTargetCandidates: PersonSummary[]
  selectedIds: string[]
  assignmentExcludedPersonIds: string[]
  assignmentInputKey: string
  faceSelectionScopeKey: string
  showCompactPeopleList: boolean
  showCompactPeopleDetail: boolean
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
  isCompact,
  compactPeopleStage,
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
    showCompactPeopleList: isCompact && view === 'people' && compactPeopleStage === 'list',
    showCompactPeopleDetail: isCompact && view === 'people' && compactPeopleStage === 'detail',
  }
}
