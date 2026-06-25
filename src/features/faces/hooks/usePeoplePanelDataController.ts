import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  listPeople,
  listPersonFaces,
  listReviewFaces,
  type FaceApiContext,
} from '@/features/faces/api'
import {
  loadPeoplePanelFaces,
  resolvePeoplePanelFacesLoadCommit,
  type PeoplePanelFacesLoaders,
} from '@/features/faces/lib/peoplePanelFacesLoad'
import {
  loadPeoplePanelAllPeople,
  loadPeoplePanelPeopleList,
  resolvePeoplePanelAllPeopleLoadCommit,
  resolvePeoplePanelPeopleListLoadCommit,
} from '@/features/faces/lib/peoplePanelPeopleLoad'
import { resolvePeoplePanelPeopleListRefreshPlan } from '@/features/faces/lib/peoplePanelModel'
import type { NoticeTone, PanelView } from '@/features/faces/lib/peoplePanelText'
import type { FaceRecord, PersonScope, PersonSummary } from '@/features/faces/types'

const peoplePanelFacesLoaders = {
  listPersonFaces,
  listReviewFaces,
} satisfies PeoplePanelFacesLoaders

interface UsePeoplePanelDataControllerParams {
  context: FaceApiContext
  open: boolean
  scope: PersonScope
  view: PanelView
  peopleQuery: string
  selectedPersonId: string | null
  readonly: boolean
  setSelectedPersonId: Dispatch<SetStateAction<string | null>>
  setNotice: Dispatch<SetStateAction<{ tone: NoticeTone; message: string } | null>>
}

export function usePeoplePanelDataController({
  context,
  open,
  scope,
  view,
  peopleQuery,
  selectedPersonId,
  readonly,
  setSelectedPersonId,
  setNotice,
}: UsePeoplePanelDataControllerParams) {
  const peopleListRequestIdRef = useRef(0)
  const [allPeople, setAllPeople] = useState<PersonSummary[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [faces, setFaces] = useState<FaceRecord[]>([])
  const [isLoadingPeople, setIsLoadingPeople] = useState(false)
  const [isLoadingFaces, setIsLoadingFaces] = useState(false)

  const loadAllPeople = useCallback(async () => {
    const result = await loadPeoplePanelAllPeople({
      context,
      scope,
      listPeople,
    })
    const commit = resolvePeoplePanelAllPeopleLoadCommit(result)
    if (commit.allPeople) {
      setAllPeople(commit.allPeople)
    }
    if (commit.notice) {
      setNotice(commit.notice)
    }
  }, [context, scope, setNotice])

  const loadPeopleList = useCallback(async (query = '') => {
    const requestId = ++peopleListRequestIdRef.current
    setIsLoadingPeople(true)
    const result = await loadPeoplePanelPeopleList({
      context,
      scope,
      query,
      listPeople,
    })
    if (requestId !== peopleListRequestIdRef.current) return

    const commit = resolvePeoplePanelPeopleListLoadCommit(result, {
      previousSelectedPersonId: null,
    })
    setPeople(commit.people)
    if (commit.notice) {
      setNotice(commit.notice)
    }
    setSelectedPersonId((previous) => {
      const selectionCommit = resolvePeoplePanelPeopleListLoadCommit(result, {
        previousSelectedPersonId: previous,
      })
      return selectionCommit.nextSelectedPersonId === undefined
        ? previous
        : selectionCommit.nextSelectedPersonId
    })
    setIsLoadingPeople(false)
  }, [context, scope, setNotice, setSelectedPersonId])

  const loadCurrentFaces = useCallback(async () => {
    setIsLoadingFaces(true)
    const result = await loadPeoplePanelFaces({
      context,
      view,
      selectedPersonId,
      readonly,
      scope,
      loaders: peoplePanelFacesLoaders,
    })
    const commit = resolvePeoplePanelFacesLoadCommit(result)
    setFaces(commit.faces)
    if (commit.notice) {
      setNotice(commit.notice)
    }
    setIsLoadingFaces(false)
  }, [context, readonly, scope, selectedPersonId, setNotice, view])

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      loadAllPeople(),
      loadPeopleList(peopleQuery),
      loadCurrentFaces(),
    ])
  }, [loadAllPeople, loadCurrentFaces, loadPeopleList, peopleQuery])

  useEffect(() => {
    const plan = resolvePeoplePanelPeopleListRefreshPlan({
      open,
      view,
      query: peopleQuery,
    })
    if (!plan) return
    const timeoutId = window.setTimeout(() => {
      void loadPeopleList(peopleQuery)
    }, plan.delayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadPeopleList, open, peopleQuery, view])

  useEffect(() => {
    if (!open) return
    void loadAllPeople()
  }, [loadAllPeople, open])

  useEffect(() => {
    if (!open) return
    void loadCurrentFaces()
  }, [loadCurrentFaces, open])

  return {
    allPeople,
    people,
    faces,
    isLoadingPeople,
    isLoadingFaces,
    setFaces,
    setIsLoadingFaces,
    loadAllPeople,
    loadPeopleList,
    refreshAll,
  }
}
