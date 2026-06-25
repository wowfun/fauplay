export type PreviewContinuousPreviewViewState = 'loading' | 'error' | 'ready' | 'empty'

export interface PreviewContinuousToolCandidate<TTool = unknown> {
  toolName: string
  requestSignature: string | null
  alreadyCompleted: boolean
  tool?: TTool
}

export interface PreviewContinuousQueueTask<TTool = unknown> {
  key: string
  toolName: string
  tool?: TTool
}

export interface ResolvePreviewContinuousToolRunPlanParams<TTool = unknown> {
  enabled: boolean
  fileKind: 'file' | 'directory'
  hasExecutionContext: boolean
  previewViewState: PreviewContinuousPreviewViewState
  candidates: readonly PreviewContinuousToolCandidate<TTool>[]
}

export type PreviewContinuousToolRunPlan<TTool = unknown> =
  | {
    kind: 'none'
  }
  | {
    kind: 'enqueue'
    candidates: PreviewContinuousToolCandidate<TTool>[]
  }

export interface ResolvePreviewContinuousTaskEnqueuePlanParams<TTool = unknown> {
  candidates: readonly PreviewContinuousToolCandidate<TTool>[]
  queuedTaskKeys: ReadonlySet<string>
}

export interface PreviewContinuousTaskEnqueuePlan<TTool = unknown> {
  tasksToEnqueue: PreviewContinuousQueueTask<TTool>[]
}

export interface ResolvePreviewContinuousQueueDrainPlanParams<TTool = unknown> {
  enabled: boolean
  maxConcurrent: number
  inFlightCount: number
  tasks: readonly PreviewContinuousQueueTask<TTool>[]
  completedTaskKeys: ReadonlySet<string>
}

export interface PreviewContinuousQueueDrainPlan<TTool = unknown> {
  tasksToRun: PreviewContinuousQueueTask<TTool>[]
  skippedTaskKeys: string[]
  remainingTasks: PreviewContinuousQueueTask<TTool>[]
}

export function resolvePreviewContinuousToolRunPlan<TTool = unknown>({
  enabled,
  fileKind,
  hasExecutionContext,
  previewViewState,
  candidates,
}: ResolvePreviewContinuousToolRunPlanParams<TTool>): PreviewContinuousToolRunPlan<TTool> {
  if (!enabled || fileKind !== 'file' || !hasExecutionContext || previewViewState !== 'ready') {
    return { kind: 'none' }
  }
  if (candidates.length === 0) {
    return { kind: 'none' }
  }

  return {
    kind: 'enqueue',
    candidates: [...candidates],
  }
}

export function resolvePreviewContinuousTaskEnqueuePlan<TTool = unknown>({
  candidates,
  queuedTaskKeys,
}: ResolvePreviewContinuousTaskEnqueuePlanParams<TTool>): PreviewContinuousTaskEnqueuePlan<TTool> {
  const tasksToEnqueue: PreviewContinuousQueueTask<TTool>[] = []

  for (const candidate of candidates) {
    if (!candidate.requestSignature) continue
    if (candidate.alreadyCompleted) continue
    if (queuedTaskKeys.has(candidate.requestSignature)) continue

    const task: PreviewContinuousQueueTask<TTool> = {
      key: candidate.requestSignature,
      toolName: candidate.toolName,
    }
    if (candidate.tool !== undefined) {
      task.tool = candidate.tool
    }
    tasksToEnqueue.push(task)
  }

  return {
    tasksToEnqueue,
  }
}

export function resolvePreviewContinuousQueueDrainPlan<TTool = unknown>({
  enabled,
  maxConcurrent,
  inFlightCount,
  tasks,
  completedTaskKeys,
}: ResolvePreviewContinuousQueueDrainPlanParams<TTool>): PreviewContinuousQueueDrainPlan<TTool> {
  if (!enabled) {
    return {
      tasksToRun: [],
      skippedTaskKeys: [],
      remainingTasks: [...tasks],
    }
  }

  const availableSlots = Math.max(0, maxConcurrent - inFlightCount)
  const tasksToRun: PreviewContinuousQueueTask<TTool>[] = []
  const skippedTaskKeys: string[] = []
  const remainingTasks: PreviewContinuousQueueTask<TTool>[] = []
  let usedSlots = 0

  for (const task of tasks) {
    if (completedTaskKeys.has(task.key)) {
      skippedTaskKeys.push(task.key)
      continue
    }

    if (usedSlots < availableSlots) {
      tasksToRun.push(task)
      usedSlots += 1
      continue
    }

    remainingTasks.push(task)
  }

  return {
    tasksToRun,
    skippedTaskKeys,
    remainingTasks,
  }
}
