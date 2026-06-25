import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CONTINUOUS_CALL_OPTION_KEY, toolContinuousCallConfig, toEffectiveMaxContinuousConcurrent } from '@/config/toolContinuousCall'
import type { RuntimeToolDescriptor } from '@/lib/runtimeApi'
import {
  isBooleanToolOptionEnabled,
} from '@/features/plugin-runtime/hooks/usePluginRuntime'
import type { ToolWorkbenchOptionValue } from '@/features/plugin-runtime/types'
import {
  resolvePreviewContinuousQueueDrainPlan,
  resolvePreviewContinuousTaskEnqueuePlan,
  resolvePreviewContinuousToolRunPlan,
  type PreviewContinuousQueueTask,
  type PreviewContinuousToolCandidate,
  type PreviewContinuousPreviewViewState,
} from '@/features/preview/lib/previewPluginContinuousRunModel'

interface ContinuousToolTask {
  key: string
  tool: RuntimeToolDescriptor
}

interface UsePreviewContinuousToolRunnerOptions {
  enabled: boolean
  fileKind: 'file' | 'directory'
  previewViewState: PreviewContinuousPreviewViewState
  tools: RuntimeToolDescriptor[]
  optionValuesByTool: Record<string, Record<string, ToolWorkbenchOptionValue>>
  hasExecutionContext: boolean
  getRequestSignature: (tool: RuntimeToolDescriptor) => string | null
  hasCompletedRequest: (toolName: string, requestSignature: string) => boolean
  runToolCall: (
    tool: RuntimeToolDescriptor,
    params: {
      trigger: 'continuous'
      requestSignature: string
      skipIfAlreadyCompleted: true
    }
  ) => Promise<unknown>
}

export function usePreviewContinuousToolRunner({
  enabled,
  fileKind,
  previewViewState,
  tools,
  optionValuesByTool,
  hasExecutionContext,
  getRequestSignature,
  hasCompletedRequest,
  runToolCall,
}: UsePreviewContinuousToolRunnerOptions) {
  const continuousTaskQueueRef = useRef<ContinuousToolTask[]>([])
  const continuousTaskKeySetRef = useRef<Set<string>>(new Set())
  const continuousInFlightCountRef = useRef(0)
  const maxContinuousConcurrent = useMemo(
    () => toEffectiveMaxContinuousConcurrent(toolContinuousCallConfig.maxConcurrent),
    []
  )

  const continuousEnabledToolNames = useMemo(
    () => new Set(
      tools
        .filter((tool) => isBooleanToolOptionEnabled(tool, CONTINUOUS_CALL_OPTION_KEY, optionValuesByTool))
        .map((tool) => tool.name)
    ),
    [optionValuesByTool, tools]
  )

  const processContinuousQueue = useCallback(() => {
    const queuedTasks: PreviewContinuousQueueTask<RuntimeToolDescriptor>[] = continuousTaskQueueRef.current.map((task) => ({
      key: task.key,
      toolName: task.tool.name,
      tool: task.tool,
    }))
    const completedTaskKeys = new Set(
      queuedTasks
        .filter((task) => hasCompletedRequest(task.toolName, task.key))
        .map((task) => task.key)
    )
    const drainPlan = resolvePreviewContinuousQueueDrainPlan({
      enabled,
      maxConcurrent: maxContinuousConcurrent,
      inFlightCount: continuousInFlightCountRef.current,
      tasks: queuedTasks,
      completedTaskKeys,
    })

    for (const skippedTaskKey of drainPlan.skippedTaskKeys) {
      continuousTaskKeySetRef.current.delete(skippedTaskKey)
    }
    continuousTaskQueueRef.current = drainPlan.remainingTasks.flatMap((task) => {
      if (!task.tool) return []
      return [{
        key: task.key,
        tool: task.tool,
      }]
    })

    for (const task of drainPlan.tasksToRun) {
      if (!task.tool) continue
      continuousInFlightCountRef.current += 1
      void runToolCall(task.tool, {
        trigger: 'continuous',
        requestSignature: task.key,
        skipIfAlreadyCompleted: true,
      }).finally(() => {
        continuousInFlightCountRef.current = Math.max(0, continuousInFlightCountRef.current - 1)
        continuousTaskKeySetRef.current.delete(task.key)
        processContinuousQueue()
      })
    }
  }, [enabled, hasCompletedRequest, maxContinuousConcurrent, runToolCall])

  const buildContinuousToolCandidates = useCallback((candidateTools: RuntimeToolDescriptor[]) => {
    return candidateTools.map<PreviewContinuousToolCandidate<RuntimeToolDescriptor>>((tool) => {
      const requestSignature = getRequestSignature(tool)
      return {
        toolName: tool.name,
        requestSignature,
        alreadyCompleted: requestSignature
          ? hasCompletedRequest(tool.name, requestSignature)
          : false,
        tool,
      }
    })
  }, [getRequestSignature, hasCompletedRequest])

  const enqueueContinuousTasks = useCallback((candidates: PreviewContinuousToolCandidate<RuntimeToolDescriptor>[]) => {
    const enqueuePlan = resolvePreviewContinuousTaskEnqueuePlan({
      candidates,
      queuedTaskKeys: continuousTaskKeySetRef.current,
    })

    for (const task of enqueuePlan.tasksToEnqueue) {
      if (!task.tool) continue
      continuousTaskKeySetRef.current.add(task.key)
      continuousTaskQueueRef.current.push({
        key: task.key,
        tool: task.tool,
      })
    }

    processContinuousQueue()
  }, [processContinuousQueue])

  useEffect(() => {
    const continuousTools = tools.filter((tool) => continuousEnabledToolNames.has(tool.name))
    const candidates = buildContinuousToolCandidates(continuousTools)
    const runPlan = resolvePreviewContinuousToolRunPlan({
      enabled,
      fileKind,
      hasExecutionContext,
      previewViewState,
      candidates,
    })

    if (runPlan.kind === 'none') return
    enqueueContinuousTasks(runPlan.candidates)
  }, [
    buildContinuousToolCandidates,
    continuousEnabledToolNames,
    enabled,
    enqueueContinuousTasks,
    fileKind,
    hasExecutionContext,
    previewViewState,
    tools,
  ])

  useEffect(() => {
    if (!enabled) return
    processContinuousQueue()
  }, [enabled, processContinuousQueue])

  return {
    continuousEnabledToolNames,
  }
}
