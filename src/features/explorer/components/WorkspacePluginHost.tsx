import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { FileItem, ResultProjection } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { DispatchSystemToolResult } from '@/lib/actionDispatcher'
import { withToolScopedProjection } from '@/lib/projection'
import { readDeleteUndoRestoreItems } from '@/features/workspace/lib/deleteUndo'
import { PluginActionRail } from '@/features/plugin-runtime/components/PluginActionRail'
import { PluginToolResultPanel } from '@/features/plugin-runtime/components/PluginToolResultPanel'
import { PluginToolWorkbench } from '@/features/plugin-runtime/components/PluginToolWorkbench'
import type { WorkspaceMutationCommitParams } from '@/features/workspace/types/mutation'
import {
  hasWorkbenchMetadata,
  usePluginRuntime,
} from '@/features/plugin-runtime/hooks/usePluginRuntime'
import { orderToolsWithSoftDeleteLast } from '@/features/plugin-runtime/utils/toolOrdering'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'

interface WorkspacePluginHostProps {
  tools: GatewayToolDescriptor[]
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  currentPath: string
  visibleFiles: FileItem[]
  selectedPaths: string[]
  resultQueueState: PluginResultQueueState
  setResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  workbenchState: PluginWorkbenchState
  setWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  onMutationCommitted?: (params?: WorkspaceMutationCommitParams) => void | Promise<void>
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
  onDismissProjectionTool: (toolName: string) => void
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  toolPanelWidthPx: number
  onToolPanelWidthChange: (nextWidthPx: number) => void
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
}

function resolveRelativeToolPayload(files: FileItem[]): { relativePaths: string[]; rootPath?: string } | null {
  if (files.length === 0) return null

  const relativePaths: string[] = []
  let sharedRootPath: string | null = null
  for (const file of files) {
    const relativePath = typeof file.sourceRelativePath === 'string' && file.sourceRelativePath.trim()
      ? file.sourceRelativePath.trim()
      : (!isAbsolutePathLike(file.path) ? file.path : '')
    if (!relativePath) {
      return null
    }

    if (typeof file.sourceRootPath === 'string' && file.sourceRootPath.trim()) {
      if (sharedRootPath === null) {
        sharedRootPath = file.sourceRootPath.trim()
      } else if (sharedRootPath !== file.sourceRootPath.trim()) {
        return null
      }
    }

    relativePaths.push(relativePath)
  }

  return {
    relativePaths,
    ...(sharedRootPath ? { rootPath: sharedRootPath } : {}),
  }
}

function resolveRecycleRestoreItems(files: FileItem[]): Array<Record<string, unknown>> | null {
  if (files.length === 0) return null

  const items: Array<Record<string, unknown>> = []
  for (const file of files) {
    if (file.sourceType !== 'root_trash' && file.sourceType !== 'global_recycle') {
      return null
    }

    const nextItem: Record<string, unknown> = {
      sourceType: file.sourceType,
    }
    if (typeof file.recycleId === 'string' && file.recycleId.trim()) {
      nextItem.recycleId = file.recycleId.trim()
    }
    if (typeof file.absolutePath === 'string' && file.absolutePath.trim()) {
      nextItem.absolutePath = file.absolutePath.trim()
    }
    items.push(nextItem)
  }

  return items
}

function resolveAbsoluteDeletePayload(files: FileItem[]): { absolutePaths: string[] } | null {
  if (files.length === 0) return null
  const absolutePaths = files
    .map((file) => (typeof file.absolutePath === 'string' ? file.absolutePath.trim() : ''))
    .filter((item) => item)
  if (absolutePaths.length !== files.length) {
    return null
  }
  return { absolutePaths }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readSuccessfulResultAbsolutePaths(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.items)) {
    return []
  }

  const unique = new Set<string>()
  for (const item of result.items) {
    if (!isRecord(item) || item.ok !== true || typeof item.absolutePath !== 'string') {
      continue
    }
    const absolutePath = item.absolutePath.trim()
    if (!absolutePath) continue
    unique.add(absolutePath)
  }

  return [...unique]
}

