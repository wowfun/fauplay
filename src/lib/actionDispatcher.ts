import {
  ensureRootPath,
  openWithSystemDefaultApp,
  revealInSystemExplorer,
} from '@/lib/reveal'

export type SystemActionId = 'system.reveal' | 'system.openDefault'

interface DispatchSystemActionOptions {
  actionId: SystemActionId
  rootHandle: FileSystemDirectoryHandle | null
  relativePath: string
}

type ActionHandler = (relativePath: string, rootPath: string) => Promise<void>

const systemActionHandlers: Record<SystemActionId, ActionHandler> = {
  'system.reveal': revealInSystemExplorer,
  'system.openDefault': openWithSystemDefaultApp,
}

// Dispatch system actions through a single entry to avoid feature components
// coupling to specific helper transport details.
export async function dispatchSystemAction({
  actionId,
  rootHandle,
  relativePath,
}: DispatchSystemActionOptions): Promise<boolean> {
  if (!rootHandle || !relativePath) return false

  const rootLabel = rootHandle.name || 'current-folder'
  const rootPath = ensureRootPath(rootLabel)
  if (!rootPath) return false

  const handler = systemActionHandlers[actionId]
  await handler(relativePath, rootPath)
  return true
}
