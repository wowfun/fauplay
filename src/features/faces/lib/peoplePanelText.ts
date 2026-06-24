import type { FaceMutationResult, PersonScope, PersonSummary } from '@/features/faces/types'

export type PanelView = 'people' | 'unassigned' | 'ignored'
export type NoticeTone = 'info' | 'error'

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
