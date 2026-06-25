export interface PreviewFileNameParts {
  baseName: string
  extension: string
}

export interface PreviewFileNameRenameSubject {
  name: string
  path: string
}

export interface PreviewFileNameRenameActionSubject extends PreviewFileNameRenameSubject {
  kind: 'file' | 'directory'
}

export interface PreviewFileNameRenamePlan {
  expectedRelativePath: string
  ruleArgs: {
    relativePaths: string[]
    nameMask: '[N]'
    findText: string
    replaceText: string
    searchMode: 'plain'
  }
}

export interface PreviewFileNameRenameToolArgs extends Record<string, unknown> {
  relativePaths: string[]
  nameMask: '[N]'
  findText: string
  replaceText: string
  searchMode: 'plain'
  confirm: boolean
}

export interface ResolvePreviewFileNameRenameActionPlanParams {
  file: PreviewFileNameRenameActionSubject | null
  rootId: string | null | undefined
  canRenameFileName: boolean
  renameUnavailableReason: string | null | undefined
  nextBaseName: string
}

export type PreviewFileNameRenameActionPlan =
  | {
    ok: false
    error: string
  }
  | {
    ok: true
    kind: 'noop'
  }
  | {
    ok: true
    kind: 'rename'
    rootId: string
    expectedRelativePath: string
    dryRunArgs: PreviewFileNameRenameToolArgs
    commitArgs: PreviewFileNameRenameToolArgs
  }

export interface PreviewBatchRenameToolResult {
  ok: boolean
  error?: string
  result?: unknown
}

export interface ResolvePreviewBatchRenameToolResultOptions {
  expectedRelativePath: string
  fallbackError: string
  invalidResultError: string
  requireExpectedRelativePath: boolean
}

export interface PreviewLocalDataSetValueResult {
  relativePath: string
  fieldKey: string
  value: string
}

interface BatchRenameItemResult {
  nextRelativePath?: string
  ok?: boolean
  skipped?: boolean
  reasonCode?: string
  error?: string
}

interface PreviewEditResult {
  ok: boolean
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function splitPreviewFileName(fileName: string): PreviewFileNameParts {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return {
      baseName: fileName,
      extension: '',
    }
  }

  return {
    baseName: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex),
  }
}

export function createPreviewFileNameRenamePlan(
  file: PreviewFileNameRenameSubject,
  nextBaseName: string
): PreviewFileNameRenamePlan | null {
  const { baseName, extension } = splitPreviewFileName(file.name)
  if (nextBaseName === baseName) {
    return null
  }

  const parentPath = getParentPath(file.path)
  const expectedRelativePath = joinRelativePath(parentPath, `${nextBaseName}${extension}`)
  return {
    expectedRelativePath,
    ruleArgs: {
      relativePaths: [file.path],
      nameMask: '[N]',
      findText: baseName,
      replaceText: nextBaseName,
      searchMode: 'plain',
    },
  }
}

export function resolvePreviewFileNameRenameActionPlan({
  file,
  rootId,
  canRenameFileName,
  renameUnavailableReason,
  nextBaseName,
}: ResolvePreviewFileNameRenameActionPlanParams): PreviewFileNameRenameActionPlan {
  if (!file || file.kind !== 'file') {
    return {
      ok: false,
      error: '当前项不可重命名',
    }
  }

  if (!canRenameFileName || !rootId) {
    return {
      ok: false,
      error: renameUnavailableReason || '重命名能力不可用',
    }
  }

  const renamePlan = createPreviewFileNameRenamePlan(file, nextBaseName)
  if (!renamePlan) {
    return {
      ok: true,
      kind: 'noop',
    }
  }

  return {
    ok: true,
    kind: 'rename',
    rootId,
    expectedRelativePath: renamePlan.expectedRelativePath,
    dryRunArgs: {
      ...renamePlan.ruleArgs,
      confirm: false,
    },
    commitArgs: {
      ...renamePlan.ruleArgs,
      confirm: true,
    },
  }
}

export function resolvePreviewBatchRenameToolResult(
  toolResult: PreviewBatchRenameToolResult,
  options: ResolvePreviewBatchRenameToolResultOptions
): PreviewEditResult {
  if (!toolResult.ok) {
    return {
      ok: false,
      error: toolResult.error || options.fallbackError,
    }
  }

  const item = readFirstBatchRenameItem(toolResult.result)
  if (!item) {
    return {
      ok: false,
      error: options.invalidResultError,
    }
  }

  if (item.ok !== true || item.skipped === true) {
    return {
      ok: false,
      error: toConflictAwareErrorMessage(item, options.fallbackError),
    }
  }

  if (
    (options.requireExpectedRelativePath || item.nextRelativePath)
    && item.nextRelativePath !== options.expectedRelativePath
  ) {
    return {
      ok: false,
      error: '目标名称已存在',
    }
  }

  return { ok: true }
}

export function readPreviewLocalDataSetValueResult(result: unknown): PreviewLocalDataSetValueResult | null {
  if (!isRecord(result)) return null

  const relativePath = typeof result.relativePath === 'string' ? result.relativePath : ''
  const fieldKey = typeof result.fieldKey === 'string' ? result.fieldKey : ''
  const value = typeof result.value === 'string' ? result.value : ''
  if (!relativePath || !fieldKey || !value) {
    return null
  }

  return {
    relativePath,
    fieldKey,
    value,
  }
}

function getParentPath(relativePath: string): string {
  const segments = relativePath.split('/').filter(Boolean)
  if (segments.length <= 1) return ''
  return segments.slice(0, -1).join('/')
}

function joinRelativePath(parentPath: string, fileName: string): string {
  return parentPath ? `${parentPath}/${fileName}` : fileName
}

function readFirstBatchRenameItem(result: unknown): BatchRenameItemResult | null {
  if (!isRecord(result) || !Array.isArray(result.items) || result.items.length === 0) {
    return null
  }

  const first = result.items[0]
  if (!isRecord(first)) {
    return null
  }

  return {
    nextRelativePath: typeof first.nextRelativePath === 'string' ? first.nextRelativePath : undefined,
    ok: typeof first.ok === 'boolean' ? first.ok : undefined,
    skipped: typeof first.skipped === 'boolean' ? first.skipped : undefined,
    reasonCode: typeof first.reasonCode === 'string' ? first.reasonCode : undefined,
    error: typeof first.error === 'string' ? first.error : undefined,
  }
}

function toConflictAwareErrorMessage(item: BatchRenameItemResult, fallback: string): string {
  if (item.reasonCode === 'RENAME_TARGET_EXISTS') {
    return '目标名称已存在'
  }
  return item.error || fallback
}
