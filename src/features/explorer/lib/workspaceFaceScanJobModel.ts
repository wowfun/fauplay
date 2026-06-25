import type { RuntimeToolActionAnnotation } from '@/lib/runtimeApi'
import type { PluginResultProgress } from '@/features/plugin-runtime/types'

export const WORKSPACE_FACE_SCAN_ACTION: RuntimeToolActionAnnotation = {
  key: 'detectVisibleAssets',
  label: '扫描当前目标媒体',
  description: '选中优先，否则扫描当前可见图片/视频；仅处理未检测资产，并执行识别聚类',
  intent: 'primary',
  arguments: {
    operation: 'detectAssets',
    onlyUndetected: true,
    runCluster: true,
    preCluster: true,
  },
}

export const FACE_SCAN_JOB_SUBMIT_TIMEOUT_MS = 30000
export const FACE_SCAN_JOB_POLL_TIMEOUT_MS = 15000
export const FACE_SCAN_JOB_CANCEL_TIMEOUT_MS = 15000
export const FACE_SCAN_JOB_POLL_INTERVAL_MS = 1000

export type FaceScanJobStatus = 'queued' | 'running' | 'canceling' | 'canceled' | 'succeeded' | 'failed'

interface ResolveWorkspaceFaceScanJobStartPlanParams {
  toolName: string
  toolTitle?: string | null
  actionLabel: string
  additionalArgs: Record<string, unknown>
  resolvedRootPath: string
  queueItemId: string
  startedAt: number
  requestSignature: string | null | undefined
}

interface ResolveWorkspaceFaceScanJobCancelPlanParams {
  item: {
    progress?: Pick<PluginResultProgress, 'jobId'> | null
  }
  trackedJobId?: string | null
}

interface ResolveWorkspaceFaceScanJobFinishPlanParams {
  contextKey: string
  queueItemId: string
  snapshot: FaceScanJobSnapshot
  finishedAt: number
}

interface ResolveWorkspaceFaceScanJobErrorPlanParams {
  contextKey: string
  queueItemId: string
  error: unknown
  finishedAt: number
}

export interface WorkspaceFaceScanJobStartPlan {
  queueItemId: string
  title: string
  requestArgs: Record<string, unknown>
  requestSignature: string
  startedAt: number
  missingRootPathError: string | null
  initialProgress: Pick<PluginResultProgress, 'current' | 'total' | 'message' | 'cancelable'>
}

export interface WorkspaceFaceScanJobCancelPlan {
  jobId: string
  endpointPath: string
  cancelProgress: Pick<PluginResultProgress, 'jobId' | 'cancelRequested' | 'cancelable' | 'message'>
}

export type WorkspaceFaceScanJobFinalizePlan =
  | {
    contextKey: string
    queueItemId: string
    status: 'success'
    result: Record<string, unknown>
    finishedAt: number
  }
  | {
    contextKey: string
    queueItemId: string
    status: 'error'
    error: string
    errorCode: 'FACE_SCAN_JOB_FAILED' | 'FACE_SCAN_JOB_ERROR'
    finishedAt: number
  }

export interface FaceScanJobSnapshot {
  ok?: boolean
  jobId?: string
  status?: FaceScanJobStatus
  total?: number
  unique?: number
  processed?: number
  scanned?: number
  skipped?: number
  failed?: number
  detectedFaces?: number
  currentPath?: unknown
  batchIndex?: unknown
  batchCount?: unknown
  preCluster?: unknown
  postCluster?: unknown
  recentItems?: unknown[]
  failureSummary?: unknown[]
  error?: string | null
}

function toNonNegativeNumber(value: unknown): number {
  const next = Number(value ?? 0)
  return Number.isFinite(next) ? Math.max(0, next) : 0
}

function toStatusLabel(status: FaceScanJobStatus): string {
  if (status === 'queued') return '排队中'
  if (status === 'running') return '扫描中'
  if (status === 'canceling') return '取消中'
  if (status === 'canceled') return '已取消'
  if (status === 'failed') return '失败'
  return '已完成'
}

export function readWorkspaceFaceScanProvidedRootPath(additionalArgs: Record<string, unknown>): string {
  return typeof additionalArgs.rootPath === 'string' && additionalArgs.rootPath.trim()
    ? additionalArgs.rootPath.trim()
    : ''
}

export function resolveWorkspaceFaceScanJobStartPlan({
  toolName,
  toolTitle,
  actionLabel,
  additionalArgs,
  resolvedRootPath,
  queueItemId,
  startedAt,
  requestSignature,
}: ResolveWorkspaceFaceScanJobStartPlanParams): WorkspaceFaceScanJobStartPlan {
  const providedRootPath = readWorkspaceFaceScanProvidedRootPath(additionalArgs)
  const rootPath = providedRootPath || resolvedRootPath
  const requestArgs = rootPath
    ? { ...additionalArgs, rootPath }
    : additionalArgs

  return {
    queueItemId,
    title: `${toolTitle || toolName} · ${actionLabel}`,
    requestArgs,
    requestSignature: requestSignature ?? `${queueItemId}:face-scan-job`,
    startedAt,
    missingRootPathError: rootPath ? null : '未设置有效 rootPath',
    initialProgress: {
      current: 0,
      total: Array.isArray(requestArgs.relativePaths) ? requestArgs.relativePaths.length : 0,
      message: '提交人脸扫描任务...',
      cancelable: false,
    },
  }
}

