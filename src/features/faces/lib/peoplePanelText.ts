import type { FaceMutationResult, PersonScope, PersonSummary } from '@/features/faces/types'

export type PanelView = 'people' | 'unassigned' | 'ignored'
export type NoticeTone = 'info' | 'error'
export type PeoplePanelSourceAction = 'open-source' | 'project-sources'
export type PeoplePanelSourceActionOutcome = 'unavailable' | 'rejected' | 'error'

export function faceCountText(person: PersonSummary, scope: PersonScope): string {
  if (scope === 'global') {
    return `${person.faceCount} 张脸`
  }
  return `当前 ${person.faceCount} / 全局 ${person.globalFaceCount}`
}

export function readFaceMutationResultMessage(
  result: FaceMutationResult
): { tone: NoticeTone; message: string } | null {
  if (result.failed <= 0) {
    return {
      tone: 'info',
      message: `已完成 ${result.succeeded} 项`,
    }
  }

  const firstError = result.items.find((item) => !item.ok)?.error
  if (result.succeeded <= 0) {
    return {
      tone: 'error',
      message: firstError || `操作失败（${result.failed} 项）`,
    }
  }

  return {
    tone: 'error',
    message: `已完成 ${result.succeeded} 项，失败 ${result.failed} 项${firstError ? `：${firstError}` : ''}`,
  }
}

export function readPeoplePanelSourceActionNotice(
  action: PeoplePanelSourceAction,
  outcome: PeoplePanelSourceActionOutcome,
  error?: unknown,
): { tone: NoticeTone; message: string } {
  return {
    tone: 'error',
    message: readPeoplePanelSourceActionMessage(action, outcome, error),
  }
}

function readPeoplePanelSourceActionMessage(
  action: PeoplePanelSourceAction,
  outcome: PeoplePanelSourceActionOutcome,
  error?: unknown,
): string {
  if (outcome === 'error' && error instanceof Error) {
    return error.message
  }

  if (action === 'open-source') {
    if (outcome === 'unavailable') return '当前上下文不支持打开来源文件'
    if (outcome === 'rejected') return '该人脸来源不在当前 Root 内，暂不支持跳转'
    return '来源文件打开失败'
  }

  if (outcome === 'unavailable') return '当前上下文不支持投射源文件'
  if (outcome === 'rejected') return '没有可投射的源文件'
  return '源文件投射失败'
}
