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
