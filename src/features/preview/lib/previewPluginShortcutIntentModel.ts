export interface PreviewPluginShortcutEventState {
  defaultPrevented: boolean
  repeat: boolean
  isTypingTarget: boolean
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  matchesSoftDeleteShortcut: boolean
  matchesAnnotationDigitShortcut: boolean
}

export interface PreviewPluginMatchedTagShortcut {
  key: string
  value: string
  alreadyBound: boolean
}

export interface PreviewPluginActiveDigitAssignment {
  fieldKey: string
  valueByDigit: Record<string, string>
}

export interface ResolvePreviewPluginShortcutIntentParams {
  event: PreviewPluginShortcutEventState
  fileKind: 'file' | 'directory'
  enableAnnotationTagShortcutOwner: boolean
  enableContinuousAutoRunOwner: boolean
  annotationToolAvailable: boolean
  softDeleteToolAvailable: boolean
  matchedTagShortcut: PreviewPluginMatchedTagShortcut | null
  activeDigitAssignment: PreviewPluginActiveDigitAssignment | null
}

export type PreviewPluginShortcutIntent =
  | {
    kind: 'none'
  }
  | {
    kind: 'consume'
  }
  | {
    kind: 'run-soft-delete-tool'
  }
  | {
    kind: 'run-annotation-tool'
    actionLabel: string
    additionalArgs: Record<string, unknown>
  }

export function resolvePreviewPluginShortcutIntent({
  event,
  fileKind,
  enableAnnotationTagShortcutOwner,
  enableContinuousAutoRunOwner,
  annotationToolAvailable,
  softDeleteToolAvailable,
  matchedTagShortcut,
  activeDigitAssignment,
}: ResolvePreviewPluginShortcutIntentParams): PreviewPluginShortcutIntent {
  if (event.defaultPrevented || event.repeat || event.isTypingTarget) {
    return { kind: 'none' }
  }
  if (fileKind !== 'file') {
    return { kind: 'none' }
  }

  if (enableAnnotationTagShortcutOwner && annotationToolAvailable && matchedTagShortcut) {
    if (matchedTagShortcut.alreadyBound) {
      return { kind: 'consume' }
    }

    return {
      kind: 'run-annotation-tool',
      actionLabel: `${matchedTagShortcut.key}=${matchedTagShortcut.value}`,
      additionalArgs: {
        operation: 'bindAnnotationTag',
        key: matchedTagShortcut.key,
        value: matchedTagShortcut.value,
      },
    }
  }

  if (
    enableContinuousAutoRunOwner
    && softDeleteToolAvailable
    && event.matchesSoftDeleteShortcut
  ) {
    return {
      kind: 'run-soft-delete-tool',
    }
  }

  if (
    !enableContinuousAutoRunOwner
    || !annotationToolAvailable
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.shiftKey
    || !event.matchesAnnotationDigitShortcut
    || !/^[0-9]$/.test(event.key)
    || !activeDigitAssignment
  ) {
    return { kind: 'none' }
  }

  const value = activeDigitAssignment.valueByDigit[event.key]
  if (!value) {
    return { kind: 'none' }
  }

  return {
    kind: 'run-annotation-tool',
    actionLabel: `${activeDigitAssignment.fieldKey}=${value}`,
    additionalArgs: {
      operation: 'setAnnotationValue',
      fieldKey: activeDigitAssignment.fieldKey,
      value,
      source: 'hotkey',
    },
  }
}
