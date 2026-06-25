import { useCallback, useState } from 'react'
import {
  listPersonFaces,
  mergePeople,
  renamePerson,
  type FaceApiContext,
} from '@/features/faces/api'
import type { FaceRecord, PersonScope, PersonSummary } from '@/features/faces/types'
import {
  readPeoplePanelPersonEditNotice,
  type NoticeTone,
} from '@/features/faces/lib/peoplePanelText'

export interface UsePeoplePanelPersonEditControllerParams {
  context: FaceApiContext
  selectedPerson: PersonSummary | null
  renameDraft: string
  mergeTargetPersonId: string
  scope: PersonScope
  loadAllPeople: () => Promise<void>
  loadPeopleList: (query?: string) => Promise<void>
  setFaces: (faces: FaceRecord[]) => void
  setIsLoadingFaces: (isLoading: boolean) => void
  setMergeTargetPersonId: (personId: string) => void
  setMergeTargetQuery: (query: string) => void
  setPeopleQuery: (query: string) => void
  setSelectedPersonId: (personId: string | null) => void
  setNotice: (notice: { tone: NoticeTone; message: string } | null) => void
}

export function usePeoplePanelPersonEditController({
  context,
  selectedPerson,
  renameDraft,
  mergeTargetPersonId,
  scope,
  loadAllPeople,
  loadPeopleList,
  setFaces,
  setIsLoadingFaces,
  setMergeTargetPersonId,
  setMergeTargetQuery,
  setPeopleQuery,
  setSelectedPersonId,
  setNotice,
}: UsePeoplePanelPersonEditControllerParams) {
  const [isSavingRename, setIsSavingRename] = useState(false)
  const [isMerging, setIsMerging] = useState(false)

  const saveRename = useCallback(async () => {
    if (!selectedPerson) return false
    const nextName = renameDraft.trim()
    if (nextName === selectedPerson.name) return false

    setIsSavingRename(true)
    setNotice(null)
    try {
      await renamePerson(context, {
        personId: selectedPerson.personId,
        name: nextName,
      })
      setNotice(readPeoplePanelPersonEditNotice('rename-person', 'success'))
      await Promise.allSettled([loadAllPeople(), loadPeopleList()])
      return true
    } catch (error) {
      setNotice(readPeoplePanelPersonEditNotice('rename-person', 'error', error))
      return false
    } finally {
      setIsSavingRename(false)
    }
  }, [context, loadAllPeople, loadPeopleList, renameDraft, selectedPerson, setNotice])

  const mergeSelectedPerson = useCallback(async () => {
    if (!selectedPerson || !mergeTargetPersonId || selectedPerson.personId === mergeTargetPersonId) {
      return false
    }

    const sourcePersonId = selectedPerson.personId
    const targetPersonId = mergeTargetPersonId

    setIsMerging(true)
    setNotice(null)
    try {
      await mergePeople(context, {
        targetPersonId,
        sourcePersonIds: [sourcePersonId],
      })
      setNotice(readPeoplePanelPersonEditNotice('merge-person', 'success'))
      setMergeTargetPersonId('')
      setMergeTargetQuery('')
      setPeopleQuery('')
      setSelectedPersonId(targetPersonId)
      setIsLoadingFaces(true)
      const loadTargetFaces = listPersonFaces(context, {
        personId: targetPersonId,
        scope,
      })
        .then((items) => {
          setFaces(items)
        })
        .catch((error) => {
          setFaces([])
          setNotice(readPeoplePanelPersonEditNotice('load-merged-person-faces', 'error', error))
        })
        .finally(() => {
          setIsLoadingFaces(false)
        })
      await Promise.allSettled([
        loadAllPeople(),
        loadPeopleList(''),
        loadTargetFaces,
      ])
      return true
    } catch (error) {
      setNotice(readPeoplePanelPersonEditNotice('merge-person', 'error', error))
      return false
    } finally {
      setIsMerging(false)
    }
  }, [
    context,
    loadAllPeople,
    loadPeopleList,
    mergeTargetPersonId,
    scope,
    selectedPerson,
    setFaces,
    setIsLoadingFaces,
    setMergeTargetPersonId,
    setMergeTargetQuery,
    setNotice,
    setPeopleQuery,
    setSelectedPersonId,
  ])

  return {
    isSavingRename,
    isMerging,
    saveRename,
    mergeSelectedPerson,
  }
}
