import { useCallback, useEffect, useRef, useState } from 'react'
import { TEXT_PREVIEW_MAX_BYTES } from '@/lib/filePreview'
import { createObjectUrlForFile, getFileFromPath, getMimeType } from '@/lib/fileSystem'
import {
  buildRuntimeFileContentUrl,
  loadRuntimeGlobalTrashTextPreview,
  loadRuntimeTextPreview,
} from '@/lib/runtimeApi'
import {
  buildFileContentUrlForItem,
  loadTextPreviewForItem,
} from '@/lib/fileAccess'
import { readFileSystemTextPreview } from '@/features/preview/lib/fileSystemTextPreview'
import type { PreviewFileLoadPlan } from '@/features/preview/lib/previewFileLoadPlan'
import type { FileItem, FilePreviewKind, TextPreviewPayload } from '@/types'

const INITIAL_TEXT_PREVIEW: TextPreviewPayload = {
  status: 'idle',
  content: null,
  fileSizeBytes: null,
  sizeLimitBytes: TEXT_PREVIEW_MAX_BYTES,
  error: null,
}

export interface UsePreviewFileLoaderOptions {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  previewKind: FilePreviewKind
  loadPlan: PreviewFileLoadPlan
}

export interface PreviewFileLoaderState {
  previewUrl: string | null
  textPreview: TextPreviewPayload
  fileMimeType: string | null
  fileSizeBytes: number | null
  fileLastModifiedMs: number | null
  isLoading: boolean
  error: string | null
}

