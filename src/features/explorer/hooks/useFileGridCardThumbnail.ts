import { useCallback, useEffect, useRef, useState } from 'react'
import {
  resolveFileGridCardDisplayedThumbnailUrl,
  resolveFileGridCardThumbnailFrameView,
  resolveFileGridCardThumbnailLoadPlan,
  resolveFileGridCardThumbnailPlan,
  resolveFileGridCardThumbnailSourceUrls,
  type FileGridCardThumbnailFrameView,
  type FileGridCardThumbnailState,
} from '@/features/explorer/lib/fileGridCardModel'
import { buildFileThumbnailUrlForItem } from '@/lib/fileAccess'
import {
  buildRuntimeFileContentUrlForItem,
  buildRuntimeGlobalTrashFileContentUrlForItem,
} from '@/lib/runtimeApi'
import {
  getExactCachedThumbnailFromPipeline,
  getLatestCachedThumbnailFromPipeline,
  type ThumbnailTaskPriority,
} from '@/lib/thumbnailPipeline'
import type { FileItem, ThumbnailSizePreset } from '@/types'
import { requestFileGridCardThumbnailJob } from '@/features/explorer/lib/fileGridCardThumbnailJob'

interface UseFileGridCardThumbnailParams {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
  thumbnailSizePreset: ThumbnailSizePreset
  thumbnailPriority: ThumbnailTaskPriority
  directoryBadgeLabel: string | null
}

interface FileGridCardThumbnailController {
  thumbnailFrameView: FileGridCardThumbnailFrameView
  handleThumbnailImageLoad: () => void
  handleThumbnailImageError: () => void
}

