export interface FileGridItemInteractionEntry {
  kind: 'file' | 'directory'
  path: string
  name: string
}

export type FileGridItemPrimaryIntent =
  | { kind: 'none' }
  | { kind: 'range-select'; index: number; path: string }
  | { kind: 'toggle-selection'; index: number; path: string }
  | { kind: 'open-directory'; index: number; path: string; directoryName: string }
  | { kind: 'open-file'; index: number; path: string; file: FileGridItemInteractionEntry }

export type FileGridItemSecondaryIntent =
  | { kind: 'none' }
  | { kind: 'open-file-secondary'; file: FileGridItemInteractionEntry }

export interface ResolveFileGridItemToggleIntentParams {
  file: FileGridItemInteractionEntry
  index: number
  shiftKey: boolean
}

export interface ResolveFileGridItemClickIntentParams {
  file: FileGridItemInteractionEntry
  index: number
  suppressClick: boolean
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export interface ResolveFileGridItemDoubleClickIntentParams {
  file: FileGridItemInteractionEntry
  suppressClick: boolean
  canOpenFile: boolean
}

export function resolveFileGridItemToggleIntent({
  file,
  index,
  shiftKey,
}: ResolveFileGridItemToggleIntentParams): FileGridItemPrimaryIntent {
  if (shiftKey) {
    return {
      kind: 'range-select',
      index,
      path: file.path,
    }
  }

  return {
    kind: 'toggle-selection',
    index,
    path: file.path,
  }
}

export function resolveFileGridItemClickIntent({
  file,
  index,
  suppressClick,
  shiftKey,
  ctrlKey,
  metaKey,
}: ResolveFileGridItemClickIntentParams): FileGridItemPrimaryIntent {
  if (suppressClick) return { kind: 'none' }

  if (shiftKey) {
    return {
      kind: 'range-select',
      index,
      path: file.path,
    }
  }

  if (ctrlKey || metaKey) {
    return {
      kind: 'toggle-selection',
      index,
      path: file.path,
    }
  }

  if (file.kind === 'directory') {
    return {
      kind: 'open-directory',
      index,
      path: file.path,
      directoryName: file.name,
    }
  }

  return {
    kind: 'open-file',
    index,
    path: file.path,
    file,
  }
}

export function resolveFileGridItemDoubleClickIntent({
  file,
  suppressClick,
  canOpenFile,
}: ResolveFileGridItemDoubleClickIntentParams): FileGridItemSecondaryIntent {
  if (suppressClick || !canOpenFile || file.kind !== 'file') {
    return { kind: 'none' }
  }

  return {
    kind: 'open-file-secondary',
    file,
  }
}
