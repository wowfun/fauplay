import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  type CompactPeopleStage,
  resolvePeoplePanelCompactEmptySelectionStage,
  resolvePeoplePanelFaceSelectionScopeCommit,
  resolvePeoplePanelListStage,
  resolvePeoplePanelPersonSelection,
  resolvePeoplePanelPreferredPersonFocus,
  resolvePeoplePanelReadonlyMode,
  resolvePeoplePanelViewSwitch,
} from '@/features/faces/lib/peoplePanelModel'
import type { PanelView } from '@/features/faces/lib/peoplePanelText'
import type { PersonScope } from '@/features/faces/types'

interface UsePeoplePanelViewControllerParams {
  open: boolean
  readonly: boolean
  preferredPersonId: string | null
  isCompact: boolean
}

export function usePeoplePanelViewController({
  open,
  readonly,
  preferredPersonId,
  isCompact,
}: UsePeoplePanelViewControllerParams) {
  const [scope, setScope] = useState<PersonScope>(readonly ? 'root' : 'global')
  const [view, setView] = useState<PanelView>('people')
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [selectedFaceIds, setSelectedFaceIds] = useState<Set<string>>(new Set())
  const [compactPeopleStage, setCompactPeopleStage] = useState<CompactPeopleStage>('list')
  const previousFaceSelectionScopeKeyRef = useRef<string | null>(null)
  const faceSelectionScopeKey = `${scope}:${view}:${selectedPersonId ?? ''}`

  const clearSelection = useCallback(() => {
    setSelectedFaceIds(new Set())
  }, [])

  useEffect(() => {
    const readonlyMode = resolvePeoplePanelReadonlyMode(readonly)
    if (!readonlyMode) return
    setScope(readonlyMode.scope)
    setView(readonlyMode.view)
  }, [readonly])

  useEffect(() => {
    const commit = resolvePeoplePanelFaceSelectionScopeCommit({
      open,
      previousScopeKey: previousFaceSelectionScopeKeyRef.current,
      nextScopeKey: faceSelectionScopeKey,
    })
    previousFaceSelectionScopeKeyRef.current = commit.nextPreviousScopeKey
    if (commit.shouldClearSelection) {
      clearSelection()
    }
  }, [clearSelection, faceSelectionScopeKey, open])

  useEffect(() => {
    const focus = resolvePeoplePanelPreferredPersonFocus({
      open,
      preferredPersonId,
      isCompact,
    })
    if (!focus) return
    setView(focus.view)
    if (focus.shouldClearSelection) clearSelection()
    setSelectedPersonId(focus.selectedPersonId)
    if (focus.compactPeopleStage) setCompactPeopleStage(focus.compactPeopleStage)
  }, [clearSelection, isCompact, open, preferredPersonId])

  useEffect(() => {
    const nextStage = resolvePeoplePanelCompactEmptySelectionStage({
      isCompact,
      open,
      view,
      selectedPersonId,
    })
    if (!nextStage) return
    setCompactPeopleStage(nextStage)
  }, [isCompact, open, selectedPersonId, view])

  const handleFaceSelectionChange = useCallback((faceIds: string[]) => {
    setSelectedFaceIds(new Set(faceIds))
  }, [])

  const handleSelectPerson = useCallback((personId: string) => {
    const selection = resolvePeoplePanelPersonSelection(personId, isCompact)
    setSelectedPersonId(selection.selectedPersonId)
    if (selection.compactPeopleStage) setCompactPeopleStage(selection.compactPeopleStage)
  }, [isCompact])

  const handleShowPeopleList = useCallback(() => {
    const nextStage = resolvePeoplePanelListStage(isCompact)
    if (!nextStage) return
    setCompactPeopleStage(nextStage)
  }, [isCompact])

  const handleSwitchView = useCallback((nextView: PanelView) => {
    const transition = resolvePeoplePanelViewSwitch(nextView, isCompact)
    setView(transition.view)
    if (transition.shouldClearSelection) clearSelection()
    if (transition.compactPeopleStage) setCompactPeopleStage(transition.compactPeopleStage)
  }, [clearSelection, isCompact])

  return {
    scope,
    setScope,
    view,
    selectedPersonId,
    setSelectedPersonId,
    selectedFaceIds,
    compactPeopleStage,
    clearSelection,
    handleFaceSelectionChange,
    handleSelectPerson,
    handleShowPeopleList,
    handleSwitchView,
  }
}
