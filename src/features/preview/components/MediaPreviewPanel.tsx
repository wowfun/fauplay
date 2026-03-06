import { useEffect, useState, useRef, useCallback, type Dispatch, type SetStateAction } from 'react'
import { createObjectUrlForFile, getFileFromPath } from '@/lib/fileSystem'
import type { FileItem } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { PlaybackOrder, PreviewSurface } from '@/features/preview/types/playback'
import type { PreviewToolResultQueueState } from '@/features/preview/types/toolResult'
import { MediaPreviewCanvas } from './MediaPreviewCanvas'
import { PreviewHeaderBar } from './PreviewHeaderBar'

interface MediaPreviewPanelProps {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  previewActionTools: GatewayToolDescriptor[]
  onClose: () => void
  onOpenFullscreen?: () => void
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoEnded: () => void
  onVideoPlaybackError: () => void
  presentation?: PreviewSurface
  forceAutoPlayOnOpen?: boolean
  toolResultQueueState: PreviewToolResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PreviewToolResultQueueState>>
}

export function MediaPreviewPanel({
  file,
  rootHandle,
  previewActionTools,
  onClose,
  onOpenFullscreen,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onAutoPlayIntervalChange,
  onVideoEnded,
  onVideoPlaybackError,
  presentation = 'panel',
  forceAutoPlayOnOpen = false,
  toolResultQueueState,
  setToolResultQueueState,
}: MediaPreviewPanelProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const isFullscreen = presentation === 'lightbox'

  const replacePreviewUrl = useCallback((nextUrl: string | null) => {
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current)
    }
    currentUrlRef.current = nextUrl
    setPreviewUrl(nextUrl)
  }, [])

  useEffect(() => {
    if (!file || !rootHandle) {
      replacePreviewUrl(null)
      return
    }

    let cancelled = false

    const loadFile = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const fileObj = await getFileFromPath(rootHandle, file.path)
        if (cancelled) return

        const nextUrl = createObjectUrlForFile(fileObj, file.name)
        if (cancelled) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        replacePreviewUrl(nextUrl)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadFile()

    return () => {
      cancelled = true
    }
  }, [file, rootHandle, replacePreviewUrl])

  useEffect(() => {
    return () => {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current)
      }
    }
  }, [])

  if (!file) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-muted-foreground p-4"
      >
        <p className="text-sm">选择文件以预览</p>
      </div>
    )
  }

  return (
    <div className={isFullscreen ? 'flex flex-col h-full bg-background' : 'flex flex-col h-full bg-card border-l border-border'}>
      <PreviewHeaderBar
        fileName={file.name}
        isFullscreen={isFullscreen}
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        onToggleAutoPlay={onToggleAutoPlay}
        playbackOrder={playbackOrder}
        onTogglePlaybackOrder={onTogglePlaybackOrder}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onClose={onClose}
      />

      <MediaPreviewCanvas
        file={file}
        rootHandle={rootHandle}
        previewActionTools={previewActionTools}
        previewUrl={previewUrl}
        isLoading={isLoading}
        error={error}
        onOpenFullscreen={isFullscreen ? undefined : onOpenFullscreen}
        autoPlayVideo={autoPlayEnabled || forceAutoPlayOnOpen}
        isFullscreen={isFullscreen}
        onVideoEnded={onVideoEnded}
        onVideoPlaybackError={onVideoPlaybackError}
        toolResultQueueState={toolResultQueueState}
        setToolResultQueueState={setToolResultQueueState}
      />
    </div>
  )
}