export function WorkspacePluginHost({
  tools,
  rootHandle,
  rootId,
  currentPath,
  visibleFiles,
  selectedPaths,
  resultQueueState,
  setResultQueueState,
  workbenchState,
  setWorkbenchState,
  onMutationCommitted,
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
  toolPanelCollapsed,
  onToggleToolPanelCollapsed,
  toolPanelWidthPx,
  onToolPanelWidthChange,
}: WorkspacePluginHostProps) {
  const handledDuplicateProjectionDismissResultIdRef = useRef<string | null>(null)
  const normalizedCurrentPath = useMemo(
    () => currentPath.split('/').filter(Boolean).join('/'),
    [currentPath]
  )
  const isTrashContext = useMemo(
    () => normalizedCurrentPath === '@trash' || normalizedCurrentPath === '.trash' || normalizedCurrentPath.startsWith('.trash/'),
    [normalizedCurrentPath]
  )
  const contextualTools = useMemo(() => {
    const filteredTools = isTrashContext
      ? tools.filter((tool) => tool.name === 'fs.restore')
      : tools.filter((tool) => tool.name !== 'fs.restore')
    return orderToolsWithSoftDeleteLast(filteredTools)
  }, [isTrashContext, tools])
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])

  const selectedEntries = useMemo(
    () => visibleFiles.filter((file) => selectedPathSet.has(file.path)),
    [selectedPathSet, visibleFiles]
  )
  const selectedEntryPaths = useMemo(
    () => selectedEntries.map((file) => file.path),
    [selectedEntries]
  )
  const selectedFileEntries = useMemo(
    () => selectedEntries.filter((file): file is FileItem => file.kind === 'file'),
    [selectedEntries]
  )
  const visibleFileEntries = useMemo(
    () => visibleFiles.filter((file): file is FileItem => file.kind === 'file'),
    [visibleFiles]
  )
  const targetFileEntries = useMemo(
    () => (selectedFileEntries.length > 0 ? selectedFileEntries : visibleFileEntries),
    [selectedFileEntries, visibleFileEntries]
  )
  const relativeTargetArgs = useMemo(
    () => resolveRelativeToolPayload(targetFileEntries),
    [targetFileEntries]
  )
  const selectedRestoreItems = useMemo(
    () => resolveRecycleRestoreItems(selectedFileEntries),
    [selectedFileEntries]
  )
  const selectedDeleteAbsoluteArgs = useMemo(
    () => (activeProjection ? resolveAbsoluteDeletePayload(selectedFileEntries) : null),
    [activeProjection, selectedFileEntries]
  )
  const hasTargets = targetFileEntries.length > 0
  const hasSelectedEntries = selectedEntries.length > 0
  const hasRenderableTargets = hasTargets || hasSelectedEntries
  const contextKey = currentPath || '/'

  const resolveToolArguments = useCallback((tool: GatewayToolDescriptor, extraArgs?: Record<string, unknown>): Record<string, unknown> | null => {
    if (tool.name === 'fs.softDelete') {
      if (!hasSelectedEntries) return null
      if (selectedDeleteAbsoluteArgs) {
        return {
          ...selectedDeleteAbsoluteArgs,
          ...(extraArgs ?? {}),
        }
      }
      return {
        relativePaths: selectedEntryPaths,
        ...(extraArgs ?? {}),
      }
    }

    if (tool.name === 'fs.restore') {
      if (!hasSelectedEntries) return null
      if (selectedRestoreItems) {
        return {
          items: selectedRestoreItems,
          ...(extraArgs ?? {}),
        }
      }
      return {
        relativePaths: selectedEntryPaths,
        ...(extraArgs ?? {}),
      }
    }

    if (!relativeTargetArgs) {
      return null
    }

    return {
      ...relativeTargetArgs,
      ...(extraArgs ?? {}),
    }
  }, [
    hasSelectedEntries,
    relativeTargetArgs,
    selectedDeleteAbsoluteArgs,
    selectedEntryPaths,
    selectedRestoreItems,
  ])

  const handleRuntimeMutationCommitted = useCallback(async ({ tool, result }: { tool: GatewayToolDescriptor; result: DispatchSystemToolResult }) => {
    if (!onMutationCommitted) {
      return
    }

    const mutationParams: WorkspaceMutationCommitParams = {
      mutationToolName: tool.name,
    }
    if (tool.name === 'fs.softDelete') {
      mutationParams.undoRestoreItems = readDeleteUndoRestoreItems(result.result)
      const successfulAbsolutePaths = readSuccessfulResultAbsolutePaths(result.result)
      const requestedAbsolutePaths = selectedDeleteAbsoluteArgs?.absolutePaths ?? []
      const deletedAbsolutePathSet = new Set<string>()
      for (const absolutePath of successfulAbsolutePaths) {
        if (absolutePath) {
          deletedAbsolutePathSet.add(absolutePath)
        }
      }
      for (const absolutePath of requestedAbsolutePaths) {
        if (absolutePath) {
          deletedAbsolutePathSet.add(absolutePath)
        }
      }
      if (deletedAbsolutePathSet.size > 0) {
        mutationParams.deletedAbsolutePaths = [...deletedAbsolutePathSet]
      }
      if (activeProjection?.id) {
        mutationParams.projectionTabId = activeProjection.id
        mutationParams.deletedProjectionPaths = selectedFileEntries.map((file) => file.path)
      }
    }
    await onMutationCommitted(mutationParams)
  }, [activeProjection?.id, onMutationCommitted, selectedDeleteAbsoluteArgs?.absolutePaths, selectedFileEntries])

  const runtime = usePluginRuntime({
    scope: 'workspace',
    tools: contextualTools,
    contextKey,
    rootHandle,
    rootId,
    resultQueueState,
    setResultQueueState,
    workbenchState,
    setWorkbenchState,
    buildBaseArguments: useCallback(() => ({}), []),
    canRunTool: useCallback((tool: GatewayToolDescriptor) => {
      if (tool.name === 'fs.softDelete' || tool.name === 'fs.restore') {
        return hasSelectedEntries
      }
      return hasTargets && relativeTargetArgs !== null
    }, [hasSelectedEntries, hasTargets, relativeTargetArgs]),
    onMutationCommitted: onMutationCommitted ? handleRuntimeMutationCommitted : undefined,
  })

  const toolByName = useMemo(() => {
    const map = new Map<string, GatewayToolDescriptor>()
    for (const tool of runtime.scopedTools) {
      map.set(tool.name, tool)
    }
    return map
  }, [runtime.scopedTools])
  const handledAutoProjectionIdRef = useRef<string | null>(null)

  useEffect(() => {
    handledAutoProjectionIdRef.current = null
    handledDuplicateProjectionDismissResultIdRef.current = null
  }, [contextKey])

  useEffect(() => {
    const latestDuplicateResult = runtime.currentQueue.find((item) => (
      item.toolName === 'data.findDuplicateFiles'
      && item.status === 'success'
    ))
    const autoProjectionItem = runtime.currentQueue.find((item) => (
      item.status === 'success'
      && item.projection?.entry === 'auto'
      && !(
        item.toolName === 'data.findDuplicateFiles'
        && latestDuplicateResult
        && latestDuplicateResult.id !== item.id
        && !latestDuplicateResult.projection
      )
    ))
    if (!autoProjectionItem?.projection) return
    if (handledAutoProjectionIdRef.current === autoProjectionItem.id) return
    handledAutoProjectionIdRef.current = autoProjectionItem.id
    onActivateProjection(withToolScopedProjection(autoProjectionItem.projection, autoProjectionItem.toolName))
  }, [onActivateProjection, runtime.currentQueue])

  useEffect(() => {
    const latestDuplicateResult = runtime.currentQueue.find((item) => (
      item.toolName === 'data.findDuplicateFiles'
      && item.status === 'success'
    ))
    if (!latestDuplicateResult) return
    if (latestDuplicateResult.projection) return
    if (handledDuplicateProjectionDismissResultIdRef.current === latestDuplicateResult.id) return

    handledDuplicateProjectionDismissResultIdRef.current = latestDuplicateResult.id
    onDismissProjectionTool(latestDuplicateResult.toolName)
  }, [onDismissProjectionTool, runtime.currentQueue])

  const handleWorkbenchRunAction = useCallback((tool: GatewayToolDescriptor, action: Parameters<typeof runtime.handleRunWorkbenchAction>[1]) => {
    const additionalArgs = resolveToolArguments(tool, action.arguments)
    if (!additionalArgs) return
    runtime.handleWorkbenchContextChange(tool.name)
    void runtime.runToolCall(tool, {
      trigger: 'manual',
      actionKey: action.key,
      actionLabel: action.label,
      additionalArgs,
    })
  }, [resolveToolArguments, runtime])

  const railActions = useMemo(() => (
    runtime.railActions.map((action) => ({
      ...action,
      onClick: () => {
        const tool = toolByName.get(action.toolName)
        if (!tool) return
        const additionalArgs = resolveToolArguments(tool)
        if (!additionalArgs) return
        runtime.handleWorkbenchContextChange(tool.name)
        void runtime.runToolCall(tool, {
          trigger: 'manual',
          additionalArgs,
        })
      },
    }))
  ), [resolveToolArguments, runtime, toolByName])

  if (runtime.scopedTools.length === 0) {
    return null
  }

  const activeTool = runtime.activeWorkbenchTool
  const workbenchNode = activeTool && hasWorkbenchMetadata(activeTool)
    ? (
      <PluginToolWorkbench
        tool={activeTool}
        optionValues={workbenchState.optionValuesByTool[activeTool.name]}
        onOptionChange={runtime.handleWorkbenchOptionChange}
        onRunAction={handleWorkbenchRunAction}
        onRunCustomToolCall={(toolItem, params) => {
          const additionalArgs = resolveToolArguments(toolItem, params.additionalArgs)
          if (!additionalArgs) return
          runtime.handleWorkbenchContextChange(toolItem.name)
          void runtime.runToolCall(toolItem, {
            trigger: 'manual',
            actionLabel: params.actionLabel,
            additionalArgs,
          })
        }}
        rootId={rootId}
        annotationTargetPath={null}
        surfaceVariant="workspace-grid"
        subzone="WorkspaceToolWorkbench"
      />
    )
    : null

  return (
    <>
      {!toolPanelCollapsed && (
        <PluginToolResultPanel
          workbench={workbenchNode}
          items={runtime.currentQueue}
          onToggleItemCollapsed={runtime.handleToggleResultItemCollapsed}
          onActivateProjection={({ item }) => {
            if (item.projection) {
              onActivateProjection(withToolScopedProjection(item.projection, item.toolName))
            }
          }}
          activeProjectionId={activeProjection?.id ?? null}
          surfaceVariant="workspace-grid"
          side="right"
          subzone="WorkspaceToolResultPanel"
          emptyHint={hasRenderableTargets ? '点击右侧工具按钮后，结果会显示在这里。' : '当前目录没有可处理项目。'}
          panelWidthPx={toolPanelWidthPx}
          minPanelWidthPx={320}
          maxPanelWidthPx={640}
          onPanelWidthChange={onToolPanelWidthChange}
        />
      )}
      <PluginActionRail
        actions={railActions}
        surfaceVariant="workspace-grid"
        side="right"
        subzone="WorkspaceActionRail"
        onActionHoverChange={runtime.handleWorkbenchContextChange}
        panelToggle={{
          collapsed: toolPanelCollapsed,
          onToggle: onToggleToolPanelCollapsed,
          expandLabel: '展开工作区工具面板',
          collapseLabel: '收起工作区工具面板',
        }}
      />
    </>
  )
}
