import { useEffect, useState, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
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
import { FilePreviewCanvas } from './FilePreviewCanvas'
import { PreviewHeaderBar } from './PreviewHeaderBar'
import { PreviewFaceCorrectionPanel } from '@/features/faces/components/PreviewFaceCorrectionPanel'
import { usePreviewFaceOverlays } from '@/features/faces/hooks/usePreviewFaceOverlays'
import type { PreviewFaceOverlayItem } from '@/features/faces/types'
import { usePreviewFileLoader } from '@/features/preview/hooks/usePreviewFileLoader'
import { usePreviewAnnotationTagActions } from '@/features/preview/hooks/usePreviewAnnotationTagActions'
import { usePreviewFileNameRenameAction } from '@/features/preview/hooks/usePreviewFileNameRenameAction'
import { usePreviewPluginResultAnnotationEffects } from '@/features/preview/hooks/usePreviewPluginResultAnnotationEffects'
import { resolvePreviewFileAccessPlan } from '@/features/preview/lib/previewFileAccess'
import { resolvePreviewFileLoadPlan } from '@/features/preview/lib/previewFileLoadPlan'
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
  const [selectedFaceForCorrection, setSelectedFaceForCorrection] = useState<PreviewFaceOverlayItem | null>(null)
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

  const {
    annotationTags,
    annotationTagOptions,
    annotationTagOptionsState,
    refreshCurrentPreviewFileTags,
    handleRequestAnnotationTagOptions,
    handleBindAnnotationTag,
    handleUnbindAnnotationTag,
  } = usePreviewAnnotationTagActions({
    file,
    rootHandle,
    rootId,
    canUseAnnotationContext,
    canManageAnnotationTags,
    annotationTagManageUnavailableReason,
  })
  const {
    isRenaming,
    handleSubmitFileNameRename,
  } = usePreviewFileNameRenameAction({
    file,
    rootHandle,
    rootId,
    canRenameFileName,
    renameUnavailableReason,
    onMutationCommitted,
  })

  const currentFileQueue = useMemo(
    () => (file ? (toolResultQueueState.byContextKey[file.path] ?? []) : []),
    [file, toolResultQueueState.byContextKey]
  )
  usePreviewPluginResultAnnotationEffects({
    file,
    rootHandle,
    rootId,
    canUseAnnotationContext,
    currentFileQueue,
  })
  const faceOverlayRefreshToken = useMemo(() => {
    if (!file || file.kind !== 'file') return ''
    return currentFileQueue
      .filter((item) => item.toolName === 'vision.face')
      .map((item) => `${item.id}:${item.status}`)
      .join('|')
  }, [currentFileQueue, file])
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

  useEffect(() => {
    setSelectedFaceForCorrection(null)
  }, [file?.path])

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
