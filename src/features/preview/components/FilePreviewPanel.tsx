import { useEffect, useState, useRef, useCallback, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import { getFilePreviewKind, isMediaPreviewKind } from '@/lib/filePreview'
import {
  buildRuntimeGlobalTrashFileContentUrlForItem,
  resolveRuntimeGlobalTrashRecycleId,
  resolveRuntimeFileLocator,
  type RuntimeToolDescriptor,
} from '@/lib/runtimeApi'
import type { FileItem, ResultProjection } from '@/types'
import { getBoundRootPath } from '@/lib/reveal'
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
import { PreviewFaceCorrectionPanel } from '@/features/faces/components/PreviewFaceCorrectionPanel'
import { usePreviewFaceOverlays } from '@/features/faces/hooks/usePreviewFaceOverlays'
import type { PreviewFaceOverlayItem } from '@/features/faces/types'
import { usePreviewFileLoader } from '@/features/preview/hooks/usePreviewFileLoader'
import { resolvePreviewFileAccessPlan } from '@/features/preview/lib/previewFileAccess'
import { resolvePreviewFileLoadPlan } from '@/features/preview/lib/previewFileLoadPlan'
import {
  createPreviewFileNameRenamePlan,
  readPreviewLocalDataSetValueResult,
  resolvePreviewBatchRenameToolResult,
} from '@/features/preview/lib/previewFileEditModel'
import { resolvePreviewPanelCapabilityModel } from '@/features/preview/lib/previewPanelCapabilityModel'

interface FilePreviewPanelProps {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  previewActionTools: RuntimeToolDescriptor[]
  onClose: () => void
  onOpenFullscreen?: () => void
  titleMode?: 'actionable' | 'static'
  showUnavailableReasons?: boolean
  showNavigationButtons?: boolean
  enableImageSwipe?: boolean
  canNavigatePrev?: boolean
  canNavigateNext?: boolean
  onNavigatePrev?: () => void
  onNavigateNext?: () => void
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
  activeProjection: ResultProjection | null
  onActivateProjection: (projection: ResultProjection) => void
  onDismissProjectionTool: (toolName: string) => void
}

export function FilePreviewPanel({
  file,
  rootHandle,
  rootId,
  previewActionTools,
  onClose,
  onOpenFullscreen,
  titleMode = 'actionable',
  showUnavailableReasons = true,
  showNavigationButtons = false,
  enableImageSwipe = false,
  canNavigatePrev = false,
  canNavigateNext = false,
  onNavigatePrev,
  onNavigateNext,
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
  activeProjection,
  onActivateProjection,
  onDismissProjectionTool,
}: FilePreviewPanelProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [selectedFaceForCorrection, setSelectedFaceForCorrection] = useState<PreviewFaceOverlayItem | null>(null)
  const handledLocalDataQueueItemIdRef = useRef<string | null>(null)
  const handledVisionFaceQueueItemIdRef = useRef<string | null>(null)
  const isFullscreen = presentation === 'lightbox'
  const previewKind = file && file.kind === 'file' ? getFilePreviewKind(file.name) : 'unsupported'
  const boundRootPath = useMemo(
    () => (rootId ? getBoundRootPath(rootId) : null),
    [rootId]
  )
  const runtimeFileLocator = useMemo(
    () => (file && file.kind === 'file' ? resolveRuntimeFileLocator(file, boundRootPath) : null),
    [boundRootPath, file]
  )
  const runtimeGlobalTrashRecycleId = useMemo(
    () => (file && file.kind === 'file' ? resolveRuntimeGlobalTrashRecycleId(file) : null),
    [file]
  )
  const runtimeGlobalTrashFileContentUrl = useMemo(
    () => (file && file.kind === 'file' ? buildRuntimeGlobalTrashFileContentUrlForItem(file) : null),
    [file]
  )
  const previewAccessPlan = useMemo(() => resolvePreviewFileAccessPlan({
    file,
    previewKind,
    rootHandleAvailable: Boolean(rootHandle),
    boundRootPath,
    runtimeFileLocator,
    runtimeGlobalTrashRecycleId,
    runtimeGlobalTrashFileContentUrl,
  }), [
    boundRootPath,
    file,
    previewKind,
    rootHandle,
    runtimeFileLocator,
    runtimeGlobalTrashFileContentUrl,
    runtimeGlobalTrashRecycleId,
  ])
  const {
    canAccessThroughCurrentRoot,
    shouldUseFileAccess,
  } = previewAccessPlan
  const previewLoadPlan = useMemo(() => resolvePreviewFileLoadPlan({
    file,
    previewKind,
    accessPlan: previewAccessPlan,
    runtimeFileLocator,
    runtimeGlobalTrashRecycleId,
    runtimeGlobalTrashFileContentUrl,
  }), [
    file,
    previewAccessPlan,
    previewKind,
    runtimeFileLocator,
    runtimeGlobalTrashFileContentUrl,
    runtimeGlobalTrashRecycleId,
  ])
  const {
    previewUrl,
    textPreview,
    fileMimeType,
    fileSizeBytes,
    fileLastModifiedMs,
    isLoading,
    error,
  } = usePreviewFileLoader({
    file,
    rootHandle,
    previewKind,
    loadPlan: previewLoadPlan,
  })
  useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )

  const {
    canUseAnnotationContext,
    hasVisionFaceTool,
    renameUnavailableReason,
    canRenameFileName,
    annotationTagManageUnavailableReason,
    canManageAnnotationTags,
  } = useMemo(() => resolvePreviewPanelCapabilityModel({
    file,
    rootId,
    rootHandleAvailable: Boolean(rootHandle),
    boundRootPath,
    canAccessThroughCurrentRoot,
    shouldUseFileAccess,
    previewActionTools,
  }), [
    boundRootPath,
    canAccessThroughCurrentRoot,
    file,
    previewActionTools,
    rootHandle,
    rootId,
    shouldUseFileAccess,
  ])
  const displayRenameUnavailableReason = showUnavailableReasons ? renameUnavailableReason : null
  const displayAnnotationTagManageUnavailableReason = showUnavailableReasons
    ? annotationTagManageUnavailableReason
    : null

  useEffect(() => {
    if (!rootId || !canUseAnnotationContext) return
    void preloadAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      rootLabel: null,
    })
  }, [canUseAnnotationContext, rootHandle, rootId])

  useEffect(() => {
    if (!rootId || !file || file.kind !== 'file' || !canUseAnnotationContext) return
    void preloadFileAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      rootLabel: null,
      relativePath: file.path,
      force: true,
    })
  }, [canUseAnnotationContext, file, rootHandle, rootId])

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
    if (!file || file.kind !== 'file' || !rootId || !canUseAnnotationContext) return
    await preloadFileAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      rootLabel: null,
      relativePath: file.path,
      force: true,
    })
  }, [canUseAnnotationContext, file, rootHandle, rootId])
  const refreshGlobalAnnotationTagOptions = useCallback(async () => {
    await preloadGlobalAnnotationTagOptions({
      force: true,
    })
  }, [])
  const {
    items: faceOverlays,
    isLoading: faceOverlayLoading,
    error: faceOverlayError,
    reload: reloadFaceOverlays,
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
    setSelectedFaceForCorrection(overlay)
  }, [])

  const handleFaceMutationCommitted = useCallback(async () => {
    await Promise.allSettled([
      refreshCurrentPreviewFileTags(),
      onMutationCommitted?.(),
    ])
    reloadFaceOverlays()
  }, [onMutationCommitted, refreshCurrentPreviewFileTags, reloadFaceOverlays])

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
    setSelectedFaceForCorrection(null)
  }, [file?.path])

  const handleSubmitFileNameRename = useCallback(async (nextBaseName: string): Promise<PreviewRenameResult> => {
    if (!file || file.kind !== 'file') {
      return { ok: false, error: '当前项不可重命名' }
    }
    if (!canRenameFileName || !rootId) {
      return { ok: false, error: renameUnavailableReason || '重命名能力不可用' }
    }

    const renamePlan = createPreviewFileNameRenamePlan(file, nextBaseName)
    if (!renamePlan) {
      return { ok: true }
    }

    setIsRenaming(true)
    try {
      const dryRunResult = await dispatchSystemTool({
        toolName: 'fs.batchRename',
        rootHandle,
        rootId,
        additionalArgs: {
          ...renamePlan.ruleArgs,
          confirm: false,
        },
      })

      const dryRunResolution = resolvePreviewBatchRenameToolResult(dryRunResult, {
        expectedRelativePath: renamePlan.expectedRelativePath,
        fallbackError: '重命名预演失败',
        invalidResultError: '重命名预演返回无效结果',
        requireExpectedRelativePath: true,
      })
      if (!dryRunResolution.ok) {
        return dryRunResolution
      }

      const commitResult = await dispatchSystemTool({
        toolName: 'fs.batchRename',
        rootHandle,
        rootId,
        additionalArgs: {
          ...renamePlan.ruleArgs,
          confirm: true,
        },
      })

      const commitResolution = resolvePreviewBatchRenameToolResult(commitResult, {
        expectedRelativePath: renamePlan.expectedRelativePath,
        fallbackError: '重命名提交失败',
        invalidResultError: '重命名提交返回无效结果',
        requireExpectedRelativePath: false,
      })
      if (!commitResolution.ok) {
        return commitResolution
      }

      await onMutationCommitted?.({ preferredPreviewPath: renamePlan.expectedRelativePath })
      return { ok: true }
    } finally {
      setIsRenaming(false)
    }
  }, [
    canRenameFileName,
    file,
    onMutationCommitted,
    renameUnavailableReason,
    rootHandle,
    rootId,
  ])

  useEffect(() => {
    if (!file || file.kind !== 'file' || !rootId || !canUseAnnotationContext) {
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

    const setValueResult = readPreviewLocalDataSetValueResult(latestLocalDataSuccess.result)
    if (setValueResult) {
      patchAnnotationSetValue({
        rootId,
        relativePath: setValueResult.relativePath,
        fieldKey: setValueResult.fieldKey,
        value: setValueResult.value,
      })
      return
    }

    void preloadFileAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      rootLabel: null,
      relativePath: file.path,
      force: true,
    })
  }, [canUseAnnotationContext, currentFileQueue, file, rootHandle, rootId])

  useEffect(() => {
    if (!file || file.kind !== 'file' || !rootId || !canUseAnnotationContext) {
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
  }, [canUseAnnotationContext, currentFileQueue, file, refreshCurrentPreviewFileTags, rootId])

  const annotationTags: PreviewHeaderAnnotationTag[] = (
    file && file.kind === 'file' && rootId && canUseAnnotationContext
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
    <div className={isFullscreen ? 'relative flex h-full flex-col bg-background' : 'relative flex h-full flex-col border-l border-border bg-card'}>
      <PreviewHeaderBar
        fileName={file.name}
        isFullscreen={isFullscreen}
        titleMode={titleMode}
        showUnavailableReasons={showUnavailableReasons}
        showPlaybackControls={isMediaPreview}
        showNavigationButtons={showNavigationButtons && isMediaPreview}
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
        canNavigatePrev={canNavigatePrev}
        canNavigateNext={canNavigateNext}
        onNavigatePrev={onNavigatePrev}
        onNavigateNext={onNavigateNext}
        onClose={onClose}
        canRenameFileName={canRenameFileName}
        renameInFlight={isRenaming}
        renameUnavailableReason={displayRenameUnavailableReason}
        onSubmitFileNameRename={handleSubmitFileNameRename}
        annotationTags={annotationTags}
        canManageAnnotationTags={canManageAnnotationTags}
        annotationTagManageUnavailableReason={displayAnnotationTagManageUnavailableReason}
        annotationTagOptions={annotationTagOptions}
        annotationTagOptionsStatus={annotationTagOptionsState.status}
        annotationTagOptionsError={annotationTagOptionsState.error}
        onRequestAnnotationTagOptions={handleRequestAnnotationTagOptions}
        onBindAnnotationTag={handleBindAnnotationTag}
        onUnbindAnnotationTag={handleUnbindAnnotationTag}
        enableOpenAnnotationTagByShortcut={enableAnnotationTagShortcutOwner}
        rootId={rootId}
        relativePath={canUseAnnotationContext && file.kind === 'file' ? file.path : null}
      />

      <PreviewFaceCorrectionPanel
        face={selectedFaceForCorrection}
        rootHandle={rootHandle}
        rootId={rootId || ''}
        onClose={() => setSelectedFaceForCorrection(null)}
        onMutationCommitted={handleFaceMutationCommitted}
        onOpenPersonDetail={onOpenPersonDetail}
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
        enableImageSwipe={enableImageSwipe && isFullscreen && previewKind === 'image'}
        onOpenFullscreen={isFullscreen ? undefined : onOpenFullscreen}
        onNavigatePrev={onNavigatePrev}
        onNavigateNext={onNavigateNext}
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
        activeProjection={activeProjection}
        onActivateProjection={onActivateProjection}
        onDismissProjectionTool={onDismissProjectionTool}
      />
    </div>
  )
}
