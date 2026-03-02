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
}
type PreviewActionRuntimeMap = Record<string, PreviewActionRuntimeState>

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

  const isImage = getMediaType(file.name) === 'image'
  const isVideo = getMediaType(file.name) === 'video'
  const panelBorderClass = isFullscreen ? 'border-white/10' : 'border-border'
  const mediaMaxHeightClass = isFullscreen ? 'max-h-[90vh]' : 'max-h-[85vh]'
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
  }, [file.path])

  const handleToolAction = useCallback(async (tool: GatewayToolDescriptor) => {
    if (file.kind !== 'file' || !rootHandle) return

    try {
      setActionRuntimeState((prev) => ({
        ...prev,
        [tool.name]: { isLoading: true, error: null },
      }))

      const didDispatch = await dispatchSystemTool({
        toolName: tool.name,
        rootHandle,
        relativePath: file.path,
      })

      if (!didDispatch) {
        setActionRuntimeState((prev) => ({
          ...prev,
          [tool.name]: { isLoading: false, error: null },
        }))
      }
    } catch (err) {
      setActionRuntimeState((prev) => ({
        ...prev,
        [tool.name]: {
          isLoading: false,
          error: (err as Error).message || `${tool.title || tool.name} 失败`,
        },
      }))
    } finally {
      setActionRuntimeState((prev) => {
        const current = prev[tool.name]
        if (!current) return prev

        return {
          ...prev,
          [tool.name]: { ...current, isLoading: false },
        }
      })
    }
  }, [file.kind, file.path, rootHandle])

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
        error: state?.error ?? null,
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

      <PreviewMediaViewport
        file={file}
        previewUrl={previewUrl}
        isLoading={isLoading}
        error={error}
        isImage={isImage}
        isVideo={isVideo}
        mediaMaxHeightClass={mediaMaxHeightClass}
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
