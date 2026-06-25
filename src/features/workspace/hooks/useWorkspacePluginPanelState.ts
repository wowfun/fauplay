import { useCallback, useEffect, useState } from 'react'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import {
  clampToolPanelWidthPx,
  createEmptyPluginResultQueueState,
  createPluginWorkbenchState,
  DEFAULT_TOOL_PANEL_WIDTH_PX,
  readSameDurationScopeFromWorkbenchState,
  type SameDurationScope,
} from '@/features/workspace/lib/pluginPanelStateModel'

const WORKSPACE_TOOL_PANEL_COLLAPSED_STORAGE_KEY = 'fauplay:workspace-tool-panel-collapsed'
const PREVIEW_TOOL_PANEL_COLLAPSED_STORAGE_KEY = 'fauplay:preview-tool-panel-collapsed'
const WORKSPACE_TOOL_PANEL_WIDTH_STORAGE_KEY = 'fauplay:workspace-tool-panel-width'
const PREVIEW_TOOL_PANEL_WIDTH_STORAGE_KEY = 'fauplay:preview-tool-panel-width'
const SAME_DURATION_SCOPE_STORAGE_KEY = 'fauplay:media-search-same-duration-scope'

function readPersistedBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue

  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return defaultValue
    if (raw === 'true') return true
    if (raw === 'false') return false

    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'boolean' ? parsed : defaultValue
  } catch {
    return defaultValue
  }
}

function writePersistedBoolean(key: string, value: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

function readPersistedToolPanelWidthPx(key: string): number {
  if (typeof window === 'undefined') return DEFAULT_TOOL_PANEL_WIDTH_PX

  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return DEFAULT_TOOL_PANEL_WIDTH_PX

    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return DEFAULT_TOOL_PANEL_WIDTH_PX
    return clampToolPanelWidthPx(parsed)
  } catch {
    return DEFAULT_TOOL_PANEL_WIDTH_PX
  }
}

function writePersistedToolPanelWidthPx(key: string, value: number): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, String(clampToolPanelWidthPx(value)))
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

function readPersistedSameDurationScope(): SameDurationScope | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SAME_DURATION_SCOPE_STORAGE_KEY)
    if (raw === 'global' || raw === 'root') return raw
    return null
  } catch {
    return null
  }
}

function writePersistedSameDurationScope(value: SameDurationScope): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SAME_DURATION_SCOPE_STORAGE_KEY, value)
  } catch {
    // Ignore storage write failures and keep runtime state available.
  }
}

export function useWorkspacePluginPanelState() {
  const [previewPluginResultQueueState, setPreviewPluginResultQueueState] = useState<PluginResultQueueState>(
    createEmptyPluginResultQueueState,
  )
  const [previewPluginWorkbenchState, setPreviewPluginWorkbenchState] = useState<PluginWorkbenchState>(() => (
    createPluginWorkbenchState(readPersistedSameDurationScope())
  ))
  const [workspacePluginResultQueueState, setWorkspacePluginResultQueueState] = useState<PluginResultQueueState>(
    createEmptyPluginResultQueueState,
  )
  const [workspacePluginWorkbenchState, setWorkspacePluginWorkbenchState] = useState<PluginWorkbenchState>(
    createPluginWorkbenchState,
  )
  const [workspaceToolPanelCollapsed, setWorkspaceToolPanelCollapsed] = useState<boolean>(() => (
    readPersistedBoolean(WORKSPACE_TOOL_PANEL_COLLAPSED_STORAGE_KEY, false)
  ))
  const [previewToolPanelCollapsed, setPreviewToolPanelCollapsed] = useState<boolean>(() => (
    readPersistedBoolean(PREVIEW_TOOL_PANEL_COLLAPSED_STORAGE_KEY, false)
  ))
  const [workspaceToolPanelWidthPx, setWorkspaceToolPanelWidthPx] = useState<number>(() => (
    readPersistedToolPanelWidthPx(WORKSPACE_TOOL_PANEL_WIDTH_STORAGE_KEY)
  ))
  const [previewToolPanelWidthPx, setPreviewToolPanelWidthPx] = useState<number>(() => (
    readPersistedToolPanelWidthPx(PREVIEW_TOOL_PANEL_WIDTH_STORAGE_KEY)
  ))

  const toggleWorkspaceToolPanelCollapsed = useCallback(() => {
    setWorkspaceToolPanelCollapsed((previous) => !previous)
  }, [])

  const togglePreviewToolPanelCollapsed = useCallback(() => {
    setPreviewToolPanelCollapsed((previous) => !previous)
  }, [])

  const updateWorkspaceToolPanelWidth = useCallback((nextWidthPx: number) => {
    setWorkspaceToolPanelWidthPx(clampToolPanelWidthPx(nextWidthPx))
  }, [])

  const updatePreviewToolPanelWidth = useCallback((nextWidthPx: number) => {
    setPreviewToolPanelWidthPx(clampToolPanelWidthPx(nextWidthPx))
  }, [])

  useEffect(() => {
    writePersistedBoolean(WORKSPACE_TOOL_PANEL_COLLAPSED_STORAGE_KEY, workspaceToolPanelCollapsed)
  }, [workspaceToolPanelCollapsed])

  useEffect(() => {
    writePersistedBoolean(PREVIEW_TOOL_PANEL_COLLAPSED_STORAGE_KEY, previewToolPanelCollapsed)
  }, [previewToolPanelCollapsed])

  useEffect(() => {
    writePersistedToolPanelWidthPx(WORKSPACE_TOOL_PANEL_WIDTH_STORAGE_KEY, workspaceToolPanelWidthPx)
  }, [workspaceToolPanelWidthPx])

  useEffect(() => {
    writePersistedToolPanelWidthPx(PREVIEW_TOOL_PANEL_WIDTH_STORAGE_KEY, previewToolPanelWidthPx)
  }, [previewToolPanelWidthPx])

  useEffect(() => {
    const scopeValue = readSameDurationScopeFromWorkbenchState(previewPluginWorkbenchState)
    if (scopeValue) {
      writePersistedSameDurationScope(scopeValue)
    }
  }, [previewPluginWorkbenchState])

  return {
    previewPluginResultQueueState,
    setPreviewPluginResultQueueState,
    previewPluginWorkbenchState,
    setPreviewPluginWorkbenchState,
    workspacePluginResultQueueState,
    setWorkspacePluginResultQueueState,
    workspacePluginWorkbenchState,
    setWorkspacePluginWorkbenchState,
    workspaceToolPanelCollapsed,
    toggleWorkspaceToolPanelCollapsed,
    workspaceToolPanelWidthPx,
    updateWorkspaceToolPanelWidth,
    previewToolPanelCollapsed,
    togglePreviewToolPanelCollapsed,
    previewToolPanelWidthPx,
    updatePreviewToolPanelWidth,
  }
}
