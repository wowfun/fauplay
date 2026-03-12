const SOFT_DELETE_TOOL_NAME = 'fs.softDelete'

export function orderToolsWithSoftDeleteLast<T extends { name: string }>(tools: readonly T[]): T[] {
  const leading: T[] = []
  const trailing: T[] = []

  for (const tool of tools) {
    if (tool.name === SOFT_DELETE_TOOL_NAME) {
      trailing.push(tool)
      continue
    }
    leading.push(tool)
  }

  return [...leading, ...trailing]
}
