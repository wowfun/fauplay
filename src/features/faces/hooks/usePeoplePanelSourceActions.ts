import { useCallback, useState } from 'react'
import type { FaceRecord } from '@/features/faces/types'
import {
  readPeoplePanelSourceActionNotice,
  type NoticeTone,
} from '@/features/faces/lib/peoplePanelText'

export interface UsePeoplePanelSourceActionsParams {
  selectedFaces: FaceRecord[]
  onOpenFaceSource?: (face: FaceRecord) => boolean | Promise<boolean>
  onProjectFaceSources?: (faces: FaceRecord[]) => boolean | Promise<boolean>
  setNotice: (notice: { tone: NoticeTone; message: string } | null) => void
}

export function usePeoplePanelSourceActions({
  selectedFaces,
  onOpenFaceSource,
  onProjectFaceSources,
  setNotice,
}: UsePeoplePanelSourceActionsParams) {
  const [isProjectingSources, setIsProjectingSources] = useState(false)

  const openFaceSource = useCallback(async (face: FaceRecord) => {
    if (!onOpenFaceSource) {
      setNotice(readPeoplePanelSourceActionNotice('open-source', 'unavailable'))
      return false
    }

    try {
      const opened = await onOpenFaceSource(face)
      if (!opened) {
        setNotice(readPeoplePanelSourceActionNotice('open-source', 'rejected'))
      }
      return opened
    } catch (error) {
      setNotice(readPeoplePanelSourceActionNotice('open-source', 'error', error))
      return false
    }
  }, [onOpenFaceSource, setNotice])

  const projectFaceSources = useCallback(async () => {
    if (selectedFaces.length === 0) return
    if (!onProjectFaceSources) {
      setNotice(readPeoplePanelSourceActionNotice('project-sources', 'unavailable'))
      return
    }

    setIsProjectingSources(true)
    setNotice(null)
    try {
      const projected = await onProjectFaceSources(selectedFaces)
      if (!projected) {
        setNotice(readPeoplePanelSourceActionNotice('project-sources', 'rejected'))
      }
    } catch (error) {
      setNotice(readPeoplePanelSourceActionNotice('project-sources', 'error', error))
    } finally {
      setIsProjectingSources(false)
    }
  }, [onProjectFaceSources, selectedFaces, setNotice])

  return {
    isProjectingSources,
    openFaceSource,
    projectFaceSources,
  }
}
