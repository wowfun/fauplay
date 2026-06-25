import type { DuplicateSelectionRule } from './duplicateSelection.ts'
import type { WorkspaceActiveSurface } from './projectionTabRecords.ts'
import type { FileItem, ResultProjection } from '../../../types/index.ts'

export interface ResolveWorkspaceProjectionViewModelParams {
  projectionTabs: ResultProjection[]
  activeProjectionTabId: string | null
  activeSurface: WorkspaceActiveSurface
  filteredFiles: FileItem[]
  directorySelectedPaths: string[]
  projectionSelectedPathsById: Record<string, string[]>
  duplicateSelectionRuleByProjectionId: Record<string, DuplicateSelectionRule | null>
}

export interface WorkspaceProjectionViewModel {
  activeProjectionTab: ResultProjection | null
  activeSurfaceProjection: ResultProjection | null
  activeSurfaceFiles: FileItem[]
  activeSurfaceFileItems: FileItem[]
  isDirectorySurfaceActive: boolean
  projectionGridSelectedPaths: string[]
  activeDuplicateSelectionRule: DuplicateSelectionRule | null
  activeSurfaceSelectedPaths: string[]
}

export function resolveWorkspaceProjectionViewModel({
  projectionTabs,
  activeProjectionTabId,
  activeSurface,
  filteredFiles,
  directorySelectedPaths,
  projectionSelectedPathsById,
  duplicateSelectionRuleByProjectionId,
}: ResolveWorkspaceProjectionViewModelParams): WorkspaceProjectionViewModel {
  const activeProjectionTab = (
    projectionTabs.find((projection) => projection.id === activeProjectionTabId)
    ?? projectionTabs[0]
    ?? null
  )
  const activeSurfaceProjection = activeSurface.kind === 'projection'
    ? projectionTabs.find((projection) => projection.id === activeSurface.tabId) ?? null
    : null
  const activeSurfaceFiles = activeSurfaceProjection?.files ?? filteredFiles
  const activeSurfaceFileItems = activeSurfaceFiles.filter((file): file is FileItem => file.kind === 'file')
  const projectionGridSelectedPaths = activeProjectionTab?.id
    ? projectionSelectedPathsById[activeProjectionTab.id] ?? []
    : []
  const activeDuplicateSelectionRule = activeProjectionTab?.id
    ? duplicateSelectionRuleByProjectionId[activeProjectionTab.id] ?? null
    : null
  const activeSurfaceSelectedPaths = activeSurface.kind === 'projection'
    ? projectionSelectedPathsById[activeSurface.tabId] ?? []
    : directorySelectedPaths

  return {
    activeProjectionTab,
    activeSurfaceProjection,
    activeSurfaceFiles,
    activeSurfaceFileItems,
    isDirectorySurfaceActive: activeSurface.kind === 'directory',
    projectionGridSelectedPaths,
    activeDuplicateSelectionRule,
    activeSurfaceSelectedPaths,
  }
}
