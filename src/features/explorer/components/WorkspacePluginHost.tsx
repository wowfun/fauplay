import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { FileItem } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import { PluginActionRail } from '@/features/plugin-runtime/components/PluginActionRail'
import { PluginToolResultPanel } from '@/features/plugin-runtime/components/PluginToolResultPanel'
import { PluginToolWorkbench } from '@/features/plugin-runtime/components/PluginToolWorkbench'
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
  onMutationCommitted?: () => void | Promise<void>
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  toolPanelWidthPx: number
  onToolPanelWidthChange: (nextWidthPx: number) => void
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
  toolPanelCollapsed,
  onToggleToolPanelCollapsed,
  toolPanelWidthPx,
  onToolPanelWidthChange,
}: WorkspacePluginHostProps) {
  const normalizedCurrentPath = useMemo(
    () => currentPath.split('/').filter(Boolean).join('/'),
    [currentPath]
  )
  const isTrashContext = useMemo(
    () => normalizedCurrentPath === '.trash' || normalizedCurrentPath.startsWith('.trash/'),
    [normalizedCurrentPath]
  )
  const contextualTools = useMemo(() => {
    const filteredTools = tools.filter((tool) => {
      if (tool.name === 'fs.softDelete') return !isTrashContext
      if (tool.name === 'fs.restore') return isTrashContext
      return true
    })
    return orderToolsWithSoftDeleteLast(filteredTools)
  }, [isTrashContext, tools])
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])

  const selectedEntryPaths = useMemo(() => {
    return visibleFiles
      .filter((file) => selectedPathSet.has(file.path))
      .map((file) => file.path)
  }, [selectedPathSet, visibleFiles])

  const selectedFilePaths = useMemo(() => {
    return visibleFiles
      .filter((file) => file.kind === 'file' && selectedPathSet.has(file.path))
      .map((file) => file.path)
  }, [selectedPathSet, visibleFiles])

  const visibleFilePaths = useMemo(() => {
    return visibleFiles
      .filter((file) => file.kind === 'file')
      .map((file) => file.path)
  }, [visibleFiles])

  const targetPaths = useMemo(() => {
    if (selectedFilePaths.length > 0) {
      return selectedFilePaths
    }
    return visibleFilePaths
  }, [selectedFilePaths, visibleFilePaths])

  const hasTargets = targetPaths.length > 0
  const hasSelectedEntries = selectedEntryPaths.length > 0
  const hasRenderableTargets = hasTargets || hasSelectedEntries
  const contextKey = currentPath || '/'

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
    buildBaseArguments: useCallback(() => {
      if (!hasTargets) return {}
      return { relativePaths: targetPaths }
    }, [hasTargets, targetPaths]),
    canRunTool: useCallback((tool: GatewayToolDescriptor) => {
      if (tool.name === 'local.data') {
        return true
      }
      if (tool.name === 'fs.softDelete' || tool.name === 'fs.restore') {
        return hasSelectedEntries
      }
      return hasTargets
    }, [hasSelectedEntries, hasTargets]),
    onMutationCommitted: onMutationCommitted
      ? async () => {
        await onMutationCommitted()
      }
      : undefined,
  })

  const toolByName = useMemo(() => {
    const map = new Map<string, GatewayToolDescriptor>()
    for (const tool of runtime.scopedTools) {
      map.set(tool.name, tool)
    }
    return map
  }, [runtime.scopedTools])

  const selectedEntriesArgs = useMemo<Record<string, unknown>>(() => ({
    relativePaths: selectedEntryPaths,
  }), [selectedEntryPaths])

  const isSelectedEntriesTool = useCallback((toolName: string) => (
    toolName === 'fs.softDelete' || toolName === 'fs.restore'
  ), [])

  const handleWorkbenchRunAction = useCallback((tool: GatewayToolDescriptor, action: Parameters<typeof runtime.handleRunWorkbenchAction>[1]) => {
    if (!isSelectedEntriesTool(tool.name)) {
      runtime.handleRunWorkbenchAction(tool, action)
      return
    }

    runtime.handleWorkbenchContextChange(tool.name)
    void runtime.runToolCall(tool, {
      trigger: 'manual',
      actionKey: action.key,
      actionLabel: action.label,
      additionalArgs: {
        ...selectedEntriesArgs,
        ...(action.arguments ?? {}),
      },
    })
  }, [isSelectedEntriesTool, runtime, selectedEntriesArgs])

  const railActions = useMemo(() => (
    runtime.railActions.map((action) => {
      if (!isSelectedEntriesTool(action.toolName)) {
        return action
      }

      return {
        ...action,
        onClick: () => {
          const tool = toolByName.get(action.toolName)
          if (!tool) return
          runtime.handleWorkbenchContextChange(tool.name)
          void runtime.runToolCall(tool, {
            trigger: 'manual',
            additionalArgs: selectedEntriesArgs,
          })
        },
      }
    })
  ), [isSelectedEntriesTool, runtime, selectedEntriesArgs, toolByName])

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
          runtime.handleWorkbenchContextChange(toolItem.name)
          void runtime.runToolCall(toolItem, {
            trigger: 'manual',
            actionLabel: params.actionLabel,
            additionalArgs: params.additionalArgs,
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
