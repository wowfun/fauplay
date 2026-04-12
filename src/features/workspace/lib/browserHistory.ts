import type { AccessProvider } from '@/lib/accessState'

export type WorkspacePreviewSurface = 'pane' | 'lightbox'

export interface WorkspaceBrowserHistorySnapshot {
  accessProvider: AccessProvider
  rootId: string
  path: string
  previewPath: string | null
  previewSurface: WorkspacePreviewSurface | null
}

interface WorkspaceBrowserHistoryState extends WorkspaceBrowserHistorySnapshot {
  kind: 'fauplay:workspace-history'
  version: 1
}

const WORKSPACE_QUERY_PARAM = 'workspace'
const ROOT_QUERY_PARAM = 'root'
const PATH_QUERY_PARAM = 'path'
const PREVIEW_QUERY_PARAM = 'preview'
const SURFACE_QUERY_PARAM = 'surface'
const WORKSPACE_HISTORY_STATE_KIND = 'fauplay:workspace-history'
const WORKSPACE_HISTORY_STATE_VERSION = 1

function normalizeRelativePath(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.split('/').filter(Boolean).join('/')
}

function normalizePreviewSurface(value: unknown): WorkspacePreviewSurface | null {
  return value === 'pane' || value === 'lightbox' ? value : null
}

export function normalizeWorkspaceBrowserHistorySnapshot(
  value: Partial<WorkspaceBrowserHistorySnapshot> | null | undefined,
): WorkspaceBrowserHistorySnapshot | null {
  if (!value) return null
  const accessProvider = value.accessProvider
  if (accessProvider !== 'local-browser' && accessProvider !== 'remote-readonly') {
    return null
  }

  const rootId = typeof value.rootId === 'string' ? value.rootId.trim() : ''
  if (!rootId) {
    return null
  }

  const path = normalizeRelativePath(value.path)
  const previewPath = normalizeRelativePath(value.previewPath || '') || null
  const previewSurface = previewPath
    ? (normalizePreviewSurface(value.previewSurface) ?? 'lightbox')
    : null

  return {
    accessProvider,
    rootId,
    path,
    previewPath,
    previewSurface,
  }
}

export function serializeWorkspaceBrowserHistorySnapshot(
  snapshot: WorkspaceBrowserHistorySnapshot,
): string {
  return [
    snapshot.accessProvider,
    snapshot.rootId,
    snapshot.path,
    snapshot.previewPath ?? '',
    snapshot.previewSurface ?? '',
  ].join('\u0000')
}

export function areWorkspaceBrowserHistorySnapshotsEqual(
  left: WorkspaceBrowserHistorySnapshot,
  right: WorkspaceBrowserHistorySnapshot,
): boolean {
  return serializeWorkspaceBrowserHistorySnapshot(left) === serializeWorkspaceBrowserHistorySnapshot(right)
}

export function createWorkspaceBrowserHistoryState(
  snapshot: WorkspaceBrowserHistorySnapshot,
): WorkspaceBrowserHistoryState {
  return {
    kind: WORKSPACE_HISTORY_STATE_KIND,
    version: WORKSPACE_HISTORY_STATE_VERSION,
    ...snapshot,
  }
}

export function parseWorkspaceBrowserHistorySnapshotFromState(
  value: unknown,
): WorkspaceBrowserHistorySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as Partial<WorkspaceBrowserHistoryState>
  if (
    candidate.kind !== WORKSPACE_HISTORY_STATE_KIND
    || candidate.version !== WORKSPACE_HISTORY_STATE_VERSION
  ) {
    return null
  }

  return normalizeWorkspaceBrowserHistorySnapshot(candidate)
}

export function parseWorkspaceBrowserHistorySnapshotFromUrl(
  search: string,
): WorkspaceBrowserHistorySnapshot | null {
  const params = new URLSearchParams(search)
  return normalizeWorkspaceBrowserHistorySnapshot({
    accessProvider: (params.get(WORKSPACE_QUERY_PARAM) ?? undefined) as AccessProvider | undefined,
    rootId: params.get(ROOT_QUERY_PARAM) ?? '',
    path: params.get(PATH_QUERY_PARAM) ?? '',
    previewPath: params.get(PREVIEW_QUERY_PARAM),
    previewSurface: params.get(SURFACE_QUERY_PARAM) as WorkspacePreviewSurface | null,
  })
}

function applyWorkspaceBrowserHistoryParams(
  url: URL,
  snapshot: WorkspaceBrowserHistorySnapshot | null,
): URL {
  url.searchParams.delete(WORKSPACE_QUERY_PARAM)
  url.searchParams.delete(ROOT_QUERY_PARAM)
  url.searchParams.delete(PATH_QUERY_PARAM)
  url.searchParams.delete(PREVIEW_QUERY_PARAM)
  url.searchParams.delete(SURFACE_QUERY_PARAM)

  if (snapshot) {
    url.searchParams.set(WORKSPACE_QUERY_PARAM, snapshot.accessProvider)
    url.searchParams.set(ROOT_QUERY_PARAM, snapshot.rootId)
    if (snapshot.path) {
      url.searchParams.set(PATH_QUERY_PARAM, snapshot.path)
    }
    if (snapshot.previewPath) {
      url.searchParams.set(PREVIEW_QUERY_PARAM, snapshot.previewPath)
    }
    if (snapshot.previewSurface) {
      url.searchParams.set(SURFACE_QUERY_PARAM, snapshot.previewSurface)
    }
  }

  return url
}

export function buildWorkspaceBrowserHistoryUrl(
  currentUrl: string,
  snapshot: WorkspaceBrowserHistorySnapshot,
): string {
  const url = applyWorkspaceBrowserHistoryParams(new URL(currentUrl), snapshot)
  return `${url.pathname}${url.search}${url.hash}`
}

export function clearWorkspaceBrowserHistoryUrl(currentUrl: string): string {
  const url = applyWorkspaceBrowserHistoryParams(new URL(currentUrl), null)
  return `${url.pathname}${url.search}${url.hash}`
}
