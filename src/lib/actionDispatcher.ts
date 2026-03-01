import { ensureRootPath } from '@/lib/reveal'
import { callGatewayTool } from '@/lib/gateway'

export type SystemToolName = string

interface DispatchSystemToolOptions {
  toolName: SystemToolName
  rootHandle: FileSystemDirectoryHandle | null
  relativePath: string
}

// Dispatch system tools through a single entry to avoid feature components
// coupling to specific gateway transport details.
export async function dispatchSystemTool({
  toolName,
  rootHandle,
  relativePath,
}: DispatchSystemToolOptions): Promise<boolean> {
  if (!toolName || !rootHandle || !relativePath) return false

  const rootLabel = rootHandle.name || 'current-folder'
  const rootPath = ensureRootPath(rootLabel)
  if (!rootPath) return false

  await callGatewayTool(toolName, {
    rootPath,
    relativePath,
  })

  return true
}
