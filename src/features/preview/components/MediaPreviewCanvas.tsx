import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { isUnlimited, toolResultQueueConfig } from '@/config/toolResultQueue'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import { getMediaType } from '@/lib/thumbnail'
import type { FileItem } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { PreviewToolResultQueueItem, PreviewToolResultQueueState } from '@/features/preview/types/toolResult'
import {
  PreviewActionRail,
  type PreviewActionRailItem,
  type PreviewActionState,
} from './PreviewActionRail'
import { PreviewFeedbackOverlay } from './PreviewFeedbackOverlay'
import { PreviewMediaViewport } from './PreviewMediaViewport'
import { PreviewToolResultPanel } from './PreviewToolResultPanel'

interface MediaPreviewCanvasProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  previewActionTools: GatewayToolDescriptor[]
  previewUrl: string | null
  isLoading: boolean
  error: string | null
  onOpenFullscreen?: () => void
  autoPlayVideo?: boolean
  isFullscreen?: boolean
  onVideoEnded?: () => void
  onVideoPlaybackError?: () => void
  toolResultQueueState: PreviewToolResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PreviewToolResultQueueState>>
}

type MediaPreviewViewState = 'loading' | 'error' | 'ready' | 'empty'
const QUEUE_ID_RANDOM_MAX = 1_000_000

function createQueueItemId(toolName: string): string {
  return `${Date.now()}-${Math.floor(Math.random() * QUEUE_ID_RANDOM_MAX)}-${toolName}`
}

function touchFileOrder(fileOrder: string[], filePath: string): string[] {
  return [filePath, ...fileOrder.filter((item) => item !== filePath)]
}

function trimQueueByItemLimit(queue: PreviewToolResultQueueItem[]): PreviewToolResultQueueItem[] {
  if (isUnlimited(toolResultQueueConfig.maxItemsPerFile)) {
    return queue
  }
  return queue.slice(0, Math.max(toolResultQueueConfig.maxItemsPerFile, 0))
}

function trimQueueStateByFileLimit(state: PreviewToolResultQueueState): PreviewToolResultQueueState {
  if (isUnlimited(toolResultQueueConfig.maxFiles) || state.fileOrder.length <= toolResultQueueConfig.maxFiles) {
    return state
  }

  const keepFilePaths = state.fileOrder.slice(0, Math.max(toolResultQueueConfig.maxFiles, 0))
  const byFilePath: Record<string, PreviewToolResultQueueItem[]> = {}

  for (const filePath of keepFilePaths) {
    const queue = state.byFilePath[filePath]
    if (queue) {
      byFilePath[filePath] = queue
    }
  }

  return {
    byFilePath,
    fileOrder: keepFilePaths,
  }
}

function resolveToolActionState(
  queue: PreviewToolResultQueueItem[],
  toolName: string,
  hasRootHandle: boolean
): PreviewActionState {
  const latest = queue.find((item) => item.toolName === toolName)
  if (latest?.status === 'error') return 'error'
  if (latest?.status === 'loading') return 'loading'
  return hasRootHandle ? 'default' : 'disabled'
}

function toRailErrorHint(latest: PreviewToolResultQueueItem | undefined): string | null {
  if (!latest || latest.status !== 'error') return null
  return '执行失败，查看结果面板'
}

