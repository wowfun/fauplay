import { useCallback, useState } from 'react'
import {
  assignFaces,
  createPersonFromFaces,
  ignoreFaces,
  requeueFaces,
  restoreIgnoredFaces,
  unassignFaces,
  type FaceApiContext,
} from '@/features/faces/api'
import type { FaceMutationResult } from '@/features/faces/types'
import {
  readFaceMutationResultMessage,
  type NoticeTone,
} from '@/features/faces/lib/peoplePanelText'

export interface UsePeoplePanelFaceMutationControllerParams {
  context: FaceApiContext
  selectedFaceIds: Set<string>
  selectedIds: string[]
  clearSelection: () => void
  refreshAll: () => Promise<void>
  setNotice: (notice: { tone: NoticeTone; message: string } | null) => void
}

export function usePeoplePanelFaceMutationController({
  context,
  selectedFaceIds,
  selectedIds,
  clearSelection,
  refreshAll,
  setNotice,
}: UsePeoplePanelFaceMutationControllerParams) {
  const [isMutatingFaces, setIsMutatingFaces] = useState(false)

  const runFaceMutation = useCallback(async (task: () => Promise<FaceMutationResult>) => {
    if (selectedFaceIds.size === 0) return false
    setIsMutatingFaces(true)
    setNotice(null)
    try {
      const result = await task()
      setNotice(readFaceMutationResultMessage(result))
      clearSelection()
      await refreshAll()
      return true
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '人脸纠错失败',
      })
      return false
    } finally {
      setIsMutatingFaces(false)
    }
  }, [clearSelection, refreshAll, selectedFaceIds.size, setNotice])

  const assignSelectedFaces = useCallback(async (personId: string) => {
    if (selectedIds.length === 0) return false
    return runFaceMutation(() => assignFaces(context, {
      faceIds: selectedIds,
      targetPersonId: personId,
    }))
  }, [context, runFaceMutation, selectedIds])

  const createPersonForSelectedFaces = useCallback(async (name: string) => {
    if (selectedIds.length === 0) return false
    return runFaceMutation(() => createPersonFromFaces(context, {
      faceIds: selectedIds,
      name,
    }))
  }, [context, runFaceMutation, selectedIds])

  const unassignSelectedFaces = useCallback(async () => {
    return runFaceMutation(() => unassignFaces(context, {
      faceIds: selectedIds,
    }))
  }, [context, runFaceMutation, selectedIds])

  const ignoreSelectedFaces = useCallback(async () => {
    return runFaceMutation(() => ignoreFaces(context, {
      faceIds: selectedIds,
    }))
  }, [context, runFaceMutation, selectedIds])

  const restoreIgnoredFacesForSelection = useCallback(async () => {
    return runFaceMutation(() => restoreIgnoredFaces(context, {
      faceIds: selectedIds,
    }))
  }, [context, runFaceMutation, selectedIds])

  const requeueSelectedFaces = useCallback(async () => {
    return runFaceMutation(() => requeueFaces(context, {
      faceIds: selectedIds,
    }))
  }, [context, runFaceMutation, selectedIds])

  return {
    isMutatingFaces,
    assignSelectedFaces,
    createPersonForSelectedFaces,
    unassignSelectedFaces,
    ignoreSelectedFaces,
    restoreIgnoredFacesForSelection,
    requeueSelectedFaces,
  }
}