export function resolveWorkspaceFaceScanJobCancelPlan({
  item,
  trackedJobId,
}: ResolveWorkspaceFaceScanJobCancelPlanParams): WorkspaceFaceScanJobCancelPlan | null {
  const jobId = item.progress?.jobId || trackedJobId
  if (!jobId) return null

  return {
    jobId,
    endpointPath: `/v1/faces/detect-assets/jobs/${encodeURIComponent(jobId)}/cancel`,
    cancelProgress: {
      jobId,
      cancelRequested: true,
      cancelable: false,
      message: '正在取消人脸扫描任务...',
    },
  }
}

export function resolveWorkspaceFaceScanJobPollPath(jobId: string): string {
  return `/v1/faces/detect-assets/jobs/${encodeURIComponent(jobId)}`
}

export function resolveWorkspaceFaceScanJobFinishPlan({
  contextKey,
  queueItemId,
  snapshot,
  finishedAt,
}: ResolveWorkspaceFaceScanJobFinishPlanParams): WorkspaceFaceScanJobFinalizePlan {
  if (snapshot.status === 'failed') {
    return {
      contextKey,
      queueItemId,
      status: 'error',
      error: snapshot.error || '人脸扫描任务失败',
      errorCode: 'FACE_SCAN_JOB_FAILED',
      finishedAt,
    }
  }

  return {
    contextKey,
    queueItemId,
    status: 'success',
    result: toWorkspaceFaceScanJobResult(snapshot),
    finishedAt,
  }
}

export function resolveWorkspaceFaceScanJobErrorPlan({
  contextKey,
  queueItemId,
  error,
  finishedAt,
}: ResolveWorkspaceFaceScanJobErrorPlanParams): WorkspaceFaceScanJobFinalizePlan {
  return {
    contextKey,
    queueItemId,
    status: 'error',
    error: toWorkspaceFaceScanJobErrorMessage(error),
    errorCode: 'FACE_SCAN_JOB_ERROR',
    finishedAt,
  }
}

export function isWorkspaceFaceScanJobTerminal(status?: string): boolean {
  return status === 'canceled' || status === 'succeeded' || status === 'failed'
}

export function toWorkspaceFaceScanJobProgress(
  snapshot: FaceScanJobSnapshot,
  overrides: Partial<PluginResultProgress> = {}
): PluginResultProgress {
  const status = snapshot.status ?? 'queued'
  const current = toNonNegativeNumber(snapshot.processed)
  const total = toNonNegativeNumber(snapshot.total)

  return {
    jobId: snapshot.jobId,
    status,
    current,
    total,
    currentPath: typeof snapshot.currentPath === 'string' ? snapshot.currentPath : null,
    batchIndex: typeof snapshot.batchIndex === 'number' ? snapshot.batchIndex : undefined,
    batchCount: typeof snapshot.batchCount === 'number' ? snapshot.batchCount : undefined,
    scanned: toNonNegativeNumber(snapshot.scanned),
    skipped: toNonNegativeNumber(snapshot.skipped),
    failed: toNonNegativeNumber(snapshot.failed),
    detectedFaces: toNonNegativeNumber(snapshot.detectedFaces),
    cancelable: status === 'queued' || status === 'running',
    cancelRequested: status === 'canceling',
    message: `人脸扫描${toStatusLabel(status)}: ${current}/${total}`,
    ...overrides,
  }
}

export function toWorkspaceFaceScanJobErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '工具调用失败'
}

export function shouldRefreshAfterWorkspaceFaceScanJob(snapshot: FaceScanJobSnapshot): boolean {
  return (
    toNonNegativeNumber(snapshot.processed) > 0
    || toNonNegativeNumber(snapshot.scanned) > 0
    || toNonNegativeNumber(snapshot.detectedFaces) > 0
  )
}

export function toWorkspaceFaceScanJobResult(snapshot: FaceScanJobSnapshot): Record<string, unknown> {
  return {
    ok: snapshot.status !== 'failed',
    jobId: snapshot.jobId,
    status: snapshot.status,
    total: snapshot.total ?? 0,
    unique: snapshot.unique ?? 0,
    processed: snapshot.processed ?? 0,
    scanned: snapshot.scanned ?? 0,
    skipped: snapshot.skipped ?? 0,
    failed: snapshot.failed ?? 0,
    detectedFaces: snapshot.detectedFaces ?? 0,
    preCluster: snapshot.preCluster ?? null,
    postCluster: snapshot.postCluster ?? null,
    recentItems: snapshot.recentItems ?? [],
    failureSummary: snapshot.failureSummary ?? [],
    error: snapshot.error ?? null,
  }
}
