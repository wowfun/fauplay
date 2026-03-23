import { useEffect, useState, useRef, useCallback, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import { getFilePreviewKind, isMediaPreviewKind, TEXT_PREVIEW_MAX_BYTES } from '@/lib/filePreview'
import { createObjectUrlForFile, getFileFromPath, getMimeType } from '@/lib/fileSystem'
import type { FileItem, TextPreviewPayload } from '@/types'
import type { GatewayToolDescriptor } from '@/lib/gateway'
import type { PlaybackOrder, PreviewSurface } from '@/features/preview/types/playback'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import type { PluginResultQueueState, PluginWorkbenchState } from '@/features/plugin-runtime/types'
import {
  getAnnotationDisplayStoreVersion,
  getFileLogicalTags,
  getGlobalAnnotationTagOptions,
  getGlobalAnnotationTagOptionsState,
  patchAnnotationSetValue,
  patchAnnotationTagBinding,
  patchAnnotationTagUnbinding,
  preloadFileAnnotationDisplaySnapshot,
  preloadAnnotationDisplaySnapshot,
  preloadGlobalAnnotationTagOptions,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'
import { FilePreviewCanvas } from './FilePreviewCanvas'
import { PreviewHeaderBar, type PreviewHeaderAnnotationTag } from './PreviewHeaderBar'
import type { PreviewRenameResult } from './PreviewTitleRow'
import { usePreviewFaceOverlays } from '@/features/faces/hooks/usePreviewFaceOverlays'
import type { PreviewFaceOverlayItem } from '@/features/faces/types'

interface FilePreviewPanelProps {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  previewActionTools: GatewayToolDescriptor[]
  onClose: () => void
  onOpenFullscreen?: () => void
  autoPlayEnabled: boolean
  autoPlayIntervalSec: number
  videoSeekStepSec: number
  videoPlaybackRate: number
  faceBboxVisible: boolean
  onToggleAutoPlay: () => void
  playbackOrder: PlaybackOrder
  onTogglePlaybackOrder: () => void
  onToggleFaceBboxVisible: () => void
  onAutoPlayIntervalChange: (sec: number) => void
  onVideoSeekStepChange: (sec: number) => void
  onVideoPlaybackRateChange: (rate: number) => void
  onVideoEnded: () => void
  onVideoPlaybackError: () => void
  presentation?: PreviewSurface
  forceAutoPlayOnOpen?: boolean
  toolResultQueueState: PluginResultQueueState
  setToolResultQueueState: Dispatch<SetStateAction<PluginResultQueueState>>
  toolWorkbenchState: PluginWorkbenchState
  setToolWorkbenchState: Dispatch<SetStateAction<PluginWorkbenchState>>
  enableContinuousAutoRunOwner: boolean
  toolPanelCollapsed: boolean
  onToggleToolPanelCollapsed: () => void
  toolPanelWidthPx: number
  onToolPanelWidthChange: (nextWidthPx: number) => void
  onMutationCommitted?: (params?: PreviewMutationCommitParams) => void | Promise<void>
  onOpenPersonDetail?: (personId: string | null) => void
  enableAnnotationTagShortcutOwner?: boolean
}

interface BatchRenameItemResult {
  nextRelativePath?: string
  ok?: boolean
  skipped?: boolean
  reasonCode?: string
  error?: string
}

interface LocalDataSetValueResult {
  relativePath: string
  fieldKey: string
  value: string
}

const INITIAL_TEXT_PREVIEW: TextPreviewPayload = {
  status: 'idle',
  content: null,
  fileSizeBytes: null,
  sizeLimitBytes: TEXT_PREVIEW_MAX_BYTES,
  error: null,
}

function containsNullByte(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0) return true
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function splitFileName(fileName: string): { baseName: string; extension: string } {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return {
      baseName: fileName,
      extension: '',
    }
  }

  return {
    baseName: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex),
  }
}

function getParentPath(relativePath: string): string {
  const segments = relativePath.split('/').filter(Boolean)
  if (segments.length <= 1) return ''
  return segments.slice(0, -1).join('/')
}

function joinRelativePath(parentPath: string, fileName: string): string {
  return parentPath ? `${parentPath}/${fileName}` : fileName
}