export function usePreviewFileLoader({
  file,
  rootHandle,
  previewKind,
  loadPlan,
}: UsePreviewFileLoaderOptions): PreviewFileLoaderState {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [textPreview, setTextPreview] = useState<TextPreviewPayload>(INITIAL_TEXT_PREVIEW)
  const [fileMimeType, setFileMimeType] = useState<string | null>(null)
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null)
  const [fileLastModifiedMs, setFileLastModifiedMs] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentUrlRef = useRef<string | null>(null)

  const replacePreviewUrl = useCallback((nextUrl: string | null) => {
    if (currentUrlRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(currentUrlRef.current)
    }
    currentUrlRef.current = nextUrl
    setPreviewUrl(nextUrl)
  }, [])

  useEffect(() => {
    if (!file || file.kind !== 'file' || loadPlan.kind === 'empty') {
      replacePreviewUrl(null)
      setTextPreview(INITIAL_TEXT_PREVIEW)
      setFileMimeType(null)
      setFileSizeBytes(null)
      setFileLastModifiedMs(null)
      return
    }

    let cancelled = false

    const loadFile = async () => {
      setIsLoading(true)
      setError(null)
      setTextPreview(
        previewKind === 'text'
          ? {
            ...INITIAL_TEXT_PREVIEW,
            status: 'loading',
          }
          : INITIAL_TEXT_PREVIEW
      )

      try {
        switch (loadPlan.kind) {
          case 'file-access-text': {
            applyFileItemMetadata({
              file,
              setFileMimeType,
              setFileSizeBytes,
              setFileLastModifiedMs,
            })
            replacePreviewUrl(null)
            const textResult = await loadTextPreviewForItem(file, TEXT_PREVIEW_MAX_BYTES)
            if (cancelled) return
            setTextPreview({
              status: textResult.status,
              content: textResult.content,
              fileSizeBytes: textResult.fileSizeBytes,
              sizeLimitBytes: textResult.sizeLimitBytes,
              error: textResult.error,
            })
            return
          }
          case 'file-access-content':
            applyFileItemMetadata({
              file,
              setFileMimeType,
              setFileSizeBytes,
              setFileLastModifiedMs,
            })
            setTextPreview(INITIAL_TEXT_PREVIEW)
            replacePreviewUrl(buildFileContentUrlForItem(file))
            return
          case 'file-access-unsupported':
            applyFileItemMetadata({
              file,
              setFileMimeType,
              setFileSizeBytes,
              setFileLastModifiedMs,
            })
            setTextPreview(INITIAL_TEXT_PREVIEW)
            replacePreviewUrl(null)
            return
          case 'runtime-global-trash-text': {
            applyFileItemMetadata({
              file,
              setFileMimeType,
              setFileSizeBytes,
              setFileLastModifiedMs,
            })
            replacePreviewUrl(null)
            const textResult = await loadRuntimeGlobalTrashTextPreview({
              recycleId: loadPlan.recycleId,
              sizeLimitBytes: TEXT_PREVIEW_MAX_BYTES,
            })
            if (cancelled) return
            setFileSizeBytes(textResult.fileSizeBytes ?? file.size ?? null)
            setTextPreview(textResult)
            return
          }
          case 'runtime-global-trash-content':
            applyFileItemMetadata({
              file,
              setFileMimeType,
              setFileSizeBytes,
              setFileLastModifiedMs,
            })
            setTextPreview(INITIAL_TEXT_PREVIEW)
            replacePreviewUrl(loadPlan.contentUrl)
            return
          case 'runtime-text-preview':
            applyFileItemMetadata({
              file,
              setFileMimeType,
              setFileSizeBytes,
              setFileLastModifiedMs,
            })
            replacePreviewUrl(null)
            try {
              const textResult = await loadRuntimeTextPreview({
                rootPath: loadPlan.rootPath,
                rootRelativePath: loadPlan.rootRelativePath,
                sizeLimitBytes: TEXT_PREVIEW_MAX_BYTES,
              })
              if (cancelled) return
              setFileSizeBytes(textResult.fileSizeBytes ?? file.size ?? null)
              setTextPreview(textResult)
              return
            } catch {
              if (!loadPlan.canFallbackToFileSystem) throw new Error('当前文件无法通过工作区目录句柄读取')
            }
            break
          case 'runtime-file-content':
            applyFileItemMetadata({
              file,
              setFileMimeType,
              setFileSizeBytes,
              setFileLastModifiedMs,
            })
            setTextPreview(INITIAL_TEXT_PREVIEW)
            replacePreviewUrl(buildRuntimeFileContentUrl({
              rootPath: loadPlan.rootPath,
              rootRelativePath: loadPlan.rootRelativePath,
            }))
            return
          case 'file-system':
            break
          case 'unavailable':
            throw new Error(loadPlan.error)
        }

        if (!rootHandle) {
          throw new Error('当前文件无法通过工作区目录句柄读取')
        }

        const fileObj = await getFileFromPath(rootHandle, loadPlan.rootRelativePath)
        if (cancelled) return

        setFileMimeType(fileObj.type || getMimeType(file.name))
        setFileSizeBytes(fileObj.size)
        setFileLastModifiedMs(fileObj.lastModified || null)

        if (previewKind === 'text') {
          replacePreviewUrl(null)
          const textResult = await readFileSystemTextPreview(fileObj, TEXT_PREVIEW_MAX_BYTES)
          if (cancelled) return
          setTextPreview(textResult)
          return
        }

        setTextPreview(INITIAL_TEXT_PREVIEW)

        if (previewKind === 'image' || previewKind === 'video') {
          const nextUrl = createObjectUrlForFile(fileObj, file.name)
          if (cancelled) {
            URL.revokeObjectURL(nextUrl)
            return
          }
          replacePreviewUrl(nextUrl)
          return
        }

        replacePreviewUrl(null)
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
  }, [
    file,
    loadPlan,
    previewKind,
    replacePreviewUrl,
    rootHandle,
  ])

  useEffect(() => {
    return () => {
      if (currentUrlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrlRef.current)
      }
    }
  }, [])

  return {
    previewUrl,
    textPreview,
    fileMimeType,
    fileSizeBytes,
    fileLastModifiedMs,
    isLoading,
    error,
  }
}

function applyFileItemMetadata({
  file,
  setFileMimeType,
  setFileSizeBytes,
  setFileLastModifiedMs,
}: {
  file: FileItem
  setFileMimeType: (value: string | null) => void
  setFileSizeBytes: (value: number | null) => void
  setFileLastModifiedMs: (value: number | null) => void
}): void {
  setFileMimeType(file.mimeType || getMimeType(file.name))
  setFileSizeBytes(file.size ?? null)
  setFileLastModifiedMs(file.lastModifiedMs ?? file.lastModified?.getTime() ?? null)
}
