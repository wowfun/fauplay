import { useEffect, useState } from 'react'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import { getMediaType } from '@/lib/thumbnail'
import type { FileItem } from '@/types'
import { PreviewActionRail } from './PreviewActionRail'
import { PreviewFeedbackOverlay } from './PreviewFeedbackOverlay'
import { PreviewMediaViewport } from './PreviewMediaViewport'

interface MediaPreviewCanvasProps {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  canRevealInExplorer?: boolean
  canOpenWithSystemPlayer?: boolean
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

export function MediaPreviewCanvas({
  file,
  rootHandle,
  canRevealInExplorer = true,
  canOpenWithSystemPlayer = true,
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
  const [isRevealing, setIsRevealing] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  const isImage = getMediaType(file.name) === 'image'
  const isVideo = getMediaType(file.name) === 'video'
  const panelBorderClass = isFullscreen ? 'border-white/10' : 'border-border'
  const mediaMaxHeightClass = isFullscreen ? 'max-h-[90vh]' : 'max-h-[85vh]'
  const railButtonClass = isFullscreen
    ? 'p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-50 text-white'
    : 'p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50'
  const emptyTextClass = isFullscreen ? 'text-white/70' : 'text-muted-foreground'
  const errorTextClass = isFullscreen ? 'text-red-300' : 'text-destructive'
  const showActionRail = canRevealInExplorer || (isVideo && canOpenWithSystemPlayer)
  const previewViewState: MediaPreviewViewState = isLoading
    ? 'loading'
    : error
      ? 'error'
      : previewUrl && (isImage || isVideo)
        ? 'ready'
        : 'empty'
  const revealActionState = revealError
    ? 'error'
    : isRevealing
      ? 'loading'
      : rootHandle
        ? 'default'
        : 'disabled'
  const openActionState = openError
    ? 'error'
    : isOpening
      ? 'loading'
      : rootHandle
        ? 'default'
        : 'disabled'

  useEffect(() => {
    setPlaybackError(false)
    setOpenError(null)
    setRevealError(null)
  }, [file.path])

  const handleRevealInExplorer = async () => {
    if (file.kind !== 'file' || !rootHandle) return

    try {
      setRevealError(null)
      setIsRevealing(true)
      await dispatchSystemTool({
        toolName: 'system.reveal',
        rootHandle,
        relativePath: file.path,
      })
    } catch (err) {
      setRevealError((err as Error).message || '打开资源管理器失败')
    } finally {
      setIsRevealing(false)
    }
  }

  const handleOpenWithSystemPlayer = async () => {
    if (file.kind !== 'file' || !rootHandle) return

    try {
      setOpenError(null)
      setIsOpening(true)
      await dispatchSystemTool({
        toolName: 'system.openDefault',
        rootHandle,
        relativePath: file.path,
      })
    } catch (err) {
      setOpenError((err as Error).message || '打开系统播放器失败')
    } finally {
      setIsOpening(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex" data-preview-state={previewViewState}>
      {showActionRail && (
        <PreviewActionRail
          canRevealInExplorer={canRevealInExplorer}
          canOpenWithSystemPlayer={canOpenWithSystemPlayer}
          isVideo={isVideo}
          isRevealing={isRevealing}
          isOpening={isOpening}
          hasRootHandle={!!rootHandle}
          onReveal={() => void handleRevealInExplorer()}
          onOpenWithSystemPlayer={() => void handleOpenWithSystemPlayer()}
          railButtonClass={railButtonClass}
          borderClass={panelBorderClass}
          errorTextClass={errorTextClass}
          revealError={revealError}
          openError={openError}
          revealActionState={revealActionState}
          openActionState={openActionState}
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
