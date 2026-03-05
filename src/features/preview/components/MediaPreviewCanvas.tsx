import { useCallback, useEffect, useMemo, useState } from 'react'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import { getMediaType } from '@/lib/thumbnail'
import type { FileItem } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import {
  PreviewActionRail,
  type PreviewActionRailItem,
  type PreviewActionState,
} from './PreviewActionRail'
import { PreviewFeedbackOverlay } from './PreviewFeedbackOverlay'
import { PreviewMediaViewport } from './PreviewMediaViewport'
import { PreviewToolResultPanel, type PreviewToolResultItem } from './PreviewToolResultPanel'

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
}

type MediaPreviewViewState = 'loading' | 'error' | 'ready' | 'empty'
type PreviewActionRuntimeState = {
  isLoading: boolean
  error: string | null
  errorCode?: string
  result?: unknown
  lastUpdatedAt?: number
}
type PreviewActionRuntimeMap = Record<string, PreviewActionRuntimeState>

function hasToolResultState(state: PreviewActionRuntimeState | undefined): state is PreviewActionRuntimeState {
  if (!state) return false
  return state.isLoading
    || state.error !== null
    || typeof state.result !== 'undefined'
    || typeof state.lastUpdatedAt === 'number'
}

function toRailErrorHint(error: string | null): string | null {
  if (!error) return null
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
}: MediaPreviewCanvasProps) {
  const [playbackError, setPlaybackError] = useState(false)
  const [actionRuntimeState, setActionRuntimeState] = useState<PreviewActionRuntimeMap>({})
  const [selectedResultToolName, setSelectedResultToolName] = useState<string | null>(null)

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

  const resolveActionState = useCallback((toolName: string): PreviewActionState => {
    const state = actionRuntimeState[toolName]
    if (state?.error) return 'error'
    if (state?.isLoading) return 'loading'
    return rootHandle ? 'default' : 'disabled'
  }, [actionRuntimeState, rootHandle])

  useEffect(() => {
    setPlaybackError(false)
    setActionRuntimeState({})
    setSelectedResultToolName(null)
  }, [file.path])

  const handleToolAction = useCallback(async (tool: GatewayToolDescriptor) => {
    if (file.kind !== 'file' || !rootHandle) return

    try {
      setActionRuntimeState((prev) => ({
        ...prev,
        [tool.name]: {
          ...(prev[tool.name] ?? { error: null }),
          isLoading: true,
          error: null,
          errorCode: undefined,
        },
      }))

      const dispatchResult = await dispatchSystemTool({
        toolName: tool.name,
        rootHandle,
        relativePath: file.path,
      })
      const completedAt = Date.now()
      setSelectedResultToolName(tool.name)
      setActionRuntimeState((prev) => ({
        ...prev,
        [tool.name]: dispatchResult.ok
          ? {
              isLoading: false,
              error: null,
              errorCode: undefined,
              result: dispatchResult.result,
              lastUpdatedAt: completedAt,
            }
          : {
              isLoading: false,
              error: dispatchResult.error || `${tool.title || tool.name} 失败`,
              errorCode: dispatchResult.errorCode,
              result: undefined,
              lastUpdatedAt: completedAt,
            },
      }))
    } catch (err) {
      const message = err instanceof Error
        ? (err.message || `${tool.title || tool.name} 失败`)
        : `${tool.title || tool.name} 失败`
      const errorWithCode = err instanceof Error
        ? (err as Error & { code?: unknown })
        : null
      const code = errorWithCode && typeof errorWithCode.code === 'string'
        ? errorWithCode.code
        : undefined
      const completedAt = Date.now()
      setSelectedResultToolName(tool.name)
      setActionRuntimeState((prev) => ({
        ...prev,
        [tool.name]: {
          isLoading: false,
          error: message,
          errorCode: code,
          result: undefined,
          lastUpdatedAt: completedAt,
        },
      }))
    }
  }, [file.kind, file.path, rootHandle])

  const resultPanelItems = useMemo<PreviewToolResultItem[]>(() => {
    const items: PreviewToolResultItem[] = []
    for (const tool of fileActionTools) {
      const state = actionRuntimeState[tool.name]
      if (!hasToolResultState(state)) continue
      items.push({
        toolName: tool.name,
        title: tool.title || tool.name,
        isLoading: state.isLoading,
        error: state.error,
        errorCode: state.errorCode,
        result: state.result,
        lastUpdatedAt: state.lastUpdatedAt,
      })
    }

    items.sort((a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0))
    return items
  }, [actionRuntimeState, fileActionTools])

  const activeResultToolName = useMemo(() => {
    if (resultPanelItems.length === 0) return null
    if (selectedResultToolName && resultPanelItems.some((item) => item.toolName === selectedResultToolName)) {
      return selectedResultToolName
    }
    return resultPanelItems[0].toolName
  }, [resultPanelItems, selectedResultToolName])

  const railActions = useMemo<PreviewActionRailItem[]>(() => {
    return fileActionTools.map((tool) => {
      const state = actionRuntimeState[tool.name]
      const title = tool.title || tool.name

      return {
        toolName: tool.name,
        title,
        onClick: () => {
          void handleToolAction(tool)
        },
        disabled: !!state?.isLoading || !rootHandle,
        actionState: resolveActionState(tool.name),
        error: toRailErrorHint(state?.error ?? null),
        icon: tool.icon,
      }
    })
  }, [actionRuntimeState, fileActionTools, handleToolAction, resolveActionState, rootHandle])

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
          items={resultPanelItems}
          activeToolName={activeResultToolName}
          onSelectTool={setSelectedResultToolName}
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
