import { useEffect, useState, useRef, useCallback } from 'react'
import { createObjectUrlForFile, getFileFromPath } from '@/lib/fileSystem'
import type { FileItem } from '@/types'
import { MediaPreviewCanvas } from './MediaPreviewCanvas'
import { PreviewHeaderBar } from './PreviewHeaderBar'

type PreviewPresentation = 'panel' | 'fullscreen'

interface MediaPreviewPanelProps {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  canRevealInExplorer: boolean
  canOpenWithSystemPlayer: boolean
  onClose: () => void
  onOpenFullscreen?: () => void
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  onToggleAutoPlay: () => void
  traversalOrder: 'sequential' | 'shuffle'
  onToggleTraversalOrder: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoEnded: () => void
  onVideoPlaybackError: () => void
  presentation?: PreviewPresentation
  forceAutoPlayOnOpen?: boolean
}

export function MediaPreviewPanel({
  file,
  rootHandle,
  canRevealInExplorer,
  canOpenWithSystemPlayer,
  onClose,
  onOpenFullscreen,
  autoPlayEnabled,
  autoPlayIntervalSec,
  onToggleAutoPlay,
  traversalOrder,
  onToggleTraversalOrder,
  onAutoPlayIntervalChange,
  onVideoEnded,
  onVideoPlaybackError,
  presentation = 'panel',
  forceAutoPlayOnOpen = false,
}: MediaPreviewPanelProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const isFullscreen = presentation === 'fullscreen'

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
        traversalOrder={traversalOrder}
        onToggleTraversalOrder={onToggleTraversalOrder}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onClose={onClose}
      />

      <MediaPreviewCanvas
        file={file}
        rootHandle={rootHandle}
        canRevealInExplorer={canRevealInExplorer}
        canOpenWithSystemPlayer={canOpenWithSystemPlayer}
        previewUrl={previewUrl}
        isLoading={isLoading}
        error={error}
        onOpenFullscreen={isFullscreen ? undefined : onOpenFullscreen}
        autoPlayVideo={autoPlayEnabled || forceAutoPlayOnOpen}
        isFullscreen={isFullscreen}
        onVideoEnded={onVideoEnded}
        onVideoPlaybackError={onVideoPlaybackError}
      />
    </div>
  )
}
