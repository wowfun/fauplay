import type { ReactNode } from 'react'
import { ToolResultClassifyTable, type ClassifyPrediction } from './ToolResultClassifyTable'
import { ToolResultJsonViewer } from './ToolResultJsonViewer'

interface TimmClassifyImageResult {
  model: string
  device: string
  timingMs: number
  predictions: ClassifyPrediction[]
}

export interface ToolResultRenderContext {
  toolName: string
  result: unknown
}

export interface ToolResultRenderer {
  id: string
  canRender: (context: ToolResultRenderContext) => boolean
  renderSummary: (context: ToolResultRenderContext) => ReactNode
  renderDetail: (context: ToolResultRenderContext) => ReactNode
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isClassifyPrediction(value: unknown): value is ClassifyPrediction {
  if (!isRecord(value)) return false
  return typeof value.label === 'string'
    && typeof value.score === 'number'
    && Number.isFinite(value.score)
    && typeof value.index === 'number'
    && Number.isFinite(value.index)
}

function toTimmClassifyImageResult(value: unknown): TimmClassifyImageResult | null {
  if (!isRecord(value)) return null
  if (typeof value.model !== 'string') return null
  if (typeof value.device !== 'string') return null
  if (typeof value.timingMs !== 'number' || !Number.isFinite(value.timingMs)) return null
  if (!Array.isArray(value.predictions)) return null

  const predictions = value.predictions.filter((prediction) => isClassifyPrediction(prediction))
  return {
    model: value.model,
    device: value.device,
    timingMs: value.timingMs,
    predictions,
  }
}

function summarizeJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `JSON 数组（${value.length} 项）`
  }

  if (isRecord(value)) {
    return `JSON 对象（${Object.keys(value).length} 个字段）`
  }

  if (value === null) {
    return 'JSON null'
  }

  return `JSON 值（${typeof value}）`
}

const timmClassifyImageRenderer: ToolResultRenderer = {
  id: 'renderer.timm.classifyImage',
  canRender: (context) => context.toolName === 'ml.classifyImage' && toTimmClassifyImageResult(context.result) !== null,
  renderSummary: (context) => {
    const result = toTimmClassifyImageResult(context.result)
    if (!result) return '分类结果'
    const topPrediction = result.predictions[0]
    const topLabel = topPrediction ? `${topPrediction.label} (${(topPrediction.score * 100).toFixed(2)}%)` : '无预测'
    return `Top-1: ${topLabel} · ${result.device} · ${result.timingMs.toFixed(1)}ms`
  },
  renderDetail: (context) => {
    const result = toTimmClassifyImageResult(context.result)
    if (!result) {
      return <ToolResultJsonViewer value={context.result} />
    }
    return (
      <ToolResultClassifyTable
        model={result.model}
        device={result.device}
        timingMs={result.timingMs}
        predictions={result.predictions}
      />
    )
  },
}

const jsonFallbackRenderer: ToolResultRenderer = {
  id: 'renderer.json.fallback',
  canRender: () => true,
  renderSummary: (context) => summarizeJsonValue(context.result),
  renderDetail: (context) => <ToolResultJsonViewer value={context.result} />,
}

const TOOL_RESULT_RENDERERS: ToolResultRenderer[] = [
  timmClassifyImageRenderer,
  jsonFallbackRenderer,
]

export function resolveToolResultRenderer(context: ToolResultRenderContext): ToolResultRenderer {
  const found = TOOL_RESULT_RENDERERS.find((renderer) => renderer.canRender(context))
  return found ?? jsonFallbackRenderer
}
