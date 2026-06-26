import type { ShortcutBinding } from '@/lib/keyboard'

export type TagShortcutActionId = `tag:${string}`

export interface ConfiguredPreviewTagShortcut {
  actionId: TagShortcutActionId
  key: string
  value: string
  tagKey: string
  bindings: ShortcutBinding[]
}

const TAG_SHORTCUT_ACTION_PREFIX = 'tag:'

export const previewTagShortcutImplicitBinding: Partial<ShortcutBinding> = {
  ctrl: false,
  meta: false,
  alt: false,
}

export function parseTagShortcutActionId(
  rawActionId: string,
  source: string
): { shortcut: Omit<ConfiguredPreviewTagShortcut, 'bindings'> | null; warning: string | null } | null {
  if (!rawActionId.startsWith(TAG_SHORTCUT_ACTION_PREFIX)) {
    return null
  }

  const rawIdentity = rawActionId.slice(TAG_SHORTCUT_ACTION_PREFIX.length)
  const separatorIndex = rawIdentity.indexOf('=')
  if (separatorIndex <= 0 || separatorIndex === rawIdentity.length - 1) {
    return {
      shortcut: null,
      warning: `${source}: "${rawActionId}" must use "tag:<key>=<value>"`,
    }
  }

  const key = rawIdentity.slice(0, separatorIndex).trim()
  const value = rawIdentity.slice(separatorIndex + 1).trim()
  if (!key || !value) {
    return {
      shortcut: null,
      warning: `${source}: "${rawActionId}" must define both key and value`,
    }
  }

  return {
    shortcut: {
      actionId: toTagShortcutActionId(key, value),
      key,
      value,
      tagKey: toTagShortcutTagKey(key, value),
    },
    warning: null,
  }
}

function toTagShortcutTagKey(key: string, value: string): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function toTagShortcutActionId(key: string, value: string): TagShortcutActionId {
  return `${TAG_SHORTCUT_ACTION_PREFIX}${key}=${value}` as TagShortcutActionId
}