export function MediaPreviewCanvas({
  file,
  rootHandle,
  previewActionTools,
  previewUrl,
  isLoading,
  error,
  onOpenFullscreen,
  autoPlayVideo = false,
  isFullscreen = false,
  onVideoEnded,
  onVideoPlaybackError,
  toolResultQueueState,
  setToolResultQueueState,
}: MediaPreviewCanvasProps) {
  const [playbackError, setPlaybackError] = useState(false)

  const isImage = getMediaType(file.name) === 'image'
  const isVideo = getMediaType(file.name) === 'video'
  const panelBorderClass = isFullscreen ? 'border-white/10' : 'border-border'
  const railButtonClass = isFullscreen
    ? 'p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-50 text-white'
    : 'p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50'
  const emptyTextClass = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const errorTextClass = isFullscreen ? 'text-red-300' : 'text-destructive'
  const fileActionTools = useMemo(() => {
    if (file.kind !== 'file') return []
    return previewActionTools.filter((tool) => tool.scopes.includes('file'))
  }, [file.kind, previewActionTools])
  const showActionRail = fileActionTools.length > 0
  const showResultPanel = fileActionTools.length > 0
  const previewViewState: MediaPreviewViewState = isLoading
    ? 'loading'
    : error
      ? 'error'
      : previewUrl && (isImage || isVideo)
        ? 'ready'
        : 'empty'

  const currentFileQueue = useMemo(
    () => toolResultQueueState.byFilePath[file.path] ?? [],
    [toolResultQueueState.byFilePath, file.path]
  )

  useEffect(() => {
    setToolResultQueueState((prev) => {
      if (!prev.byFilePath[file.path]) return prev
      if (prev.fileOrder[0] === file.path) return prev
      return {
        ...prev,
        fileOrder: touchFileOrder(prev.fileOrder, file.path),
      }
    })
  }, [file.path, setToolResultQueueState])

  useEffect(() => {
    setPlaybackError(false)
  }, [file.path])

  const handleToolAction = useCallback(async (tool: GatewayToolDescriptor) => {
    if (file.kind !== 'file' || !rootHandle) return

    const queueItemId = createQueueItemId(tool.name)
    const startedAt = Date.now()

    setToolResultQueueState((prev) => {
      const previousQueue = prev.byFilePath[file.path] ?? []
      const collapsedHistory = previousQueue.map((item) => (
        item.toolName === tool.name
          ? { ...item, collapsed: true }
          : item
      ))
      const nextQueue = trimQueueByItemLimit([
        {
          id: queueItemId,
          filePath: file.path,
          toolName: tool.name,
          title: tool.title || tool.name,
          status: 'loading',
          startedAt,
          collapsed: false,
        },
        ...collapsedHistory,
      ])
      const nextState: PreviewToolResultQueueState = {
        byFilePath: {
          ...prev.byFilePath,
          [file.path]: nextQueue,
        },
        fileOrder: touchFileOrder(prev.fileOrder, file.path),
      }

      return trimQueueStateByFileLimit(nextState)
    })

    try {
      const dispatchResult = await dispatchSystemTool({
        toolName: tool.name,
        rootHandle,
        relativePath: file.path,
      })
      const finishedAt = Date.now()

      setToolResultQueueState((prev) => {
        const currentQueue = prev.byFilePath[file.path] ?? []
        let hasMatched = false
        const nextQueue = currentQueue.map((item) => {
          if (item.id !== queueItemId) return item
          hasMatched = true

          if (dispatchResult.ok) {
            return {
              ...item,
              status: 'success' as const,
              result: dispatchResult.result,
              error: undefined,
              errorCode: undefined,
              finishedAt,
            }
          }

          return {
            ...item,
            status: 'error' as const,
            result: undefined,
            error: dispatchResult.error || `${tool.title || tool.name} 失败`,
            errorCode: dispatchResult.errorCode,
            finishedAt,
          }
        })

        if (!hasMatched) return prev

        return {
          ...prev,
          byFilePath: {
            ...prev.byFilePath,
            [file.path]: nextQueue,
          },
        }
      })
    } catch {
      // dispatchSystemTool already converts runtime errors to structured result.
    }
  }, [file.kind, file.path, rootHandle, setToolResultQueueState])

  const handleToggleResultItemCollapsed = useCallback((id: string) => {
    setToolResultQueueState((prev) => {
      const currentQueue = prev.byFilePath[file.path] ?? []
      let hasMatched = false
      const nextQueue = currentQueue.map((item) => {
        if (item.id !== id) return item
        hasMatched = true
        return {
          ...item,
          collapsed: !item.collapsed,
        }
      })

      if (!hasMatched) return prev
      return {
        ...prev,
        byFilePath: {
          ...prev.byFilePath,
          [file.path]: nextQueue,
        },
      }
    })
  }, [file.path, setToolResultQueueState])

  const railActions = useMemo<PreviewActionRailItem[]>(() => {
    return fileActionTools.map((tool) => {
      const latestQueueItem = currentFileQueue.find((item) => item.toolName === tool.name)
      const title = tool.title || tool.name

      return {
        toolName: tool.name,
        title,
        onClick: () => {
          void handleToolAction(tool)
        },
        disabled: latestQueueItem?.status === 'loading' || !rootHandle,
        actionState: resolveToolActionState(currentFileQueue, tool.name, Boolean(rootHandle)),
        error: toRailErrorHint(latestQueueItem),
        icon: tool.icon,
      }
    })
  }, [currentFileQueue, fileActionTools, handleToolAction, rootHandle])

  return (
    <div className="flex-1 min-h-0 flex" data-preview-state={previewViewState}>
      {showActionRail && (
        <PreviewActionRail
          actions={railActions}
          railButtonClass={railButtonClass}
          borderClass={panelBorderClass}
          errorTextClass={errorTextClass}
        />
      )}

      {showResultPanel && (
        <PreviewToolResultPanel
          items={currentFileQueue}
          onToggleItemCollapsed={handleToggleResultItemCollapsed}
          isFullscreen={isFullscreen}
        />
      )}

      <PreviewMediaViewport
        file={file}
        previewUrl={previewUrl}
        isLoading={isLoading}
        error={error}
        isImage={isImage}
        isVideo={isVideo}
        emptyTextClass={emptyTextClass}
        errorTextClass={errorTextClass}
        onOpenFullscreen={onOpenFullscreen}
        autoPlayVideo={autoPlayVideo}
        onVideoEnded={onVideoEnded}
        onVideoRenderError={() => {
          setPlaybackError(true)
          onVideoPlaybackError?.()
        }}
      >
        <PreviewFeedbackOverlay showPlaybackError={playbackError && isVideo} />
      </PreviewMediaViewport>
    </div>
  )
}