function readFirstBatchRenameItem(result: unknown): BatchRenameItemResult | null {
  if (!isRecord(result) || !Array.isArray(result.items) || result.items.length === 0) {
    return null
  }

  const first = result.items[0]
  if (!isRecord(first)) {
    return null
  }

  return {
    nextRelativePath: typeof first.nextRelativePath === 'string' ? first.nextRelativePath : undefined,
    ok: typeof first.ok === 'boolean' ? first.ok : undefined,
    skipped: typeof first.skipped === 'boolean' ? first.skipped : undefined,
    reasonCode: typeof first.reasonCode === 'string' ? first.reasonCode : undefined,
    error: typeof first.error === 'string' ? first.error : undefined,
  }
}

function toConflictAwareErrorMessage(item: BatchRenameItemResult, fallback: string): string {
  if (item.reasonCode === 'RENAME_TARGET_EXISTS') {
    return '目标名称已存在'
  }
  return item.error || fallback
}

function readLocalDataSetValueResult(result: unknown): LocalDataSetValueResult | null {
  if (!isRecord(result)) return null

  const relativePath = typeof result.relativePath === 'string' ? result.relativePath : ''
  const fieldKey = typeof result.fieldKey === 'string' ? result.fieldKey : ''
  const value = typeof result.value === 'string' ? result.value : ''
  if (!relativePath || !fieldKey || !value) {
    return null
  }

  return {
    relativePath,
    fieldKey,
    value,
  }
}

