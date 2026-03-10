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
}: WorkspacePluginHostProps) {
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])

  const targetPaths = useMemo(() => {
    const selectedFiles = visibleFiles
      .filter((file) => file.kind === 'file' && selectedPathSet.has(file.path))
      .map((file) => file.path)

    if (selectedFiles.length > 0) {
      return selectedFiles
    }

    return visibleFiles
      .filter((file) => file.kind === 'file')
      .map((file) => file.path)
  }, [selectedPathSet, visibleFiles])

  const hasTargets = targetPaths.length > 0
  const contextKey = currentPath || '/'

  const runtime = usePluginRuntime({
    scope: 'workspace',
    tools,
    contextKey,
    rootHandle,
    rootId,
    resultQueueState,
    setResultQueueState,
    workbenchState,
    setWorkbenchState,
    buildBaseArguments: useCallback(() => {
      if (!hasTargets) return null
      return { relativePaths: targetPaths }
    }, [hasTargets, targetPaths]),
    canRunTool: useCallback(() => hasTargets, [hasTargets]),
    onMutationCommitted: onMutationCommitted
      ? async () => {
        await onMutationCommitted()
      }
      : undefined,
  })

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
        onRunAction={runtime.handleRunWorkbenchAction}
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
          emptyHint={hasTargets ? '点击右侧工具按钮后，结果会显示在这里。' : '当前目录没有可处理文件。'}
        />
      )}
      <PluginActionRail
        actions={runtime.railActions}
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
