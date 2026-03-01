import {
  ensureRootPath,
  openWithSystemDefaultApp,
  revealInSystemExplorer,
} from '@/lib/reveal'

export type SystemToolName = 'system.reveal' | 'system.openDefault'

interface DispatchSystemToolOptions {
  toolName: SystemToolName
  rootHandle: FileSystemDirectoryHandle | null
  relativePath: string
}

type ToolHandler = (relativePath: string, rootPath: string) => Promise<void>

const systemToolHandlers: Record<SystemToolName, ToolHandler> = {
  'system.reveal': revealInSystemExplorer,
  'system.openDefault': openWithSystemDefaultApp,
}

// Dispatch system tools through a single entry to avoid feature components
// coupling to specific gateway transport details.
export async function dispatchSystemTool({
  toolName,
  rootHandle,
  relativePath,
}: DispatchSystemToolOptions): Promise<boolean> {
  if (!rootHandle || !relativePath) return false

  const rootLabel = rootHandle.name || 'current-folder'
  const rootPath = ensureRootPath(rootLabel)
  if (!rootPath) return false

  const handler = systemToolHandlers[toolName]
  await handler(relativePath, rootPath)
  return true
}
