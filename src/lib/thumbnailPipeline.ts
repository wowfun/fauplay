import { generateThumbnail } from '@/lib/thumbnail'
import type { ThumbnailSizePreset } from '@/types'

export type ThumbnailTaskPriority = 'visible' | 'nearby'

interface ThumbnailRequest {
  file: File
  filePath: string
  mediaType: 'image' | 'video'
  sizePreset: ThumbnailSizePreset
  priority: ThumbnailTaskPriority
  signal?: AbortSignal
}

interface ThumbnailCacheLookup {
  filePath: string
  mediaType: 'image' | 'video'
  sizePreset: ThumbnailSizePreset
  fileSize?: number
  fileLastModifiedMs?: number
}

interface QueueTask {
  key: string
  baseKey: string
  priorityWeight: number
  sequence: number
  run: () => Promise<string>
  resolve: (value: string) => void
  reject: (reason?: unknown) => void
}

const DEFAULT_THUMBNAIL_CONCURRENCY = 8
const PRIORITY_WEIGHT: Record<ThumbnailTaskPriority, number> = {
  visible: 0,
  nearby: 1,
}

let maxConcurrent = DEFAULT_THUMBNAIL_CONCURRENCY
let activeCount = 0
let sequence = 0

const resultCache = new Map<string, string>()
const latestResultCache = new Map<string, string>()
const activeOrPending = new Map<string, Promise<string>>()
const queuedTaskByKey = new Map<string, QueueTask>()
const queue: QueueTask[] = []

function createAbortError(): Error {
  return new DOMException('Thumbnail task aborted', 'AbortError')
}

function buildPipelineKey(options: ThumbnailRequest): string {
  const fileVersion = `${options.file.lastModified}:${options.file.size}`
  return [
    options.filePath,
    fileVersion,
    options.mediaType,
    options.sizePreset,
  ].join('::')
}

function buildPipelineBaseKey(options: {
  filePath: string
  mediaType: 'image' | 'video'
  sizePreset: ThumbnailSizePreset
}): string {
  return [options.filePath, options.mediaType, options.sizePreset].join('::')
}

function buildPipelineKeyFromLookup(options: ThumbnailCacheLookup): string | null {
  if (
    typeof options.fileSize !== 'number' ||
    typeof options.fileLastModifiedMs !== 'number'
  ) {
    return null
  }

  const fileVersion = `${options.fileLastModifiedMs}:${options.fileSize}`
  return [
    options.filePath,
    fileVersion,
    options.mediaType,
    options.sizePreset,
  ].join('::')
}

function buildPipelineBaseKeyFromLookup(options: ThumbnailCacheLookup): string {
  return buildPipelineBaseKey({
    filePath: options.filePath,
    mediaType: options.mediaType,
    sizePreset: options.sizePreset,
  })
}

function dequeueNextTask(): QueueTask | undefined {
  if (queue.length === 0) return undefined

  let bestIndex = 0
  for (let index = 1; index < queue.length; index++) {
    const current = queue[index]
    const best = queue[bestIndex]
    if (current.priorityWeight < best.priorityWeight) {
      bestIndex = index
      continue
    }
    if (
      current.priorityWeight === best.priorityWeight &&
      current.sequence < best.sequence
    ) {
      bestIndex = index
    }
  }

  const [task] = queue.splice(bestIndex, 1)
  queuedTaskByKey.delete(task.key)
  return task
}

function promoteQueuedTaskPriority(
  key: string,
  requestedPriority: ThumbnailTaskPriority
) {
  const queuedTask = queuedTaskByKey.get(key)
  if (!queuedTask) return

  const requestedWeight = PRIORITY_WEIGHT[requestedPriority]
  if (requestedWeight < queuedTask.priorityWeight) {
    queuedTask.priorityWeight = requestedWeight
  }
}

function processQueue() {
  while (activeCount < maxConcurrent) {
    const task = dequeueNextTask()
    if (!task) return

    activeCount += 1
    task
      .run()
      .then((url) => {
        resultCache.set(task.key, url)
        latestResultCache.set(task.baseKey, url)
        task.resolve(url)
      })
      .catch((error) => {
        task.reject(error)
      })
      .finally(() => {
        activeOrPending.delete(task.key)
        activeCount = Math.max(0, activeCount - 1)
        processQueue()
      })
  }
}

export function configureThumbnailPipeline(options: { maxConcurrency?: number }) {
  if (typeof options.maxConcurrency === 'number') {
    maxConcurrent = Math.max(1, Math.floor(options.maxConcurrency))
    processQueue()
  }
}

export function requestThumbnailFromPipeline(options: ThumbnailRequest): Promise<string> {
  const key = buildPipelineKey(options)
  const baseKey = buildPipelineBaseKey(options)

  const cached = resultCache.get(key)
  if (cached) {
    return Promise.resolve(cached)
  }

  if (options.signal?.aborted) {
    return Promise.reject(createAbortError())
  }

  const existing = activeOrPending.get(key)
  if (existing) {
    promoteQueuedTaskPriority(key, options.priority)
    return existing
  }

  let resolvePromise: (value: string) => void = () => {}
  let rejectPromise: (reason?: unknown) => void = () => {}
  const taskPromise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const task: QueueTask = {
    key,
    baseKey,
    priorityWeight: PRIORITY_WEIGHT[options.priority],
    sequence: sequence++,
    run: () =>
      generateThumbnail(options.file, options.mediaType, {
        filePath: options.filePath,
        sizePreset: options.sizePreset,
      }),
    resolve: resolvePromise,
    reject: rejectPromise,
  }

  if (options.signal) {
    const handleAbort = () => {
      const queuedIndex = queue.findIndex((queuedTask) => queuedTask.key === key)
      if (queuedIndex >= 0) {
        queue.splice(queuedIndex, 1)
        queuedTaskByKey.delete(key)
        activeOrPending.delete(key)
        rejectPromise(createAbortError())
      }
      options.signal?.removeEventListener('abort', handleAbort)
    }

    options.signal.addEventListener('abort', handleAbort, { once: true })
    taskPromise.finally(() => {
      options.signal?.removeEventListener('abort', handleAbort)
    })
  }

  activeOrPending.set(key, taskPromise)
  queuedTaskByKey.set(key, task)
  queue.push(task)
  processQueue()
  return taskPromise
}

export function getExactCachedThumbnailFromPipeline(
  options: ThumbnailCacheLookup
): string | null {
  const key = buildPipelineKeyFromLookup(options)
  if (!key) return null
  return resultCache.get(key) ?? null
}

export function getLatestCachedThumbnailFromPipeline(
  options: ThumbnailCacheLookup
): string | null {
  const exact = getExactCachedThumbnailFromPipeline(options)
  if (exact) return exact
  const baseKey = buildPipelineBaseKeyFromLookup(options)
  return latestResultCache.get(baseKey) ?? null
}
