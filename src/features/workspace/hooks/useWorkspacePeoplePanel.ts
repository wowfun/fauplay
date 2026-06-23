import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FaceRecord } from '@/features/faces/types'
import {
  buildFaceSourceProjection,
  getFaceSourceParentPath,
  normalizeCurrentRootFaceSourcePath,
} from '@/features/workspace/lib/faceSourceProjection'
import {
  normalizeRootRelativePath,
  type WorkspaceActiveSurface,
} from '@/features/workspace/lib/projectionTabs'
import { fromRemoteUiRootId } from '@/lib/accessState'
import { getBoundRootPath } from '@/lib/reveal'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { FileItem, ResultProjection } from '@/types'

type WorkspaceAccessProvider = 'local-browser' | 'remote-readonly'

interface UseWorkspacePeoplePanelParams {
  accessProvider: WorkspaceAccessProvider
  rootId: string
  currentPath: string
  pluginTools: GatewayToolDescriptor[]
  activeSurface: WorkspaceActiveSurface
  activeSurfaceFiles: FileItem[]
  filteredFiles: FileItem[]
  navigateToPath: (targetPath: string, options?: { resetFlattenView?: boolean }) => Promise<boolean>
  setActiveSurface: (surface: WorkspaceActiveSurface) => void
  setDirectoryFocusedPath: (path: string | null) => void
  openFileInPrimaryTarget: (file: FileItem) => void
  activateProjection: (projection: ResultProjection) => void
}

interface WorkspacePeoplePanelState {
  canOpenPeople: boolean
  showPeoplePanel: boolean
  peoplePanelPreferredPersonId: string | null
  openPeople: () => void
  openPeopleForPerson: (personId: string | null) => void
  closePeople: () => void
  openFaceSource: (face: FaceRecord) => Promise<boolean>
  projectFaceSources: (selectedFaces: FaceRecord[]) => boolean
}

export function useWorkspacePeoplePanel({
  accessProvider,
  rootId,
  currentPath,
  pluginTools,
  activeSurface,
  activeSurfaceFiles,
  filteredFiles,
  navigateToPath,
  setActiveSurface,
  setDirectoryFocusedPath,
  openFileInPrimaryTarget,
  activateProjection,
}: UseWorkspacePeoplePanelParams): WorkspacePeoplePanelState {
  const [showPeoplePanel, setShowPeoplePanel] = useState(false)
  const [peoplePanelPreferredPersonId, setPeoplePanelPreferredPersonId] = useState<string | null>(null)
  const [pendingFaceSourcePath, setPendingFaceSourcePath] = useState<string | null>(null)

  const canOpenPeople = useMemo(() => (
    accessProvider === 'remote-readonly'
      ? true
      : pluginTools.some((tool) => tool.name === 'vision.face' && tool.scopes.includes('workspace'))
  ), [accessProvider, pluginTools])

  const remoteRootId = useMemo(
    () => (accessProvider === 'remote-readonly' ? fromRemoteUiRootId(rootId) : null),
    [accessProvider, rootId],
  )

  const openPeople = useCallback(() => {
    if (!canOpenPeople) return
    setPeoplePanelPreferredPersonId(null)
    setShowPeoplePanel(true)
  }, [canOpenPeople])

  const openPeopleForPerson = useCallback((personId: string | null) => {
    if (!canOpenPeople) return
    setPeoplePanelPreferredPersonId(personId)
    setShowPeoplePanel(true)
  }, [canOpenPeople])

  const closePeople = useCallback(() => {
    setShowPeoplePanel(false)
  }, [])

  const openFaceSource = useCallback(async (face: FaceRecord): Promise<boolean> => {
    const sourcePath = normalizeCurrentRootFaceSourcePath(face.assetPath)
    if (!sourcePath) return false

    setPendingFaceSourcePath(sourcePath)

    const parentPath = getFaceSourceParentPath(sourcePath)
    if (normalizeRootRelativePath(currentPath) === parentPath) {
      setActiveSurface({ kind: 'directory' })
      setDirectoryFocusedPath(sourcePath)
      return true
    }

    const navigated = await navigateToPath(parentPath, { resetFlattenView: true })
    if (!navigated) {
      setPendingFaceSourcePath((previous) => (previous === sourcePath ? null : previous))
      return false
    }
    setActiveSurface({ kind: 'directory' })
    setDirectoryFocusedPath(sourcePath)
    return true
  }, [
    currentPath,
    navigateToPath,
    setActiveSurface,
    setDirectoryFocusedPath,
  ])

  useEffect(() => {
    if (activeSurface.kind !== 'directory') return
    if (!pendingFaceSourcePath) return

    const normalizedSourcePath = normalizeRootRelativePath(pendingFaceSourcePath)
    const sourceFile = filteredFiles.find((file) => (
      file.kind === 'file' && normalizeRootRelativePath(file.path) === normalizedSourcePath
    )) ?? null

    if (!sourceFile) return

    openFileInPrimaryTarget(sourceFile)
    setPendingFaceSourcePath((previous) => (previous === normalizedSourcePath ? null : previous))
  }, [
    activeSurface,
    filteredFiles,
    openFileInPrimaryTarget,
    pendingFaceSourcePath,
  ])

  const projectFaceSources = useCallback((selectedFaces: FaceRecord[]): boolean => {
    const projection = buildFaceSourceProjection({
      selectedFaces,
      activeSurfaceFiles,
      filteredFiles,
      boundRootPath: getBoundRootPath(rootId),
      remoteRootId,
    })
    if (!projection) return false

    activateProjection(projection)
    setShowPeoplePanel(false)
    return true
  }, [activeSurfaceFiles, activateProjection, filteredFiles, remoteRootId, rootId])

  return {
    canOpenPeople,
    showPeoplePanel,
    peoplePanelPreferredPersonId,
    openPeople,
    openPeopleForPerson,
    closePeople,
    openFaceSource,
    projectFaceSources,
  }
}