export function useFileGridCardThumbnail({
  file,
  rootHandle,
  thumbnailSizePreset,
  thumbnailPriority,
  directoryBadgeLabel,
}: UseFileGridCardThumbnailParams): FileGridCardThumbnailController {
  const thumbnailPlan = resolveFileGridCardThumbnailPlan({
    file,
    rootHandleAvailable: Boolean(rootHandle),
    thumbnailSizePreset,
  })
  const {
    isDirectory,
    previewKind,
    mediaType,
    fileLastModifiedMs,
    requestIdentity,
  } = thumbnailPlan
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [thumbnailUrlIdentity, setThumbnailUrlIdentity] = useState<string | null>(null)
  const [thumbnailState, setThumbnailState] =
    useState<FileGridCardThumbnailState>('placeholder')
  const requestIdentityRef = useRef<string | null>(null)
  const runtimeLocalFileContentUrl = (
    thumbnailPlan.runtimeContentSource === 'local-root'
  )
    ? buildRuntimeFileContentUrlForItem(file)
    : null
  const runtimeGlobalTrashFileContentUrl = (
    thumbnailPlan.runtimeContentSource === 'global-trash'
  )
    ? buildRuntimeGlobalTrashFileContentUrlForItem(file)
    : null
  const candidateFileAccessThumbnailUrl = thumbnailPlan.fileAccessThumbnail
    ? buildFileThumbnailUrlForItem(file, {
      sizePreset: thumbnailSizePreset,
    })
    : null
  const {
    runtimeThumbnailUrl,
    runtimeVideoThumbnailSourceUrl,
    fileAccessThumbnailUrl,
    directThumbnailUrl,
    hasDirectThumbnailSource,
  } = resolveFileGridCardThumbnailSourceUrls({
    thumbnailPlan,
    runtimeLocalFileContentUrl,
    runtimeGlobalTrashFileContentUrl,
    fileAccessThumbnailUrl: candidateFileAccessThumbnailUrl,
  })
  const exactCachedThumbnailUrl = !isDirectory && mediaType
    ? getExactCachedThumbnailFromPipeline({
      filePath: file.path,
      mediaType,
      sizePreset: thumbnailSizePreset,
      fileSize: file.size,
      fileLastModifiedMs,
    })
    : null
  const latestCachedThumbnailUrl = !isDirectory && mediaType
    ? getLatestCachedThumbnailFromPipeline({
      filePath: file.path,
      mediaType,
      sizePreset: thumbnailSizePreset,
      fileSize: file.size,
      fileLastModifiedMs,
    })
    : null
  const displayedThumbnailUrl = resolveFileGridCardDisplayedThumbnailUrl({
    runtimeThumbnailUrl,
    fileAccessThumbnailUrl,
    generatedThumbnailUrl: thumbnailUrl,
    generatedThumbnailIdentity: thumbnailUrlIdentity,
    requestIdentity,
    latestCachedThumbnailUrl,
  })
  const thumbnailFrameView = resolveFileGridCardThumbnailFrameView({
    isDirectory,
    displayedThumbnailUrl,
    thumbnailState,
    previewKind,
    directoryBadgeLabel,
  })

  useEffect(() => {
    const loadPlan = resolveFileGridCardThumbnailLoadPlan({
      rootHandleAvailable: Boolean(rootHandle),
      isDirectory,
      mediaType,
      hasDirectThumbnailSource,
      directThumbnailUrl,
      requestIdentity,
      previousRequestIdentity: requestIdentityRef.current,
      exactCachedThumbnailUrl,
    })

    if (loadPlan.kind === 'reset') {
      setThumbnailUrl(null)
      setThumbnailUrlIdentity(null)
      setThumbnailState(loadPlan.thumbnailState)
      return
    }

    if (loadPlan.kind === 'direct-thumbnail') {
      if (loadPlan.shouldClearGeneratedThumbnail) {
        setThumbnailUrl(null)
        setThumbnailUrlIdentity(null)
      }
      setThumbnailState(loadPlan.thumbnailState)
      return
    }

    if (loadPlan.kind === 'cached-thumbnail') {
      requestIdentityRef.current = loadPlan.thumbnailUrlIdentity
      setThumbnailUrl(loadPlan.thumbnailUrl)
      setThumbnailUrlIdentity(loadPlan.thumbnailUrlIdentity)
      setThumbnailState(loadPlan.thumbnailState)
      return
    }

    const pipelineMediaType = mediaType
    const pipelineRootHandle = rootHandle
    if (!pipelineMediaType || !pipelineRootHandle) {
      return
    }

    requestIdentityRef.current = loadPlan.requestIdentity
    let cancelled = false
    const controller = new AbortController()

    const loadThumbnail = async () => {
      if (loadPlan.shouldClearGeneratedThumbnail) {
        setThumbnailUrl(null)
        setThumbnailUrlIdentity(null)
      }
      setThumbnailState('loading')

      try {
        const url = await requestFileGridCardThumbnailJob({
          filePath: file.path,
          fileSize: file.size,
          fileLastModifiedMs,
          mediaType: pipelineMediaType,
          rootHandle: pipelineRootHandle,
          runtimeVideoThumbnailSourceUrl,
          thumbnailSizePreset,
          thumbnailPriority,
          signal: controller.signal,
        })

        if (!cancelled) {
          setThumbnailUrl(url)
          setThumbnailUrlIdentity(loadPlan.requestIdentity)
          setThumbnailState('ready')
        }
      } catch (error) {
        if (!cancelled) {
          const isAbort =
            error instanceof DOMException && error.name === 'AbortError'
          if (!isAbort) {
            setThumbnailState('failed')
            console.warn('[thumbnail] thumbnail job failed', {
              filePath: file.path,
              sizePreset: thumbnailSizePreset,
              error,
            })
          }
        }
      }
    }

    loadThumbnail()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    rootHandle,
    file.path,
    file.name,
    file.size,
    fileLastModifiedMs,
    isDirectory,
    mediaType,
    thumbnailSizePreset,
    thumbnailPriority,
    requestIdentity,
    exactCachedThumbnailUrl,
    runtimeVideoThumbnailSourceUrl,
    directThumbnailUrl,
    hasDirectThumbnailSource,
  ])

  const handleThumbnailImageLoad = useCallback(() => {
    setThumbnailState('ready')
  }, [])

  const handleThumbnailImageError = useCallback(() => {
    setThumbnailState('failed')
  }, [])

  return {
    thumbnailFrameView,
    handleThumbnailImageLoad,
    handleThumbnailImageError,
  }
}