export function FilePreviewPanel({
  file,
  rootHandle,
  rootId,
  previewActionTools,
  onClose,
  onOpenFullscreen,
  autoPlayEnabled,
  autoPlayIntervalSec,
  videoSeekStepSec,
  videoPlaybackRate,
  faceBboxVisible,
  onToggleAutoPlay,
  playbackOrder,
  onTogglePlaybackOrder,
  onToggleFaceBboxVisible,
  onAutoPlayIntervalChange,
  onVideoSeekStepChange,
  onVideoPlaybackRateChange,
  onVideoEnded,
  onVideoPlaybackError,
  presentation = 'panel',
  forceAutoPlayOnOpen = false,
  toolResultQueueState,
  setToolResultQueueState,
  toolWorkbenchState,
  setToolWorkbenchState,
  enableContinuousAutoRunOwner,
  toolPanelCollapsed,
  onToggleToolPanelCollapsed,
  toolPanelWidthPx,
  onToolPanelWidthChange,
  onMutationCommitted,
  onOpenPersonDetail,
  enableAnnotationTagShortcutOwner = false,
}: FilePreviewPanelProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [textPreview, setTextPreview] = useState<TextPreviewPayload>(INITIAL_TEXT_PREVIEW)
  const [fileMimeType, setFileMimeType] = useState<string | null>(null)
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null)
  const [fileLastModifiedMs, setFileLastModifiedMs] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const handledLocalDataQueueItemIdRef = useRef<string | null>(null)
  const handledVisionFaceQueueItemIdRef = useRef<string | null>(null)
  const isFullscreen = presentation === 'lightbox'
  const previewKind = file && file.kind === 'file' ? getFilePreviewKind(file.name) : 'unsupported'
  useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )

  const hasBatchRenameTool = useMemo(
    () => previewActionTools.some((tool) => tool.name === 'fs.batchRename'),
    [previewActionTools]
  )
  const hasVisionFaceTool = useMemo(
    () => previewActionTools.some((tool) => tool.name === 'vision.face' && tool.scopes.includes('file')),
    [previewActionTools]
  )
  const hasLocalDataTool = useMemo(
    () => previewActionTools.some((tool) => tool.name === 'local.data' && tool.scopes.includes('file')),
    [previewActionTools]
  )

  const renameUnavailableReason = useMemo(() => {
    if (!file || file.kind !== 'file') {
      return '当前项不可重命名'
    }
    if (!rootHandle || !rootId) {
      return '工具上下文不完整'
    }
    if (!hasBatchRenameTool) {
      return '重命名能力不可用（网关离线或未注册 fs.batchRename）'
    }
    return null
  }, [file, hasBatchRenameTool, rootHandle, rootId])

  const canRenameFileName = renameUnavailableReason === null
  const annotationTagManageUnavailableReason = useMemo(() => {
    if (!file || file.kind !== 'file') {
      return '当前项不可管理标签'
    }
    if (!rootHandle || !rootId) {
      return '工具上下文不完整'
    }
    if (!hasLocalDataTool) {
      return '标签管理能力不可用（网关离线或未注册 local.data）'
    }
    return null
  }, [file, hasLocalDataTool, rootHandle, rootId])
  const canManageAnnotationTags = annotationTagManageUnavailableReason === null

  useEffect(() => {
    if (!rootId || !rootHandle) return
    void preloadAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
    })
  }, [rootHandle, rootId])

  useEffect(() => {
    if (!rootId || !rootHandle || !file || file.kind !== 'file') return
    void preloadFileAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      relativePath: file.path,
      force: true,
    })
  }, [file, rootHandle, rootId])

  const replacePreviewUrl = useCallback((nextUrl: string | null) => {
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current)
    }
    currentUrlRef.current = nextUrl
    setPreviewUrl(nextUrl)
  }, [])

  const currentFileQueue = useMemo(
    () => (file ? (toolResultQueueState.byContextKey[file.path] ?? []) : []),
    [file, toolResultQueueState.byContextKey]
  )
  const faceOverlayRefreshToken = useMemo(() => {
    if (!file || file.kind !== 'file') return ''
    return currentFileQueue
      .filter((item) => item.toolName === 'vision.face')
      .map((item) => `${item.id}:${item.status}`)
      .join('|')
  }, [currentFileQueue, file])
  const refreshCurrentPreviewFileTags = useCallback(async () => {
    if (!file || file.kind !== 'file' || !rootId || !rootHandle) return
    await preloadFileAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      relativePath: file.path,
      force: true,
    })
  }, [file, rootHandle, rootId])
  const refreshGlobalAnnotationTagOptions = useCallback(async () => {
    await preloadGlobalAnnotationTagOptions({
      force: true,
    })
  }, [])
  const {
    items: faceOverlays,
    isLoading: faceOverlayLoading,
    error: faceOverlayError,
  } = usePreviewFaceOverlays({
    file,
    rootHandle,
    rootId,
    previewKind,
    enabled: hasVisionFaceTool,
    refreshToken: faceOverlayRefreshToken,
    onFaceMutationCommitted: refreshCurrentPreviewFileTags,
  })

  const handleFaceOverlayClick = useCallback((overlay: PreviewFaceOverlayItem) => {
    if (!overlay.personId) return
    onOpenPersonDetail?.(overlay.personId)
  }, [onOpenPersonDetail])

  const handleRequestAnnotationTagOptions = useCallback(() => {
    if (!canManageAnnotationTags) return
    void preloadGlobalAnnotationTagOptions()
  }, [canManageAnnotationTags])

  const handleBindAnnotationTag = useCallback(async ({ key, value }: { key: string; value: string }) => {
    if (!file || file.kind !== 'file') {
      throw new Error('当前项不可管理标签')
    }
    if (!canManageAnnotationTags || !rootHandle || !rootId) {
      throw new Error(annotationTagManageUnavailableReason || '标签管理能力不可用')
    }

    const rollback = patchAnnotationTagBinding({
      rootId,
      relativePath: file.path,
      key,
      value,
    })

    try {
      const result = await dispatchSystemTool({
        toolName: 'local.data',
        rootHandle,
        rootId,
        additionalArgs: {
          operation: 'bindAnnotationTag',
          relativePath: file.path,
          key,
          value,
        },
      })

      if (!result.ok) {
        throw new Error(result.error || '标签绑定失败')
      }

      await Promise.allSettled([
        refreshCurrentPreviewFileTags(),
        refreshGlobalAnnotationTagOptions(),
      ])
    } catch (error) {
      rollback?.()
      await Promise.allSettled([
        refreshCurrentPreviewFileTags(),
        refreshGlobalAnnotationTagOptions(),
      ])
      throw error
    }
  }, [
    annotationTagManageUnavailableReason,
    canManageAnnotationTags,
    file,
    refreshCurrentPreviewFileTags,
    refreshGlobalAnnotationTagOptions,
    rootHandle,
    rootId,
  ])

  const handleUnbindAnnotationTag = useCallback(async (tag: PreviewHeaderAnnotationTag) => {
    if (!file || file.kind !== 'file') {
      throw new Error('当前项不可管理标签')
    }
    if (!canManageAnnotationTags || !rootHandle || !rootId) {
      throw new Error(annotationTagManageUnavailableReason || '标签管理能力不可用')
    }

    const rollback = patchAnnotationTagUnbinding({
      rootId,
      relativePath: file.path,
      key: tag.key,
      value: tag.value,
    })

    try {
      const result = await dispatchSystemTool({
        toolName: 'local.data',
        rootHandle,
        rootId,
        additionalArgs: {
          operation: 'unbindAnnotationTag',
          relativePath: file.path,
          key: tag.key,
          value: tag.value,
        },
      })

      if (!result.ok) {
        throw new Error(result.error || '标签删除失败')
      }

      await Promise.allSettled([
        refreshCurrentPreviewFileTags(),
        refreshGlobalAnnotationTagOptions(),
      ])
    } catch (error) {
      rollback?.()
      await Promise.allSettled([
        refreshCurrentPreviewFileTags(),
        refreshGlobalAnnotationTagOptions(),
      ])
      throw error
    }
  }, [
    annotationTagManageUnavailableReason,
    canManageAnnotationTags,
    file,
    refreshCurrentPreviewFileTags,
    refreshGlobalAnnotationTagOptions,
    rootHandle,
    rootId,
  ])

  useEffect(() => {
    if (!file || !rootHandle) {
      replacePreviewUrl(null)
      setTextPreview(INITIAL_TEXT_PREVIEW)
      setFileMimeType(null)
      setFileSizeBytes(null)
      setFileLastModifiedMs(null)
      return
    }

    let cancelled = false
    const previewKind = getFilePreviewKind(file.name)

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
        const fileObj = await getFileFromPath(rootHandle, file.path)
        if (cancelled) return

        setFileMimeType(fileObj.type || getMimeType(file.name))
        setFileSizeBytes(fileObj.size)
        setFileLastModifiedMs(fileObj.lastModified || null)

        if (previewKind === 'text') {
          replacePreviewUrl(null)
          if (fileObj.size > TEXT_PREVIEW_MAX_BYTES) {
            if (cancelled) return
            setTextPreview({
              status: 'too_large',
              content: null,
              fileSizeBytes: fileObj.size,
              sizeLimitBytes: TEXT_PREVIEW_MAX_BYTES,
              error: null,
            })
            return
          }

          try {
            const bytes = new Uint8Array(await fileObj.arrayBuffer())
            if (cancelled) return
            if (containsNullByte(bytes)) {
              setTextPreview({
                status: 'binary',
                content: null,
                fileSizeBytes: fileObj.size,
                sizeLimitBytes: TEXT_PREVIEW_MAX_BYTES,
                error: null,
              })
              return
            }

            const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
            if (cancelled) return
            setTextPreview({
              status: 'ready',
              content,
              fileSizeBytes: fileObj.size,
              sizeLimitBytes: TEXT_PREVIEW_MAX_BYTES,
              error: null,
            })
          } catch (textError) {
            if (cancelled) return
            setTextPreview({
              status: 'error',
              content: null,
              fileSizeBytes: fileObj.size,
              sizeLimitBytes: TEXT_PREVIEW_MAX_BYTES,
              error: (textError as Error).message,
            })
          }
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
  }, [file, rootHandle, replacePreviewUrl])

  useEffect(() => {
    return () => {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current)
      }
    }
  }, [])

  const handleSubmitFileNameRename = useCallback(async (nextBaseName: string): Promise<PreviewRenameResult> => {
    if (!file || file.kind !== 'file') {
      return { ok: false, error: '当前项不可重命名' }
    }
    if (!canRenameFileName || !rootHandle || !rootId) {
      return { ok: false, error: renameUnavailableReason || '重命名能力不可用' }
    }

    const { baseName, extension } = splitFileName(file.name)
    if (nextBaseName === baseName) {
      return { ok: true }
    }

    const parentPath = getParentPath(file.path)
    const expectedRelativePath = joinRelativePath(parentPath, `${nextBaseName}${extension}`)
    const renameRuleArgs = {
      relativePaths: [file.path],
      nameMask: '[N]',
      findText: baseName,
      replaceText: nextBaseName,
      searchMode: 'plain',
    }

    setIsRenaming(true)
    try {
      const dryRunResult = await dispatchSystemTool({
        toolName: 'fs.batchRename',
        rootHandle,
        rootId,
        additionalArgs: {
          ...renameRuleArgs,
          confirm: false,
        },
      })

      if (!dryRunResult.ok) {
        return { ok: false, error: dryRunResult.error || '重命名预演失败' }
      }

      const dryRunItem = readFirstBatchRenameItem(dryRunResult.result)
      if (!dryRunItem) {
        return { ok: false, error: '重命名预演返回无效结果' }
      }

      if (dryRunItem.ok !== true || dryRunItem.skipped === true) {
        return { ok: false, error: toConflictAwareErrorMessage(dryRunItem, '重命名预演失败') }
      }

      if (dryRunItem.nextRelativePath !== expectedRelativePath) {
        return { ok: false, error: '目标名称已存在' }
      }

      const commitResult = await dispatchSystemTool({
        toolName: 'fs.batchRename',
        rootHandle,
        rootId,
        additionalArgs: {
          ...renameRuleArgs,
          confirm: true,
        },
      })

      if (!commitResult.ok) {
        return { ok: false, error: commitResult.error || '重命名提交失败' }
      }

      const commitItem = readFirstBatchRenameItem(commitResult.result)
      if (!commitItem) {
        return { ok: false, error: '重命名提交返回无效结果' }
      }

      if (commitItem.ok !== true || commitItem.skipped === true) {
        return { ok: false, error: toConflictAwareErrorMessage(commitItem, '重命名提交失败') }
      }

      if (commitItem.nextRelativePath && commitItem.nextRelativePath !== expectedRelativePath) {
        return { ok: false, error: '目标名称已存在' }
      }

      await onMutationCommitted?.({ preferredPreviewPath: expectedRelativePath })
      return { ok: true }
    } finally {
      setIsRenaming(false)
    }
  }, [canRenameFileName, file, onMutationCommitted, renameUnavailableReason, rootHandle, rootId])

  useEffect(() => {
    if (!file || file.kind !== 'file' || !rootId) {
      handledLocalDataQueueItemIdRef.current = null
      return
    }

    const latestLocalDataSuccess = currentFileQueue.find((item) => (
      item.toolName === 'local.data'
      && item.status === 'success'
    ))
    if (!latestLocalDataSuccess) return
    if (handledLocalDataQueueItemIdRef.current === latestLocalDataSuccess.id) return
    handledLocalDataQueueItemIdRef.current = latestLocalDataSuccess.id

    const setValueResult = readLocalDataSetValueResult(latestLocalDataSuccess.result)
    if (setValueResult) {
      patchAnnotationSetValue({
        rootId,
        relativePath: setValueResult.relativePath,
        fieldKey: setValueResult.fieldKey,
        value: setValueResult.value,
      })
      return
    }

    if (!rootHandle || file.kind !== 'file') return
    void preloadFileAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      relativePath: file.path,
      force: true,
    })
  }, [currentFileQueue, file, rootHandle, rootId])

  useEffect(() => {
    if (!file || file.kind !== 'file' || !rootId) {
      handledVisionFaceQueueItemIdRef.current = null
      return
    }

    const latestVisionFaceSuccess = currentFileQueue.find((item) => (
      item.toolName === 'vision.face'
      && item.status === 'success'
    ))
    if (!latestVisionFaceSuccess) return
    if (handledVisionFaceQueueItemIdRef.current === latestVisionFaceSuccess.id) return
    handledVisionFaceQueueItemIdRef.current = latestVisionFaceSuccess.id

    void refreshCurrentPreviewFileTags()
  }, [currentFileQueue, file, refreshCurrentPreviewFileTags, rootId])

  const annotationTags: PreviewHeaderAnnotationTag[] = (
    file && file.kind === 'file' && rootId
      ? getFileLogicalTags(rootId, file.path).map((tag) => ({
        tagKey: tag.tagKey,
        key: tag.key,
        value: tag.value,
        sources: tag.sources,
        hasMetaAnnotation: tag.hasMetaAnnotation,
        representativeSource: tag.representativeSource,
      }))
      : []
  )
  const annotationTagOptions = getGlobalAnnotationTagOptions()
  const annotationTagOptionsState = getGlobalAnnotationTagOptionsState()

  if (!file) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-muted-foreground p-4"
      >
        <p className="text-sm">选择文件以预览</p>
      </div>
    )
  }

  const isMediaPreview = isMediaPreviewKind(previewKind)
  const isVideoPreview = previewKind === 'video'
  const showFaceBboxToggle = hasVisionFaceTool && previewKind === 'image'

  return (
    <div className={isFullscreen ? 'flex flex-col h-full bg-background' : 'flex flex-col h-full bg-card border-l border-border'}>
      <PreviewHeaderBar
        fileName={file.name}
        isFullscreen={isFullscreen}
        showPlaybackControls={isMediaPreview}
        isVideoPreview={isVideoPreview}
        autoPlayEnabled={autoPlayEnabled}
        autoPlayIntervalSec={autoPlayIntervalSec}
        videoSeekStepSec={videoSeekStepSec}
        videoPlaybackRate={videoPlaybackRate}
        showFaceBboxToggle={showFaceBboxToggle}
        faceBboxVisible={faceBboxVisible}
        onToggleAutoPlay={onToggleAutoPlay}
        playbackOrder={playbackOrder}
        onTogglePlaybackOrder={onTogglePlaybackOrder}
        onToggleFaceBboxVisible={onToggleFaceBboxVisible}
        onAutoPlayIntervalChange={onAutoPlayIntervalChange}
        onVideoSeekStepChange={onVideoSeekStepChange}
        onVideoPlaybackRateChange={onVideoPlaybackRateChange}
        onClose={onClose}
        canRenameFileName={canRenameFileName}
        renameInFlight={isRenaming}
        renameUnavailableReason={renameUnavailableReason}
        onSubmitFileNameRename={handleSubmitFileNameRename}
        annotationTags={annotationTags}
        canManageAnnotationTags={canManageAnnotationTags}
        annotationTagManageUnavailableReason={annotationTagManageUnavailableReason}
        annotationTagOptions={annotationTagOptions}
        annotationTagOptionsStatus={annotationTagOptionsState.status}
        annotationTagOptionsError={annotationTagOptionsState.error}
        onRequestAnnotationTagOptions={handleRequestAnnotationTagOptions}
        onBindAnnotationTag={handleBindAnnotationTag}
        onUnbindAnnotationTag={handleUnbindAnnotationTag}
        enableOpenAnnotationTagByShortcut={enableAnnotationTagShortcutOwner}
        rootId={rootId}
        relativePath={file.kind === 'file' ? file.path : null}
      />

      <FilePreviewCanvas
        file={file}
        rootHandle={rootHandle}
        rootId={rootId}
        previewActionTools={previewActionTools}
        previewUrl={previewUrl}
        textPreview={textPreview}
        fileMimeType={fileMimeType}
        fileSizeBytes={fileSizeBytes}
        fileLastModifiedMs={fileLastModifiedMs}
        isLoading={isLoading}
        error={error}
        onOpenFullscreen={isFullscreen ? undefined : onOpenFullscreen}
        autoPlayVideo={isMediaPreview && (autoPlayEnabled || forceAutoPlayOnOpen)}
        videoPlaybackRate={videoPlaybackRate}
        isFullscreen={isFullscreen}
        onVideoEnded={onVideoEnded}
        onVideoPlaybackError={onVideoPlaybackError}
        showFaceOverlays={faceBboxVisible}
        toolResultQueueState={toolResultQueueState}
        setToolResultQueueState={setToolResultQueueState}
        toolWorkbenchState={toolWorkbenchState}
        setToolWorkbenchState={setToolWorkbenchState}
        enableContinuousAutoRunOwner={enableContinuousAutoRunOwner}
        enableAnnotationTagShortcutOwner={enableAnnotationTagShortcutOwner}
        toolPanelCollapsed={toolPanelCollapsed}
        onToggleToolPanelCollapsed={onToggleToolPanelCollapsed}
        toolPanelWidthPx={toolPanelWidthPx}
        onToolPanelWidthChange={onToolPanelWidthChange}
        onMutationCommitted={onMutationCommitted}
        faceOverlays={faceOverlays}
        faceOverlayLoading={faceOverlayLoading}
        faceOverlayError={faceOverlayError}
        onFaceOverlayClick={handleFaceOverlayClick}
      />
    </div>
  )
}
