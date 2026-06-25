import { useCallback, useState } from 'react'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import type { FileItem } from '@/types'
import type { PreviewMutationCommitParams } from '@/features/preview/types/mutation'
import {
  resolvePreviewBatchRenameToolResult,
  resolvePreviewFileNameRenameActionPlan,
} from '@/features/preview/lib/previewFileEditModel'

interface UsePreviewFileNameRenameActionOptions {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  canRenameFileName: boolean
  renameUnavailableReason: string | null
  onMutationCommitted?: (params?: PreviewMutationCommitParams) => void | Promise<void>
}

interface PreviewFileNameRenameResult {
  ok: boolean
  error?: string
}

export function usePreviewFileNameRenameAction({
  file,
  rootHandle,
  rootId,
  canRenameFileName,
  renameUnavailableReason,
  onMutationCommitted,
}: UsePreviewFileNameRenameActionOptions) {
  const [isRenaming, setIsRenaming] = useState(false)

  const handleSubmitFileNameRename = useCallback(async (
    nextBaseName: string
  ): Promise<PreviewFileNameRenameResult> => {
    const actionPlan = resolvePreviewFileNameRenameActionPlan({
      file,
      rootId,
      canRenameFileName,
      renameUnavailableReason,
      nextBaseName,
    })

    if (!actionPlan.ok) {
      return actionPlan
    }
    if (actionPlan.kind === 'noop') {
      return { ok: true }
    }

    setIsRenaming(true)
    try {
      const dryRunResult = await dispatchSystemTool({
        toolName: 'fs.batchRename',
        rootHandle,
        rootId: actionPlan.rootId,
        additionalArgs: actionPlan.dryRunArgs,
      })

      const dryRunResolution = resolvePreviewBatchRenameToolResult(dryRunResult, {
        expectedRelativePath: actionPlan.expectedRelativePath,
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
        rootId: actionPlan.rootId,
        additionalArgs: actionPlan.commitArgs,
      })

      const commitResolution = resolvePreviewBatchRenameToolResult(commitResult, {
        expectedRelativePath: actionPlan.expectedRelativePath,
        fallbackError: '重命名提交失败',
        invalidResultError: '重命名提交返回无效结果',
        requireExpectedRelativePath: false,
      })
      if (!commitResolution.ok) {
        return commitResolution
      }

      await onMutationCommitted?.({ preferredPreviewPath: actionPlan.expectedRelativePath })
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

  return {
    isRenaming,
    handleSubmitFileNameRename,
  }
}
